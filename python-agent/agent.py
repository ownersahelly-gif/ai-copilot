"""
EchoPilot Desktop Agent
=======================
Local FastAPI + WebSocket server that executes workflow steps on this machine.
The EchoPilot web app connects to ws://localhost:8765/ws and streams steps;
the agent runs them with PyAutoGUI / Playwright / mss / pytesseract and streams
back live status, screenshots and OCR results.

Quick start:
    python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\\Scripts\\activate)
    pip install -r requirements.txt
    playwright install chromium                          # only if you use browser steps
    python agent.py

By default the agent binds to 127.0.0.1 only. Pair it with a one-time token
printed to your terminal — the web app will ask you to paste it once.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import platform
import secrets
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---- Optional heavy deps: only imported when actually needed ---------------

def _lazy_import(name: str):
    try:
        return __import__(name)
    except Exception as e:  # pragma: no cover
        print(f"[agent] '{name}' not available: {e}", file=sys.stderr)
        return None


VERSION = "0.1.0"
HOST = os.environ.get("ECHOPILOT_HOST", "127.0.0.1")
PORT = int(os.environ.get("ECHOPILOT_PORT", "8765"))
PAIRING_TOKEN = os.environ.get("ECHOPILOT_TOKEN") or secrets.token_urlsafe(8)
ALLOW_ORIGINS = os.environ.get(
    "ECHOPILOT_ORIGINS",
    "https://*.lovable.app,https://*.lovableproject.com,http://localhost:5173,http://localhost:3000",
).split(",")

# ---------------------------------------------------------------------------

app = FastAPI(title="EchoPilot Agent", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WorkflowStep(BaseModel):
    id: Optional[str] = None
    type: str
    target: str = ""
    value: Optional[str] = None
    description: str = ""


@dataclass
class Session:
    ws: WebSocket
    paused: bool = False
    cancelled: bool = False
    inputs: dict = field(default_factory=dict)


# ---- Executors -------------------------------------------------------------

class DesktopExecutor:
    def __init__(self):
        self.pg = _lazy_import("pyautogui")
        self.mss = _lazy_import("mss")
        if self.pg:
            self.pg.FAILSAFE = True
            self.pg.PAUSE = 0.05

    def screenshot_b64(self) -> Optional[str]:
        if not self.mss:
            return None
        from PIL import Image  # type: ignore
        with self.mss.mss() as sct:
            mon = sct.monitors[1]
            raw = sct.grab(mon)
            img = Image.frombytes("RGB", raw.size, raw.rgb)
            # Downscale aggressively for streaming
            img.thumbnail((1280, 800))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=55)
            return base64.b64encode(buf.getvalue()).decode("ascii")

    def ocr(self, region=None) -> str:
        try:
            import pytesseract  # type: ignore
            from PIL import ImageGrab  # type: ignore
            img = ImageGrab.grab(bbox=region)
            return pytesseract.image_to_string(img)
        except Exception as e:
            return f"<ocr unavailable: {e}>"

    async def run_step(self, step: WorkflowStep) -> dict:
        pg = self.pg
        if pg is None:
            return {"ok": False, "error": "pyautogui not installed"}

        t = step.type
        try:
            if t == "click":
                # target may be "x,y"
                if "," in step.target:
                    x, y = [int(v.strip()) for v in step.target.split(",", 1)]
                    pg.click(x, y)
                else:
                    pg.click()
                return {"ok": True}
            if t == "type":
                pg.typewrite(step.value or step.target, interval=0.02)
                return {"ok": True}
            if t == "shortcut":
                keys = [k.strip().lower() for k in (step.target or step.value or "").split("+") if k.strip()]
                if keys:
                    pg.hotkey(*keys)
                return {"ok": True}
            if t == "scroll":
                amt = int(step.value or "-300")
                pg.scroll(amt)
                return {"ok": True}
            if t == "drag":
                # "x1,y1 -> x2,y2"
                parts = step.target.replace("->", ",").split(",")
                x1, y1, x2, y2 = [int(p.strip()) for p in parts[:4]]
                pg.moveTo(x1, y1); pg.dragTo(x2, y2, duration=0.4)
                return {"ok": True}
            if t == "wait":
                await asyncio.sleep(float(step.value or "1"))
                return {"ok": True}
            if t == "screenshot":
                return {"ok": True, "screenshot": self.screenshot_b64()}
            if t == "extract":
                return {"ok": True, "text": self.ocr()}
            if t == "open_app":
                _open_application(step.target)
                return {"ok": True}
            return {"ok": False, "error": f"Unsupported desktop step: {t}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}


class BrowserExecutor:
    """Lazy Playwright wrapper. Browser launches on first use."""

    def __init__(self):
        self._pw = None
        self._browser = None
        self._page = None

    async def _ensure(self):
        if self._page:
            return
        from playwright.async_api import async_playwright  # type: ignore
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=False)
        self._page = await self._browser.new_page()

    async def screenshot_b64(self) -> Optional[str]:
        if not self._page:
            return None
        png = await self._page.screenshot(full_page=False, type="jpeg", quality=55)
        return base64.b64encode(png).decode("ascii")

    async def run_step(self, step: WorkflowStep) -> dict:
        try:
            await self._ensure()
            page = self._page
            assert page is not None
            t = step.type
            if t == "navigate":
                await page.goto(step.target, wait_until="domcontentloaded")
                return {"ok": True, "screenshot": await self.screenshot_b64()}
            if t == "click":
                await page.click(step.target)
                return {"ok": True}
            if t == "type":
                await page.fill(step.target, step.value or "")
                return {"ok": True}
            if t == "extract":
                txt = await page.locator(step.target or "body").inner_text()
                return {"ok": True, "text": txt[:4000]}
            if t == "screenshot":
                return {"ok": True, "screenshot": await self.screenshot_b64()}
            if t == "wait":
                await asyncio.sleep(float(step.value or "1"))
                return {"ok": True}
            if t == "scroll":
                await page.mouse.wheel(0, int(step.value or "400"))
                return {"ok": True}
            return {"ok": False, "error": f"Unsupported browser step: {t}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def close(self):
        try:
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        finally:
            self._pw = self._browser = self._page = None


def _open_application(name: str):
    import subprocess
    sysname = platform.system()
    if sysname == "Darwin":
        subprocess.Popen(["open", "-a", name])
    elif sysname == "Windows":
        subprocess.Popen(["cmd", "/c", "start", "", name], shell=False)
    else:
        subprocess.Popen([name])


desktop = DesktopExecutor()
browser = BrowserExecutor()


# ---- HTTP info endpoint ----------------------------------------------------

@app.get("/info")
async def info():
    return {
        "name": "EchoPilot Agent",
        "version": VERSION,
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "pyautogui": bool(desktop.pg),
        "ocr": _lazy_import("pytesseract") is not None,
    }


# ---- WebSocket protocol ----------------------------------------------------
# Client -> Server messages:
#   {type:"auth", token:"..."}
#   {type:"run", runId, mode, inputs, steps:[...]}
#   {type:"pause"} {type:"resume"} {type:"cancel"}
#   {type:"screenshot"}                      -- one-shot screen capture
#   {type:"step_response", approve:bool}     -- for step-approval mode
#
# Server -> Client messages:
#   {type:"hello", version, platform}
#   {type:"auth_ok"} | {type:"auth_failed"}
#   {type:"run_started", runId, total}
#   {type:"step_started", index, step}
#   {type:"step_done", index, ok, error?, screenshot?, text?}
#   {type:"awaiting_approval", index, step}
#   {type:"run_finished", runId, ok}
#   {type:"log", level, msg}
#   {type:"error", msg}

approval_event: dict[str, asyncio.Event] = {}
approval_result: dict[str, bool] = {}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    await ws.send_json({"type": "hello", "version": VERSION, "platform": platform.platform(), "needs_auth": True})

    authed = False
    sess = Session(ws=ws)
    current_run: Optional[asyncio.Task] = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                await ws.send_json({"type": "error", "msg": "invalid json"})
                continue

            mtype = msg.get("type")

            if not authed:
                if mtype == "auth":
                    if msg.get("token") == PAIRING_TOKEN:
                        authed = True
                        await ws.send_json({"type": "auth_ok"})
                    else:
                        await ws.send_json({"type": "auth_failed"})
                        await ws.close(); return
                else:
                    await ws.send_json({"type": "auth_failed"})
                    await ws.close(); return
                continue

            if mtype == "ping":
                await ws.send_json({"type": "pong"})
            elif mtype == "screenshot":
                await ws.send_json({"type": "screenshot", "data": desktop.screenshot_b64()})
            elif mtype == "pause":
                sess.paused = True
            elif mtype == "resume":
                sess.paused = False
            elif mtype == "cancel":
                sess.cancelled = True
                if current_run: current_run.cancel()
            elif mtype == "step_response":
                ev = approval_event.get(msg.get("runId", ""))
                if ev:
                    approval_result[msg["runId"]] = bool(msg.get("approve"))
                    ev.set()
            elif mtype == "run":
                if current_run and not current_run.done():
                    await ws.send_json({"type": "error", "msg": "another run is already in progress"})
                    continue
                sess.cancelled = False; sess.paused = False
                sess.inputs = msg.get("inputs") or {}
                steps = [WorkflowStep(**s) for s in msg.get("steps", [])]
                run_id = msg.get("runId") or secrets.token_hex(6)
                mode = msg.get("mode", "auto")
                current_run = asyncio.create_task(_execute_run(sess, run_id, mode, steps))
            else:
                await ws.send_json({"type": "error", "msg": f"unknown message: {mtype}"})

    except WebSocketDisconnect:
        if current_run: current_run.cancel()
    finally:
        await browser.close()


async def _execute_run(sess: Session, run_id: str, mode: str, steps: list[WorkflowStep]):
    ws = sess.ws
    await ws.send_json({"type": "run_started", "runId": run_id, "total": len(steps)})
    ok_all = True
    for i, step in enumerate(steps):
        if sess.cancelled:
            await ws.send_json({"type": "log", "level": "warn", "msg": "Run cancelled by user"})
            ok_all = False; break
        while sess.paused and not sess.cancelled:
            await asyncio.sleep(0.2)

        # Resolve {{var}} placeholders from inputs
        step = _resolve_vars(step, sess.inputs)

        # Step approval
        if mode == "step":
            ev = asyncio.Event()
            approval_event[run_id] = ev
            await ws.send_json({"type": "awaiting_approval", "index": i, "step": step.model_dump()})
            try:
                await asyncio.wait_for(ev.wait(), timeout=300)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "log", "level": "warn", "msg": "Approval timed out"})
                ok_all = False; break
            approved = approval_result.pop(run_id, False)
            approval_event.pop(run_id, None)
            if not approved:
                await ws.send_json({"type": "log", "level": "warn", "msg": f"Step {i+1} rejected"})
                ok_all = False; break

        await ws.send_json({"type": "step_started", "index": i, "step": step.model_dump()})

        is_browser = step.type == "navigate" or (step.target or "").startswith(("http://", "https://", "css=", "text=", "//"))
        executor = browser if is_browser else desktop
        result = await executor.run_step(step) if asyncio.iscoroutinefunction(executor.run_step) else executor.run_step(step)
        if asyncio.iscoroutine(result):
            result = await result

        await ws.send_json({"type": "step_done", "index": i, **result})
        if not result.get("ok"):
            ok_all = False
            await ws.send_json({"type": "log", "level": "error", "msg": f"Step {i+1} failed: {result.get('error')}"})
            break

    await ws.send_json({"type": "run_finished", "runId": run_id, "ok": ok_all})


def _resolve_vars(step: WorkflowStep, inputs: dict) -> WorkflowStep:
    def sub(s: Optional[str]) -> Optional[str]:
        if not s or "{{" not in s: return s
        out = s
        for k, v in inputs.items():
            out = out.replace("{{" + k + "}}", str(v))
        return out
    return step.model_copy(update={"target": sub(step.target) or "", "value": sub(step.value)})


# ---- Entrypoint ------------------------------------------------------------

def main():
    import uvicorn
    print("=" * 60)
    print(f" EchoPilot Desktop Agent v{VERSION}")
    print(f" Listening on   ws://{HOST}:{PORT}/ws")
    print(f" Pairing token  {PAIRING_TOKEN}")
    print(" Open the EchoPilot web app -> Settings -> Connect Agent")
    print(" Paste the token above to pair this machine.")
    print("=" * 60)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
