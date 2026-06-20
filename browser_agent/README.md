# browser_agent — ShareTeacher browser-use sidecar

A standalone **FastAPI** service that drives [`browser-use`](https://github.com/browser-use/browser-use)
`0.13.x` against an **existing Kernel cloud browser** over its CDP websocket url.

It is the real implementation behind `src/integrations/browser` (Organ 4). The
Next app never launches a browser itself: it starts a Kernel browser (with the
persistent profile), then calls this sidecar over HTTP at `BROWSER_AGENT_URL`.

## Why a separate Python process

`browser-use` is Python. `0.13.x` dropped Playwright entirely and is **100% CDP**,
so the sidecar is lightweight: it *attaches* to the remote Kernel browser, it does
not spawn or bundle Chromium.

It attaches with:

```python
browser = Browser(cdp_url=cdpUrl, is_local=False, keep_alive=True,
                  allowed_domains=allowed or None)
await browser.start()
```

- `cdp_url=` tells browser-use to **attach** instead of spawn.
- `is_local=False` marks the browser as remote (affects downloads handling).
- `keep_alive=True` means stopping the agent/sidecar does **not** close the
  Kernel browser — Kernel owns the lifecycle and saves the persistent profile
  (so the human ChatGPT login survives across sessions).
- `allowed_domains=` enforces the lesson allowlist for the agent.

## Endpoints

The Next controller (`src/integrations/browser/real.ts`) maps 1:1 to these:

| Method & path             | Controller call        | Notes |
|---------------------------|------------------------|-------|
| `GET  /health`            | —                      | `{ ok, sessions }` |
| `POST /session`           | `attach(info)`         | `{ cdpUrl, sessionId, allowedDomains }` → attaches browser-use |
| `POST /open`              | `open(url)`            | navigates (event bus; agent fallback) |
| `GET  /observe`           | `observe()`            | `?sessionId=` → `{ url, title, elements[], text }` |
| `POST /click`             | `click(instruction)`   | bounded agent click |
| `POST /type`              | `type(text)`           | bounded agent type, never submits |
| `POST /task`              | `task(goal)`           | full browser-use agent run → `{ ok, summary, ... }` |
| `GET  /screenshot`        | `screenshot()`         | `?sessionId=` → `{ dataUrl }` (PNG data URL) |
| `POST /stop`              | `stop()`               | detaches CDP only (Kernel browser stays up) |

`takeoverUrl()` does **not** hit the sidecar — the Next controller returns the
Kernel live-view URL it already holds from `attach()`.

`open`, `observe`, and `screenshot` use browser-use's CDP event bus /
`get_browser_state_summary()`. `click`, `type`, and `task` run the browser-use
**Agent** (LLM-driven) — `click`/`type` are bounded to a few steps so they behave
like deterministic actions, while `task` is the full open-ended run.

A per-session `asyncio.Lock` serializes agent runs on a single CDP target.

## Run (local dev)

```bash
cd browser_agent
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
# load OPENAI_API_KEY (+ optional BROWSER_AGENT_MODEL/PORT) from the app env:
set -a && . ../.env.local && set +a
uvicorn main:app --host 127.0.0.1 --port 8700
```

## Run (docker compose)

From the repo root (the service is defined in `../docker-compose.yml`):

```bash
docker compose up -d browser_agent
```

## Environment

| Var                  | Default          | Purpose |
|----------------------|------------------|---------|
| `OPENAI_API_KEY`     | —                | browser-use LLM (required for click/type/task) |
| `BROWSER_AGENT_MODEL`| `gpt-4.1-mini`   | OpenAI model for the agent |
| `BROWSER_AGENT_HOST` | `127.0.0.1`      | bind host (compose uses `0.0.0.0`) |
| `BROWSER_AGENT_PORT` | `8700`           | bind port (must match the app's `BROWSER_AGENT_URL`) |

## Operational notes

This is a third long-running process next to Next.js and Postgres. A live lesson
legitimately needs Kernel + OpenAI + a human (first ChatGPT login via the Kernel
live view, a mic, and a public tunnel for Recall). There is no mock.
