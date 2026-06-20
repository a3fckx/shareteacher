# ───────────────────────────────────────────────────────────────────────────
# ShareTeacher intelligence — DSPy Signatures (the DECLARATIVE contract).
#
# This module is the single source of truth for WHAT the brain reasons about.
# It contains ONLY Signatures + the typed payloads they emit. No control flow,
# no LM calls, no optimizers. Modules (programs.py) compose these; the FastAPI
# service (service.py) adapts them to /direct and /pilot.
#
# Three minds + one pilot, all declarative:
#   • ScreenInterpret  — raw page  -> concise summary + salient elements + state
#   • DirectTeaching   — goal + screen + student + history -> narration + ui_action
#   • ComposePrompt    — task/topic/audience -> a strong, reusable prompt
#   • PilotStep        — ReAct signature for the open-ended BrowserPilot
#
# The TeachingDirector returns exactly ONE `ui_action` per turn. The Next
# orchestrator executes it through its existing tool registry / StageEvent
# emitters, so the StageEvent + ToolName contracts are never broken — the brain
# only CHOOSES, the orchestrator ACTS.
# ───────────────────────────────────────────────────────────────────────────

from __future__ import annotations

from typing import Any, Dict, List, Literal, get_args

import dspy
from pydantic import BaseModel, Field

# ── The closed action vocabulary the director may choose from ────────────────
# Every verb maps 1:1 onto an existing orchestrator capability:
#
#   STAGE / OVERLAY  (deterministic StageEvents — emitted server-side, NEVER
#                     waits on GWM-1 to call a tool):
#     caption, highlight, zoom, spotlight, arrow, circle, share_screen,
#     take_control, scroll_to, clear_overlay, show_output, write_prompt
#   BROWSER ACTUATION (drive the shared Kernel browser via the controller —
#                      bounded + allowlist-enforced):
#     navigate (-> browser_open), click (-> browser_click),
#     type (-> browser_type), observe (-> browser_observe),
#     pilot (-> /pilot ReAct, open-ended browser goal)
#   FLOW CONTROL:
#     checkpoint (-> ask_checkpoint, parks the loop for a real human answer),
#     artifact   (-> save_artifact),
#     none       (narrate only, no side effect),
#     done       (end the bounded director loop cleanly)
#
UiTool = Literal[
    # stage / overlay
    "caption",
    "highlight",
    "zoom",
    "spotlight",
    "arrow",
    "circle",
    "share_screen",
    "take_control",
    "scroll_to",
    "clear_overlay",
    "show_output",
    "write_prompt",
    # browser actuation
    "navigate",
    "click",
    "type",
    "observe",
    "pilot",
    # flow control
    "checkpoint",
    "artifact",
    "none",
    "done",
]

# Runtime tuple derived from the Literal so validation can never drift from it.
UI_TOOLS: tuple[str, ...] = get_args(UiTool)

# Verbs that MUST go through the lesson allowlist before the orchestrator acts.
NAVIGATION_TOOLS: frozenset[str] = frozenset({"navigate", "pilot"})

# Verbs that drive the real browser (vs. pure on-stage presentation).
BROWSER_TOOLS: frozenset[str] = frozenset(
    {"navigate", "click", "type", "observe", "pilot"}
)


# ── Typed payloads ───────────────────────────────────────────────────────────


class UiAction(BaseModel):
    """One concrete move the orchestrator executes this turn.

    `args` is an open dict because each tool has its own shape; the orchestrator
    already coerces tool args (str()/asBox()/...) so the brain stays simple and
    the wire format stays stable. Per-tool arg shapes (authoritative):

      caption      {text:str, position?:"top"|"bottom", durationMs?:int}
      highlight    {target?:str, selector?:str, box?:{x,y,w,h}, label?:str}
      zoom         {x,y,w,h:0..1, scale?:1..5, durationMs?:int, reset?:bool}
      spotlight    {x,y,w,h:0..1, label?:str, shape?:"circle"|"rect", durationMs?:int}
      arrow        {x,y:0..1, from?:"left"|"right"|"top"|"bottom"|"auto", label?, durationMs?}
      circle       {x,y,w,h:0..1, shape?:"circle"|"box", color?:"accent"|"good"|"warn"|"bad", label?, durationMs?}
      share_screen {focus:"foreground"|"restore", reason?:str}
      take_control {mode:"full"|"exit", reason?:str}
      scroll_to    {target:str}
      clear_overlay{}
      show_output  {text:str, source?:str}
      write_prompt {text:str, target?:"chatgpt"|"generic"}
      navigate     {url:str}                      # allowlist-enforced
      click        {instruction:str}
      type         {text:str, submit?:bool}
      observe      {}
      pilot        {goal:str, maxSteps?:int}       # allowlist-enforced
      checkpoint   {question:str, choices?:[str]}
      artifact     {kind:str, name:str, text?:str, topic?:str}
      none         {}
      done         {}
    """

    tool: UiTool = Field(description="The single verb to execute this turn.")
    args: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arguments for the chosen tool (see per-tool shapes).",
    )
    rationale: str = Field(
        default="",
        description="One short clause on WHY this move, for the trace log.",
    )


class SalientElement(BaseModel):
    """An interactive element worth referencing or acting on."""

    ref: str = Field(description="Stable element ref/index from the page.")
    role: str = Field(description="Tag/role, e.g. textarea, button, link.")
    text: str = Field(description="Short visible label/text (<= 80 chars).")


ScreenState = Literal[
    "idle",
    "loading",
    "input_ready",
    "generating",
    "result_ready",
    "login_required",
    "error",
    "unknown",
]


# ── Signatures ───────────────────────────────────────────────────────────────


class ScreenInterpret(dspy.Signature):
    """Summarize a raw browser page for a teacher who is narrating it live.

    Turn noisy page text + element refs into a tight, classroom-ready picture:
    what the page IS, what just happened, and the few elements that matter for
    the next teaching move. Be concrete and brief; never invent UI that is not
    in the inputs.
    """

    url: str = dspy.InputField(desc="Current page URL.")
    title: str = dspy.InputField(desc="Current page title.")
    page_text: str = dspy.InputField(desc="Raw, possibly long page text.")
    elements_json: str = dspy.InputField(
        desc="JSON array of {ref,role,text} candidate interactive elements."
    )

    summary: str = dspy.OutputField(
        desc="2-4 plain sentences: what this page is and its current state."
    )
    salient_elements: List[SalientElement] = dspy.OutputField(
        desc="<= 6 elements most relevant to the next action, most useful first."
    )
    screen_state: ScreenState = dspy.OutputField(
        desc="Coarse state of the page for the director to branch on."
    )


class DirectTeaching(dspy.Signature):
    """You are the live teaching director of a real shared browser class.

    Decide the SINGLE best next move toward the lesson goal, then narrate it in
    the teacher's warm, concise voice. The lesson goal + curriculum are the
    destination and the milestones — NOT a rigid script: pick whatever move best
    advances the learner right now given what is on screen and what they just
    said. Prefer to SHOW: drive the real browser (navigate/type/click/observe),
    and use stage overlays (zoom/spotlight/arrow/circle/caption) to direct the
    class's eyes. Ask a `checkpoint` only when a genuine fork needs the learner.
    Return `done` when the lesson goal is demonstrably achieved.

    Constraints you MUST respect:
      • Choose `tool` ONLY from the allowed vocabulary.
      • `navigate`/`pilot` URLs must stay within `allowlist`.
      • If `can_speak` is false the avatar cannot read `narration` aloud, so it
        is screen/transcript text + grounding context only — still write it well.
      • Keep momentum: one decisive move per turn, no stalling, no repetition.
    """

    lesson_goal: str = dspy.InputField(desc="What the learner should be able to do.")
    lesson_knowledge: str = dspy.InputField(
        desc="Key facts/principles the teacher should weave in."
    )
    curriculum: str = dspy.InputField(
        desc="Ordered milestones/beats for this lesson (guidance, not steps)."
    )
    screen_summary: str = dspy.InputField(
        desc="ScreenInterpreter's summary of the current page."
    )
    salient_elements: str = dspy.InputField(
        desc="Compact list of the page's actionable elements."
    )
    student_message: str = dspy.InputField(
        desc="The learner's most recent message/question (may be empty)."
    )
    history: str = dspy.InputField(
        desc="Recent turns: teacher narration, student turns, and actions taken."
    )
    allowlist: str = dspy.InputField(
        desc="Comma-separated domains the browser may visit."
    )
    can_speak: bool = dspy.InputField(
        desc="Whether the live avatar can speak narration aloud."
    )
    turns_remaining: int = dspy.InputField(
        desc="Director turns left before the loop is force-ended."
    )

    narration: str = dspy.OutputField(
        desc="What the teacher says now: 1-3 short, warm, concrete sentences."
    )
    ui_action: UiAction = dspy.OutputField(
        desc="The one move to execute this turn (tool + args)."
    )
    milestone: str = dspy.OutputField(
        desc="Short label of the curriculum beat now in progress."
    )


class ComposePrompt(dspy.Signature):
    """Compose ONE strong, reusable prompt for an AI tool (e.g. ChatGPT).

    Encode the craft the lesson teaches: name the ROLE, the AUDIENCE, the
    explicit scope (e.g. slide count / length), and the TONE; prefer concrete
    constraints and examples over vague asks. The result must be copy-paste
    ready and generalize to other topics by swapping the subject.
    """

    task: str = dspy.InputField(desc="What artifact the prompt should produce.")
    topic: str = dspy.InputField(desc="Subject matter.")
    audience: str = dspy.InputField(desc="Who the output is for.")
    tone: str = dspy.InputField(desc="Desired voice/tone (may be empty).")
    constraints: str = dspy.InputField(
        desc="Hard requirements (counts, format, must-haves); may be empty."
    )

    prompt: str = dspy.OutputField(desc="The finished, copy-paste-ready prompt.")
    notes: str = dspy.OutputField(
        desc="1-2 sentences on WHY it is strong — for the teacher to narrate."
    )


class PilotStep(dspy.Signature):
    """Drive the shared browser to accomplish an open-ended goal.

    Used by BrowserPilot (a ReAct module) whose tools are CDP-backed closures
    that reuse the existing browser-use / cdp_use connection (navigate, read the
    screen, click a ref, type text, scroll). Take the fewest actions that
    achieve the goal, stay on the allowed domains, and stop as soon as the goal
    is met. Never log in, never leave the allowlist.
    """

    goal: str = dspy.InputField(desc="The open-ended browser goal to achieve.")
    page_state: str = dspy.InputField(desc="Current screen summary + elements.")
    allowlist: str = dspy.InputField(desc="Domains the browser may visit.")

    outcome: str = dspy.OutputField(desc="Concise result of what was achieved.")
    success: bool = dspy.OutputField(desc="True if the goal was met.")
