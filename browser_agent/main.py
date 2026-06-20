# ───────────────────────────────────────────────────────────────────────────
# ShareTeacher — browser_agent sidecar.
#
# A FastAPI service that drives browser-use (0.13.x, 100% CDP, no Playwright)
# against an EXISTING Kernel cloud browser over its CDP websocket url. The Next
# app starts a Kernel browser (persistent profile), then POSTs the CDP url here;
# this sidecar attaches with Browser(cdp_url=..., is_local=False, keep_alive=True)
# so it NEVER spawns or closes the Kernel browser — Kernel owns the lifecycle and
# saves the persistent profile (so the human ChatGPT login survives).
#
# The src/integrations/browser controller in the Next app proxies every method
# to the endpoints below. Open-ended goals (/task) run browser-use's LLM agent;
# /open, /click, /type, /observe, /screenshot are bounded actions on the same
# remote browser. Navigation is constrained by the lesson allowlist passed to
# /session (allowed_domains) as well as enforced again on the Next side.
#
# Run (local):
#   cd browser_agent && python3.11 -m venv .venv && . .venv/bin/activate
#   pip install -r requirements.txt
#   set -a && . ../.env.local && set +a
#   uvicorn main:app --host 127.0.0.1 --port 8700
# ───────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import os
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

# browser-use top-level API. Importing here means the service requires the
# package to start — that is intentional for a real-only sidecar.
from browser_use import Agent, Browser, ChatOpenAI


# ── per-session browser handle ──────────────────────────────────────────────
# One Kernel browser per sessionId. A per-handle asyncio.Lock serializes agent
# runs: two concurrent Agent.run() on the same CDP target would conflict.


class Handle:
    def __init__(self, browser: "Browser") -> None:
        self.browser = browser
        self.lock = asyncio.Lock()


SESSIONS: dict[str, Handle] = {}


# ── request models ──────────────────────────────────────────────────────────


class SessionReq(BaseModel):
    cdpUrl: str
    sessionId: str = "default"
    allowedDomains: Optional[list[str]] = None


class OpenReq(BaseModel):
    sessionId: str = "default"
    url: str
    navTimeout: float = 15.0


class ClickReq(BaseModel):
    sessionId: str = "default"
    instruction: str


class TypeReq(BaseModel):
    sessionId: str = "default"
    text: str = ""


class TaskReq(BaseModel):
    sessionId: str = "default"
    goal: str
    maxSteps: int = 25


class StopReq(BaseModel):
    sessionId: str = "default"


# ── helpers ─────────────────────────────────────────────────────────────────


def _llm() -> "ChatOpenAI":
    # Uses OPENAI_API_KEY from the environment (loaded from ../.env.local).
    return ChatOpenAI(model=os.getenv("BROWSER_AGENT_MODEL", "gpt-4.1-mini"))


def _handle(session_id: str) -> Handle:
    handle = SESSIONS.get(session_id)
    if handle is None:
        raise HTTPException(
            status_code=404,
            detail=f"No browser session '{session_id}'. POST /session first.",
        )
    return handle


async def _run_agent(handle: Handle, task: str, max_steps: int) -> Any:
    agent = Agent(task=task, llm=_llm(), browser=handle.browser)
    return await agent.run(max_steps=max_steps)


def _node_text(node: Any) -> str:
    """Best-effort, version-tolerant text for a browser-use DOM node."""
    for meth in (
        "get_all_children_text",
        "get_all_text_till_next_clickable_element",
    ):
        fn = getattr(node, meth, None)
        if callable(fn):
            try:
                value = fn()
                if value:
                    return str(value).strip()
            except Exception:
                pass
    attrs = getattr(node, "attributes", None)
    if isinstance(attrs, dict):
        for key in ("aria-label", "placeholder", "name", "value", "title"):
            value = attrs.get(key)
            if value:
                return str(value).strip()
    node_value = getattr(node, "node_value", None)
    return str(node_value).strip() if node_value else ""


def _node_role(node: Any) -> str:
    return (
        getattr(node, "tag_name", None)
        or getattr(node, "node_name", None)
        or "element"
    )


# ── app ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="ShareTeacher browser_agent", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "sessions": list(SESSIONS.keys())}


@app.post("/session")
async def create_session(req: SessionReq) -> dict[str, Any]:
    # Replace any prior handle for this sid (detach only — keep_alive means the
    # Kernel browser stays up; we never close it).
    prior = SESSIONS.pop(req.sessionId, None)
    if prior is not None:
        try:
            await prior.browser.stop()
        except Exception:
            pass

    browser = Browser(
        cdp_url=req.cdpUrl,
        is_local=False,
        keep_alive=True,
        allowed_domains=req.allowedDomains or None,
    )
    await browser.start()
    SESSIONS[req.sessionId] = Handle(browser)
    return {"ok": True, "sessionId": req.sessionId}


@app.post("/open")
async def open_url(req: OpenReq) -> dict[str, Any]:
    # FAST navigate: a direct CDP `Page.navigate` resolves on COMMIT (sub-second)
    # rather than waiting for the full `load` lifecycle, so /open returns almost
    # immediately and the always-on screenshot stream shows the page filling in.
    # Falls back to the full-load event path, then an agent, if CDP nav fails.
    handle = _handle(req.sessionId)
    async with handle.lock:
        try:
            cdp = await handle.browser.get_or_create_cdp_session(focus=True)
            nav = await asyncio.wait_for(
                cdp.cdp_client.send.Page.navigate(
                    params={"url": req.url, "transitionType": "address_bar"},
                    session_id=cdp.session_id,
                ),
                timeout=req.navTimeout,
            )
            if nav and nav.get("errorText"):
                raise RuntimeError(nav["errorText"])
        except Exception:
            try:
                # Full-load navigation via the standard event system.
                await handle.browser.navigate_to(req.url)
            except Exception:
                # Last resort: let the agent open it.
                await _run_agent(handle, f"Open the URL {req.url}", max_steps=4)
    return {"ok": True, "url": req.url}


@app.get("/observe")
async def observe(sessionId: str = "default") -> dict[str, Any]:
    handle = _handle(sessionId)
    async with handle.lock:
        state = await handle.browser.get_browser_state_summary()

    elements: list[dict[str, str]] = []
    selector_map = getattr(state, "selector_map", {}) or {}
    for idx, node in list(selector_map.items())[:40]:
        text = _node_text(node)
        if text:
            elements.append(
                {"ref": str(idx), "role": _node_role(node), "text": text[:80]}
            )

    url = getattr(state, "url", "") or ""
    title = getattr(state, "title", "") or ""

    page_text = ""
    for attr in ("page_text", "text"):
        value = getattr(state, attr, None)
        if isinstance(value, str) and value:
            page_text = value
            break
    if not page_text:
        page_text = "\n".join(e["text"] for e in elements)

    return {
        "url": url,
        "title": title,
        "elements": elements,
        "text": page_text[:8000],
    }


@app.post("/click")
async def click(req: ClickReq) -> dict[str, Any]:
    handle = _handle(req.sessionId)
    async with handle.lock:
        await _run_agent(
            handle,
            f"Click the element described as: {req.instruction}. "
            "Do nothing else and do not navigate away.",
            max_steps=4,
        )
    return {"ok": True, "instruction": req.instruction}


@app.post("/type")
async def type_text(req: TypeReq) -> dict[str, Any]:
    handle = _handle(req.sessionId)
    async with handle.lock:
        await _run_agent(
            handle,
            "Type the following text into the most relevant text input on the "
            "current page. Do NOT press Enter and do NOT submit the form. "
            f"Text to type: {req.text!r}",
            max_steps=4,
        )
    return {"ok": True}


@app.post("/task")
async def task(req: TaskReq) -> dict[str, Any]:
    handle = _handle(req.sessionId)
    async with handle.lock:
        history = await _run_agent(handle, req.goal, req.maxSteps)

    ok = history.is_successful()
    if ok is None:
        ok = bool(history.is_done())
    return {
        "ok": bool(ok),
        "summary": history.final_result() or "(no result)",
        "done": bool(history.is_done()),
        "steps": len(history.history),
        "urls": history.urls(),
    }


@app.get("/screenshot")
async def screenshot(sessionId: str = "default") -> dict[str, Any]:
    handle = _handle(sessionId)
    async with handle.lock:
        from browser_use.browser.events import ScreenshotEvent

        event = handle.browser.event_bus.dispatch(
            ScreenshotEvent(full_page=False)
        )
        await event
        b64 = await event.event_result(raise_if_any=True, raise_if_none=True)
    return {"dataUrl": f"data:image/png;base64,{b64}"}


@app.get("/frame")
async def frame(sessionId: str = "default", quality: int = 50) -> Response:
    # Lock-free JPEG frame for the always-on screenshot stream. Deliberately does
    # NOT take handle.lock so frames keep flowing during a long /task agent run
    # (cdp_use multiplexes by message id, so a concurrent captureScreenshot is
    # safe in steady state). A transient failure during a tab/target switch just
    # returns 503 and the client keeps showing the previous frame.
    handle = _handle(sessionId)
    try:
        shot = await handle.browser.take_screenshot(format="jpeg", quality=quality)
    except Exception as exc:  # noqa: BLE001 — degrade, never 500
        raise HTTPException(status_code=503, detail=f"frame capture failed: {exc}")
    if isinstance(shot, str):
        # Some browser-use builds may hand back base64 text; normalise to bytes.
        import base64

        shot = base64.b64decode(shot)
    return Response(
        content=shot,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/stop")
async def stop(req: StopReq) -> dict[str, Any]:
    handle = SESSIONS.pop(req.sessionId, None)
    if handle is not None:
        try:
            # keep_alive=True => this detaches the CDP client only; the Kernel
            # browser stays up so its persistent profile (ChatGPT login) is
            # saved when the Next/Kernel runtime DELETEs the browser.
            await handle.browser.stop()
        except Exception:
            pass
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("BROWSER_AGENT_HOST", "127.0.0.1"),
        port=int(os.getenv("BROWSER_AGENT_PORT", "8700")),
    )
