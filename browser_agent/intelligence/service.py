# ───────────────────────────────────────────────────────────────────────────
# ShareTeacher intelligence — FastAPI surface (/direct, /pilot, /compose).
#
# This is the per-turn CONTRACT between the Next orchestrator and the DSPy
# brain. The orchestrator becomes director-driven: each turn it POSTs /direct
# with the lesson goal + current screen summary + last student message + a short
# history, and gets back { narration, ui_action }. It then executes the single
# ui_action through its existing tool registry / StageEvent emitters, feeds the
# narration to the avatar as grounded context, and loops — bounded by max turns,
# checkpoints, human takeover, and the director's own `done` action.
#
# /pilot delegates an open-ended browser goal to BrowserPilot (ReAct). The CDP
# tool closures are injected by main.py (the BrowserPilot / RESEARCH B track);
# this module exposes the route and request/response shapes.
#
# Mounted by main.py via:  app.include_router(intelligence.router)
# ───────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .programs import (
    PromptComposer,
    ScreenInterpreter,
    TeachingDirector,
    configure_lm,
)
from .signatures import SalientElement, UiAction

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

# Modules are stateless and cheap to hold for the process lifetime.
_LM_READY = False
_director = TeachingDirector()
_interpreter = ScreenInterpreter()
_composer = PromptComposer()

# main.py injects async runners that bind these routes to the live CDP browser
# (it owns the per-session Handle + lock). The brain stays browser-agnostic; the
# sidecar provides the hands.
#
#   pilot_runner(session_id, goal, allowlist) -> {outcome, success, steps, result}
#   observe_runner(session_id)                -> {url, title, elements, text}
PilotRunner = Callable[[str, str, List[str]], Awaitable[Dict[str, Any]]]
ObserveRunner = Callable[[str], Awaitable[Dict[str, Any]]]
_pilot_runner: Optional[PilotRunner] = None
_observe_runner: Optional[ObserveRunner] = None


def set_pilot_runner(fn: PilotRunner) -> None:
    """main.py calls this once it has wired the CDP-backed BrowserPilot tools."""
    global _pilot_runner
    _pilot_runner = fn


def set_observe_runner(fn: ObserveRunner) -> None:
    """main.py calls this to let /interpret read the live page (observe)."""
    global _observe_runner
    _observe_runner = fn


def _ensure_lm() -> None:
    global _LM_READY
    if not _LM_READY:
        configure_lm()
        _LM_READY = True


# ── /direct request + response (the per-turn orchestration contract) ─────────


class LessonCtx(BaseModel):
    id: str
    title: str = ""
    goal: str
    knowledge_base: str = ""
    # Milestones/beats — guidance, NOT rigid steps. The director picks moves.
    curriculum: List[str] = Field(default_factory=list)


class ScreenCtx(BaseModel):
    url: str = ""
    title: str = ""
    # If `summary` is provided the director uses it as-is; otherwise the service
    # runs ScreenInterpreter over `text` + `elements` to produce one.
    summary: Optional[str] = None
    elements: List[Dict[str, Any]] = Field(default_factory=list)
    text: str = ""
    # Optional base64 frame; reserved for a future vision interpreter. Omitted
    # by default to keep the request small.
    screenshot: Optional[str] = None


class Turn(BaseModel):
    role: str  # "teacher" | "student" | "action"
    text: str


class DirectConstraints(BaseModel):
    allowlist: List[str] = Field(default_factory=list)
    turn_budget_remaining: int = 40
    # From the speech-research track: whether GWM-1 can actually speak text.
    # If false, narration is screen/transcript + sendContext grounding only.
    can_speak: bool = False


class DirectRequest(BaseModel):
    session_id: str
    turn: int = 0
    lesson: LessonCtx
    screen: ScreenCtx = Field(default_factory=ScreenCtx)
    student_message: str = ""
    history: List[Turn] = Field(default_factory=list)
    constraints: DirectConstraints = Field(default_factory=DirectConstraints)


class DirectResponse(BaseModel):
    narration: str
    ui_action: UiAction
    screen_summary: str
    salient_elements: List[SalientElement] = Field(default_factory=list)
    milestone: str = ""
    done: bool = False


def _format_history(history: List[Turn], limit: int = 12) -> str:
    recent = history[-limit:]
    return "\n".join(f"{t.role}: {t.text}" for t in recent) if recent else "(none)"


def _format_elements(elements: List[Dict[str, Any]], limit: int = 12) -> str:
    rows = []
    for e in elements[:limit]:
        ref = e.get("ref", "?")
        role = e.get("role", "element")
        text = str(e.get("text", ""))[:80]
        rows.append(f"[{ref}] {role}: {text}")
    return "\n".join(rows) if rows else "(none)"


@router.post("/direct", response_model=DirectResponse)
async def direct(req: DirectRequest) -> DirectResponse:
    """One director turn: choose narration + a single ui_action."""
    _ensure_lm()

    # 1) Ensure a screen summary. Use the caller's if present; else interpret.
    summary = req.screen.summary or ""
    salient: List[SalientElement] = []
    if not summary and (req.screen.text or req.screen.elements):
        view = await _interpreter.acall(
            url=req.screen.url,
            title=req.screen.title,
            page_text=req.screen.text,
            elements=req.screen.elements,
        )
        summary = view.summary
        salient = list(view.salient_elements)
    if not summary:
        summary = f"(no page loaded yet; url={req.screen.url or 'about:blank'})"

    salient_text = (
        "\n".join(f"[{e.ref}] {e.role}: {e.text}" for e in salient)
        if salient
        else _format_elements(req.screen.elements)
    )

    # 2) Direct.
    pred = await _director.acall(
        lesson_goal=req.lesson.goal,
        lesson_knowledge=req.lesson.knowledge_base,
        curriculum="\n".join(f"- {b}" for b in req.lesson.curriculum) or "(open)",
        screen_summary=summary,
        salient_elements=salient_text,
        student_message=req.student_message,
        history=_format_history(req.history),
        allowlist=req.constraints.allowlist,
        can_speak=req.constraints.can_speak,
        turns_remaining=req.constraints.turn_budget_remaining,
    )

    action: UiAction = pred.ui_action
    return DirectResponse(
        narration=pred.narration,
        ui_action=action,
        screen_summary=summary,
        salient_elements=salient,
        milestone=getattr(pred, "milestone", "") or "",
        done=(action.tool == "done"),
    )


# ── /compose (PromptComposer) ────────────────────────────────────────────────


class ComposeRequest(BaseModel):
    task: str
    topic: str
    audience: str = ""
    tone: str = ""
    constraints: str = ""


class ComposeResponse(BaseModel):
    prompt: str
    notes: str = ""


@router.post("/compose", response_model=ComposeResponse)
async def compose(req: ComposeRequest) -> ComposeResponse:
    _ensure_lm()
    pred = await _composer.acall(
        task=req.task,
        topic=req.topic,
        audience=req.audience,
        tone=req.tone,
        constraints=req.constraints,
    )
    return ComposeResponse(prompt=pred.prompt, notes=getattr(pred, "notes", "") or "")


# ── /interpret (ScreenInterpreter over the LIVE page) ─────────────────────────


class InterpretRequest(BaseModel):
    session_id: str = "default"


class InterpretResponse(BaseModel):
    url: str = ""
    title: str = ""
    summary: str
    elements: List[SalientElement] = Field(default_factory=list)
    screen_state: str = ""


@router.post("/interpret", response_model=InterpretResponse)
async def interpret(req: InterpretRequest) -> InterpretResponse:
    """Observe the live page, then summarize it for the teacher."""
    _ensure_lm()
    if _observe_runner is None:
        raise HTTPException(
            status_code=503,
            detail="Live observe not wired (call set_observe_runner).",
        )
    obs = await _observe_runner(req.session_id)
    url = str(obs.get("url", "") or "")
    title = str(obs.get("title", "") or "")
    elements = obs.get("elements") or []
    text = str(obs.get("text", "") or "")

    # The LM call is async; we call it directly.
    view = await _interpreter.acall(
        url=url,
        title=title,
        page_text=text,
        elements=elements,
    )
    return InterpretResponse(
        url=url,
        title=title,
        summary=view.summary,
        elements=list(view.salient_elements),
        screen_state=getattr(view, "screen_state", "") or "",
    )


# ── /pilot (BrowserPilot, open-ended browser goal) ───────────────────────────


class PilotRequest(BaseModel):
    session_id: str = "default"
    goal: str
    allowlist: List[str] = Field(default_factory=list)


class PilotResponse(BaseModel):
    ok: bool
    summary: str
    steps: int = 0
    result: str = ""
    # `outcome` mirrors `summary` for callers wired to the earlier contract.
    outcome: str = ""


@router.post("/pilot", response_model=PilotResponse)
async def pilot(req: PilotRequest) -> PilotResponse:
    _ensure_lm()
    if _pilot_runner is None:
        raise HTTPException(
            status_code=503,
            detail="BrowserPilot CDP tools not wired (call set_pilot_runner).",
        )
    result = await _pilot_runner(req.session_id, req.goal, req.allowlist)
    summary = str(result.get("outcome", "") or result.get("summary", ""))
    return PilotResponse(
        ok=bool(result.get("success", result.get("ok", False))),
        summary=summary,
        steps=int(result.get("steps", 0) or 0),
        result=str(result.get("result", "") or ""),
        outcome=summary,
    )
