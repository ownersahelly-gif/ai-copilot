# EchoPilot Desktop Agent

A local Python sidecar that lets the EchoPilot web app actually control your
desktop (mouse, keyboard, screen, OCR) and the browser (Playwright).

The agent runs **on your own machine**. The web app talks to it over a
WebSocket on `ws://localhost:8765/ws`. Nothing about your screen ever leaves
your machine — only the workflow steps come down, and only the live status /
screenshots go back up to your browser tab.

## Install

```bash
cd python-agent
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium        # only if you'll use browser steps
```

### macOS extra step
Grant **Accessibility** and **Screen Recording** permission to your terminal:
*System Settings → Privacy & Security → Accessibility / Screen Recording*.
Otherwise PyAutoGUI cannot move the mouse and `mss` cannot capture the screen.

### Windows
Run the terminal as a normal user. No extra permissions needed.

### Linux (X11 only)
PyAutoGUI requires `python3-tk` and an X server. Wayland is not supported.

## Run

```bash
python agent.py
```

The agent prints a one-time pairing token like:

```
 Pairing token  Xj3-K91pQ
```

Then in the EchoPilot web app go to **Settings → Connect Agent**, paste the
token and click *Connect*. Status turns green and workflows now execute on
your machine instead of the simulator.

## Supported step types

| Type         | Target / Value                                     | Backend     |
|--------------|----------------------------------------------------|-------------|
| `click`      | `"x,y"` coordinates, or empty for current pointer  | desktop     |
| `type`       | `value` = text to type                             | desktop     |
| `shortcut`   | `target` = `"ctrl+c"` / `"cmd+space"`              | desktop     |
| `scroll`     | `value` = pixels (negative = down)                 | desktop     |
| `drag`       | `target` = `"x1,y1 -> x2,y2"`                      | desktop     |
| `screenshot` | —                                                  | desktop     |
| `extract`    | OCR of full screen (or CSS selector if browser)    | both        |
| `wait`       | `value` = seconds                                  | both        |
| `open_app`   | `target` = app name (e.g. `"Slack"`)               | desktop     |
| `navigate`   | `target` = URL                                     | browser     |

A step is routed to the **browser** executor when `type == "navigate"` or its
`target` looks like a URL / CSS selector / XPath; everything else goes to the
**desktop** executor.

## Environment variables

| Var                  | Default        | Notes                          |
|----------------------|----------------|--------------------------------|
| `ECHOPILOT_HOST`     | `127.0.0.1`    | bind address                   |
| `ECHOPILOT_PORT`     | `8765`         | TCP port                       |
| `ECHOPILOT_TOKEN`    | random         | force a fixed pairing token    |
| `ECHOPILOT_ORIGINS`  | lovable + lh   | CORS origins (comma-sep)       |

## Safety

- The agent only listens on `127.0.0.1` by default.
- Every connection must present the pairing token printed in your terminal.
- PyAutoGUI's failsafe is on: slam your mouse to a screen corner to abort.
- Use **Step approval** mode in the web app to confirm each action.
