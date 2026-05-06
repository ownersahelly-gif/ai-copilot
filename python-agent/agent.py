"""
EchoPilot Desktop Agent — local sidecar.
Runs a WebSocket server on ws://127.0.0.1:8765/ws that the EchoPilot web app
connects to. Authenticates with a pairing token and (now) captures REAL
mouse + keyboard input via pynput when the UI requests recording.

Run:
    python -m venv .venv
    source .venv/bin/activate          # Windows: .venv\\Scripts\\activate
    pip install -r requirements.txt
    python agent.py

On macOS you must grant the Terminal (or your Python binary) the
"Accessibility" and "Input Monitoring" permissions in
System Settings → Privacy & Security, otherwise pynput cannot see global
input events.
"""
from __future__ import annotations

import asyncio
import json
import platform
import secrets
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

VERSION = "0.2.0"
HOST = "127.0.0.1"
PORT = 8765

TOKEN_FILE = Path.home() / ".echopilot_token"


def get_or_create_token() -> str:
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    tok = secrets.token_urlsafe(9)
    TOKEN_FILE.write_text(tok)
    try:
        TOKEN_FILE.chmod(0o600)
    except Exception:
        pass
    return tok


# -------------------- Recorder --------------------
class Recorder:
    """
    Captures real OS input via pynput. Posts events into an asyncio.Queue
    that the websocket task drains and forwards to the browser.
    """

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self.loop = loop
        self.queue = queue
        self._mouse_listener: Any = None
        self._kb_listener: Any = None
        self._typing_buffer: list[str] = []
        self._last_type_ts = 0.0
        self._start_ts = 0.0
        self.active = False
        self._lock = threading.Lock()

    # ---- helpers ----
    def _emit(self, ev: dict) -> None:
        ev["ts"] = int((time.monotonic() - self._start_ts) * 1000)
        # Hand off to the asyncio loop in a thread-safe way
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

    # ---- listener callbacks ----
    def _on_click(self, x, y, button, pressed):
        if not pressed:
            return
        self._flush_typing()
        btn = str(button).split(".")[-1]
        self._emit({
            "kind": "click",
            "label": f"Click ({int(x)}, {int(y)}) [{btn}]",
            "x": int(x), "y": int(y), "button": btn,
        })

    def _on_scroll(self, x, y, dx, dy):
        self._flush_typing()
        direction = "down" if dy < 0 else "up" if dy > 0 else ("right" if dx > 0 else "left")
        self._emit({
            "kind": "scroll",
            "label": f"Scroll {direction}",
            "x": int(x), "y": int(y),
        })

    def _on_press(self, key):
        try:
            ch = key.char  # printable
        except AttributeError:
            ch = None
        name = getattr(key, "name", None)

        # Modifier-shortcut detection
        if name in {"cmd", "cmd_l", "cmd_r", "ctrl", "ctrl_l", "ctrl_r", "alt", "alt_l", "alt_r"}:
            self._modifier_held = name
            return

        if ch is not None and ch.isprintable():
            with self._lock:
                self._typing_buffer.append(ch)
                self._last_type_ts = time.monotonic()
            return

        # Non-printable key (Enter, Tab, Esc, arrows, etc.)
        self._flush_typing()
        self._emit({
            "kind": "key",
            "label": f"Press {name or str(key)}",
            "key": name or str(key),
        })

    def _on_release(self, key):
        # If user pauses typing >800ms, flush
        if self._typing_buffer and time.monotonic() - self._last_type_ts > 0.8:
            self._flush_typing()

    # ---- public API ----
    def start(self) -> bool:
        if not HAVE_PYNPUT:
            return False
        if self.active:
            return True
        self._start_ts = time.monotonic()
        self._typing_buffer.clear()
        self._mouse_listener = mouse.Listener(
            on_click=self._on_click, on_scroll=self._on_scroll,
        )
        self._kb_listener = keyboard.Listener(
            on_press=self._on_press, on_release=self._on_release,
        )
        self._mouse_listener.start()
        self._kb_listener.start()
        self.active = True
        return True

    def stop(self) -> None:
        if not self.active:
            return
        self.active = False
        self._flush_typing()
        try:
            self._mouse_listener and self._mouse_listener.stop()
        except Exception:
            pass
        try:
            self._kb_listener and self._kb_listener.stop()
        except Exception:
            pass
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
        """Forward recorded events to the browser as they happen."""
        while True:
            ev = await queue.get()
            try:
                await ws.send_json({"type": "recorded_event", "event": ev})
            except Exception:
                return

    pump_task: asyncio.Task | None = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
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
                    await ws.send_json({
                        "type": "error",
                        "msg": "pynput is not installed in the agent venv. Run: pip install -r requirements.txt",
                    })
                    continue
                ok = recorder.start()
                if ok:
                    await ws.send_json({"type": "recording_started"})
                    await ws.send_json({"type": "log", "level": "info",
                                        "msg": "Recording real mouse + keyboard input"})
                else:
                    await ws.send_json({"type": "error", "msg": "Failed to start recorder"})

            elif mtype == "stop_recording":
                recorder.stop()
                await ws.send_json({"type": "recording_stopped", "events": []})

            elif mtype == "screenshot":
                # Optional: implement with mss if you want screenshots
                await ws.send_json({"type": "screenshot", "data": None})

            elif mtype == "run":
                # Workflow execution would go here. Not implemented in this build.
                await ws.send_json({"type": "log", "level": "warn",
                                    "msg": "Workflow execution is not yet wired in this agent build."})
                await ws.send_json({"type": "run_finished",
                                    "runId": msg.get("runId", ""), "ok": False})

    except WebSocketDisconnect:
        pass
    finally:
        recorder.stop()
        if pump_task:
            pump_task.cancel()


def main():
    print("=" * 60)
    print(f" EchoPilot Desktop Agent v{VERSION}")
    print(f" Listening on ws://{HOST}:{PORT}/ws")
    print(f" Pairing token: {TOKEN}")
    print(f" pynput available: {HAVE_PYNPUT}")
    if not HAVE_PYNPUT:
        print(" -> Install with: pip install -r requirements.txt")
    print(" macOS: grant Terminal Accessibility + Input Monitoring permissions")
    print("=" * 60)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
