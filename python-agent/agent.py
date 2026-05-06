"""
EchoPilot Desktop Agent — local sidecar.

- Captures REAL mouse + keyboard input via pynput.
- Tags every event with the focused app / window title.
- Drops events whose window matches an ignore-pattern list (so actions inside
  the EchoPilot browser tab itself never get recorded).
- Can show a NATIVE OS dialog ("Explain this step") on top of whatever app
  the user is currently in (not stuck inside the browser tab).

macOS: grant Terminal both "Accessibility" and "Input Monitoring" in
System Settings → Privacy & Security.
"""
from __future__ import annotations

import asyncio
import json
import platform
import secrets
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

try:
    from pynput import mouse, keyboard  # type: ignore
    HAVE_PYNPUT = True
except Exception as e:  # pragma: no cover
    print(f"[agent] pynput unavailable: {e!r} — recording will be disabled")
    HAVE_PYNPUT = False

VERSION = "0.4.0"
HOST = "127.0.0.1"
PORT = 8765
SYS = platform.system()

TOKEN_FILE = Path.home() / ".echopilot_token"


def get_or_create_token() -> str:
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    tok = secrets.token_urlsafe(9)
    TOKEN_FILE.write_text(tok)
    try: TOKEN_FILE.chmod(0o600)
    except Exception: pass
    return tok


# -------------------- Active window probe --------------------
def _active_window() -> tuple[str, str]:
    try:
        if SYS == "Darwin":
            try:
                from AppKit import NSWorkspace  # type: ignore
                app = NSWorkspace.sharedWorkspace().activeApplication() or {}
                name = app.get("NSApplicationName", "") or ""
            except Exception:
                name = ""
            title = ""
            try:
                import Quartz  # type: ignore
                opts = (Quartz.kCGWindowListOptionOnScreenOnly
                        | Quartz.kCGWindowListExcludeDesktopElements)
                for w in Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID) or []:
                    if w.get("kCGWindowOwnerName") == name:
                        t = w.get("kCGWindowName") or ""
                        if t:
                            title = t
                            break
            except Exception:
                pass
            return name, title
        if SYS == "Windows":
            try:
                import ctypes
                user32 = ctypes.windll.user32
                hwnd = user32.GetForegroundWindow()
                length = user32.GetWindowTextLengthW(hwnd)
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                return "", buf.value or ""
            except Exception:
                return "", ""
        if SYS == "Linux":
            try:
                out = subprocess.run(
                    ["xdotool", "getactivewindow", "getwindowname"],
                    capture_output=True, text=True, timeout=0.4,
                )
                return "", (out.stdout or "").strip()
            except Exception:
                return "", ""
    except Exception:
        pass
    return "", ""


# -------------------- Native OS dialog --------------------
def _native_prompt(title: str, message: str, default: str = "") -> str | None:
    """Block in a worker thread; return user's text, or None if cancelled."""
    try:
        if SYS == "Darwin":
            # AppleScript dialog floats over whatever app is focused.
            safe_msg = message.replace('"', '\\"')
            safe_def = default.replace('"', '\\"')
            safe_title = title.replace('"', '\\"')
            script = (
                f'tell application "System Events" to '
                f'display dialog "{safe_msg}" default answer "{safe_def}" '
                f'with title "{safe_title}" buttons {{"Skip","Save"}} '
                f'default button "Save"'
            )
            r = subprocess.run(["osascript", "-e", script],
                               capture_output=True, text=True, timeout=120)
            if r.returncode != 0:
                return None  # user pressed Skip / cancelled
            out = r.stdout.strip()
            # Format: button returned:Save, text returned:hello
            text = ""
            for part in out.split(", "):
                if part.startswith("text returned:"):
                    text = part[len("text returned:"):]
            return text
        if SYS == "Windows" and shutil.which("powershell"):
            safe_msg = message.replace('"', '`"')
            safe_def = default.replace('"', '`"')
            ps = (
                'Add-Type -AssemblyName Microsoft.VisualBasic;'
                f'[Microsoft.VisualBasic.Interaction]::InputBox("{safe_msg}","{title}","{safe_def}")'
            )
            r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                               capture_output=True, text=True, timeout=120)
            return r.stdout.strip() or None
        if SYS == "Linux" and shutil.which("zenity"):
            r = subprocess.run(
                ["zenity", "--entry", f"--title={title}",
                 f"--text={message}", f"--entry-text={default}"],
                capture_output=True, text=True, timeout=120,
            )
            if r.returncode != 0:
                return None
            return r.stdout.strip()
    except Exception as e:
        print(f"[agent] native prompt failed: {e!r}")
    return None


# -------------------- Recorder --------------------
class Recorder:
    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self.loop = loop
        self.queue = queue
        self._mouse_listener: Any = None
        self._kb_listener: Any = None
        self._typing_buffer: list[str] = []
        self._last_type_ts = 0.0
        self._start_ts = 0.0
        self.active = False
        self.paused = False
        self.ignore_patterns: list[str] = []
        self._lock = threading.Lock()
        # Track currently-held modifier keys so Cmd+C / Ctrl+V emit shortcuts
        # instead of being swallowed as typed characters.
        self._mods: set[str] = set()

    def _is_ignored(self, app_name: str, title: str) -> bool:
        if not self.ignore_patterns:
            return False
        hay = f"{app_name} {title}".lower()
        return any(p and p.lower() in hay for p in self.ignore_patterns)

    def _emit(self, ev: dict) -> None:
        if self.paused:
            return
        app_name, title = _active_window()
        if self._is_ignored(app_name, title):
            return  # hard-drop events inside the EchoPilot tab itself
        ev["ts"] = int((time.monotonic() - self._start_ts) * 1000)
        ev["app"] = app_name
        ev["window"] = title
        self.loop.call_soon_threadsafe(self.queue.put_nowait, ev)

    def _flush_typing(self) -> None:
        with self._lock:
            if not self._typing_buffer:
                return
            text = "".join(self._typing_buffer)
            self._typing_buffer.clear()
        self._emit({
            "kind": "type",
            "label": f"Type {text!r}" if len(text) <= 40 else f"Type {text[:37]!r}…",
            "text": text,
        })

    def _on_click(self, x, y, button, pressed):
        if not pressed or self.paused:
            return
        self._flush_typing()
        btn = str(button).split(".")[-1]
        self._emit({
            "kind": "click",
            "label": f"Click ({int(x)}, {int(y)}) [{btn}]",
            "x": int(x), "y": int(y), "button": btn,
        })

    def _on_scroll(self, x, y, dx, dy):
        if self.paused:
            return
        self._flush_typing()
        direction = "down" if dy < 0 else "up" if dy > 0 else ("right" if dx > 0 else "left")
        self._emit({
            "kind": "scroll",
            "label": f"Scroll {direction}",
            "x": int(x), "y": int(y),
        })

    def _on_press(self, key):
        if self.paused:
            return
        try: ch = key.char
        except AttributeError: ch = None
        name = getattr(key, "name", None)

        # Track modifiers
        MOD_NAMES = {
            "cmd": "cmd", "cmd_l": "cmd", "cmd_r": "cmd",
            "ctrl": "ctrl", "ctrl_l": "ctrl", "ctrl_r": "ctrl",
            "alt": "alt", "alt_l": "alt", "alt_r": "alt",
            "shift": "shift", "shift_l": "shift", "shift_r": "shift",
        }
        if name in MOD_NAMES:
            self._mods.add(MOD_NAMES[name])
            return

        # If a modifier is held and a printable char arrives → shortcut
        active_mods = self._mods - {"shift"}
        if active_mods and (ch is not None or name):
            self._flush_typing()
            label_key = (ch or name or "").lower()
            combo = "+".join(sorted(active_mods)) + ("+" + label_key if label_key else "")
            pretty = "+".join(m.capitalize() for m in sorted(active_mods))
            if label_key:
                pretty += "+" + label_key.upper()
            self._emit({
                "kind": "shortcut",
                "label": pretty,
                "combo": combo,
                "key": label_key,
                "mods": sorted(active_mods),
            })
            return

        if ch is not None and ch.isprintable():
            with self._lock:
                self._typing_buffer.append(ch)
                self._last_type_ts = time.monotonic()
            return
        self._flush_typing()
        self._emit({
            "kind": "key",
            "label": f"Press {name or str(key)}",
            "key": name or str(key),
        })

    def _on_release(self, key):
        name = getattr(key, "name", None)
        MOD_NAMES = {
            "cmd": "cmd", "cmd_l": "cmd", "cmd_r": "cmd",
            "ctrl": "ctrl", "ctrl_l": "ctrl", "ctrl_r": "ctrl",
            "alt": "alt", "alt_l": "alt", "alt_r": "alt",
            "shift": "shift", "shift_l": "shift", "shift_r": "shift",
        }
        if name in MOD_NAMES:
            self._mods.discard(MOD_NAMES[name])
            return
        if self._typing_buffer and time.monotonic() - self._last_type_ts > 0.8:
            self._flush_typing()

    def start(self, ignore_patterns: list[str] | None = None) -> bool:
        if not HAVE_PYNPUT:
            return False
        self.ignore_patterns = ignore_patterns or []
        if self.active:
            self.paused = False
            return True
        self._start_ts = time.monotonic()
        self._typing_buffer.clear()
        self.paused = False
        self._mouse_listener = mouse.Listener(on_click=self._on_click, on_scroll=self._on_scroll)
        self._kb_listener = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
        self._mouse_listener.start()
        self._kb_listener.start()
        self.active = True
        return True

    def pause(self) -> None:
        self.paused = True
        self._flush_typing()

    def resume(self) -> None:
        self.paused = False

    def stop(self) -> None:
        if not self.active:
            return
        self.active = False
        self._flush_typing()
        try: self._mouse_listener and self._mouse_listener.stop()
        except Exception: pass
        try: self._kb_listener and self._kb_listener.stop()
        except Exception: pass
        self._mouse_listener = None
        self._kb_listener = None


# -------------------- WebSocket server --------------------
app = FastAPI()
TOKEN = get_or_create_token()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    recorder = Recorder(loop, queue)
    authed = False

    await ws.send_json({
        "type": "hello",
        "version": VERSION,
        "platform": f"{platform.system()}-{platform.release()}-{platform.machine()}-{platform.architecture()[0]}",
        "needs_auth": True,
    })

    async def pump_events():
        while True:
            ev = await queue.get()
            try:
                await ws.send_json({"type": "recorded_event", "event": ev})
            except Exception:
                return

    async def handle_prompt(req_id: str, title: str, message: str, default: str):
        # Run blocking native dialog in a worker thread
        result = await asyncio.to_thread(_native_prompt, title, message, default)
        try:
            await ws.send_json({
                "type": "prompt_result",
                "id": req_id,
                "ok": result is not None,
                "text": result or "",
            })
        except Exception:
            pass

    pump_task: asyncio.Task | None = None

    try:
        while True:
            raw = await ws.receive_text()
            try: msg = json.loads(raw)
            except Exception: continue
            mtype = msg.get("type")

            if mtype == "auth":
                if msg.get("token") == TOKEN:
                    authed = True
                    await ws.send_json({"type": "auth_ok"})
                    pump_task = asyncio.create_task(pump_events())
                else:
                    await ws.send_json({"type": "auth_failed"})
                continue

            if not authed:
                continue

            if mtype == "ping":
                await ws.send_json({"type": "pong"})

            elif mtype == "start_recording":
                if not HAVE_PYNPUT:
                    await ws.send_json({"type": "error",
                        "msg": "pynput not installed. Run: pip install -r requirements.txt"})
                    continue
                patterns = msg.get("ignore_patterns") or []
                ok = recorder.start(patterns)
                if ok:
                    await ws.send_json({"type": "recording_started"})
                    await ws.send_json({"type": "log", "level": "info",
                        "msg": f"Recording (ignoring: {patterns or 'none'})"})
                else:
                    await ws.send_json({"type": "error", "msg": "Failed to start recorder"})

            elif mtype == "set_ignore_patterns":
                recorder.ignore_patterns = msg.get("patterns") or []

            elif mtype == "pause_recording":
                recorder.pause()

            elif mtype == "resume_recording":
                recorder.resume()

            elif mtype == "stop_recording":
                recorder.stop()
                await ws.send_json({"type": "recording_stopped", "events": []})

            elif mtype == "prompt":
                # Show a native dialog wherever the user is (not in browser)
                asyncio.create_task(handle_prompt(
                    msg.get("id", ""),
                    msg.get("title", "EchoPilot"),
                    msg.get("message", ""),
                    msg.get("default", ""),
                ))

            elif mtype == "screenshot":
                await ws.send_json({"type": "screenshot", "data": None})

            elif mtype == "run":
                asyncio.create_task(execute_run(ws, recorder, msg))


    except WebSocketDisconnect:
        pass
    finally:
        recorder.stop()
        if pump_task:
            pump_task.cancel()


def main():
    print("=" * 60)
    print(f" EchoPilot Desktop Agent v{VERSION}")
    print(f" ws://{HOST}:{PORT}/ws  token: {TOKEN}")
    print(f" pynput: {HAVE_PYNPUT}  | OS: {SYS}")
    print(" macOS: grant Terminal Accessibility + Input Monitoring")
    print("=" * 60)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
