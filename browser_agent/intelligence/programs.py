# ───────────────────────────────────────────────────────────────────────────
# ShareTeacher intelligence — DSPy Modules (the DECLARATIVE brain).
#
# Thin, readable wrappers over the Signatures in signatures.py. Each Module is
# a dspy.Module composing exactly one reasoning primitive:
#
#   ScreenInterpreter  = ChainOfThought(ScreenInterpret)
#   TeachingDirector   = ChainOfThought(DirectTeaching)   + action validation
#   PromptComposer     = ChainOfThought(ComposePrompt)
#   BrowserPilot       = ReAct(PilotStep, tools=<CDP closures>)
#
# NO optimizers, NO eval sets, NO few-shot bootstrapping here — this is the
# canonical declarative layer. Optimization (MIPRO/GEPA, metrics, trainsets)
# is a deliberately separate later round and must not leak in.
#
# The OpenAI key comes from the environment (OPENAI_API_KEY, loaded from
# ../.env.local by the sidecar). Secrets never cross to the client.
# ───────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import dspy

# browser-use 0.13.x CDP event classes — used ONLY by the BrowserPilot tools to
# actuate the live Kernel browser (everything else in this module is pure-LM).
# The sidecar always ships browser-use, so a top-level import is safe.
from browser_use.browser.events import (
    ClickElementEvent,
    ScrollToTextEvent,
    SendKeysEvent,
    TypeTextEvent,
)

from .signatures import (
    NAVIGATION_TOOLS,
    UI_TOOLS,
    ComposePrompt,
    DirectTeaching,
    PilotStep,
    SalientElement,
    ScreenInterpret,
    UiAction,
)

# ── LM configuration (declarative, global) ──────────────────────────────────


def configure_lm(model: Optional[str] = None) -> dspy.LM:
    """Build + globally configure the DSPy LM backend (OpenAI).

    Idempotent enough to call once at service startup. Model precedence:
    explicit arg -> DSPY_MODEL -> BROWSER_AGENT_MODEL -> gpt-5-mini-2025-08-07.
    """
    chosen = (
        model
        or os.getenv("DSPY_MODEL")
        or os.getenv("BROWSER_AGENT_MODEL")
        or "gpt-5-mini-2025-08-07"
    )
    # Check if the chosen model is considered an OpenAI reasoning model
    import re
    model_family = chosen.split("/")[-1].lower()
    is_reasoning = re.match(
        r"^(?:o[1345](?:-(?:mini|nano|pro))?(?:-\d{4}-\d{2}-\d{2})?|gpt-5(?!-chat)(?:-.*)?)$",
        model_family,
    )
    if is_reasoning:
        # OpenAI reasoning models require temperature=1.0 or None, and max_tokens >= 16000 or None
        temperature = 1.0
        max_tokens = 16000
    else:
        temperature = float(os.getenv("DSPY_TEMPERATURE", "0.3"))
        max_tokens = int(os.getenv("DSPY_MAX_TOKENS", "1024"))

    # dspy.LM is litellm-backed; "openai/<model>" routes to the OpenAI provider
    # and reads OPENAI_API_KEY from the environment.
    lm = dspy.LM(
        f"openai/{chosen}" if "/" not in chosen else chosen,
        api_key=os.getenv("OPENAI_API_KEY"),
        temperature=temperature,
        max_tokens=max_tokens,
    )
    dspy.configure(lm=lm)
    return lm


# ── Helpers: keep the brain's output safe + on-contract ──────────────────────


def _domain_allowed(url: str, allowlist: List[str]) -> bool:
    """Mirror of the TS guardrail: host == d or endswith('.'+d)."""
    if not allowlist:
        return True
    raw = url.strip()
    host = raw
    if "://" in raw:
        host = raw.split("://", 1)[1]
    host = host.split("/", 1)[0].split(":", 1)[0].lower()
    for d in allowlist:
        d = d.strip().lower()
        if d and (host == d or host.endswith("." + d)):
            return True
    return False


def validate_ui_action(action: UiAction, allowlist: List[str]) -> UiAction:
    """Clamp the model's chosen action onto the closed, safe vocabulary.

    Defence in depth — the orchestrator enforces the allowlist again, but the
    brain should never hand back an out-of-contract or off-allowlist action.
    Anything invalid degrades to a harmless `none` so the class never breaks.
    """
    tool = action.tool
    args = dict(action.args or {})

    if tool not in UI_TOOLS:
        return UiAction(tool="none", args={}, rationale=f"dropped unknown tool {tool!r}")

    if tool in NAVIGATION_TOOLS:
        target = str(args.get("url") or args.get("goal") or "")
        # `pilot` carries a goal, not a URL; only gate when an explicit URL is
        # present. A bare `navigate` with no/blocked URL degrades to `none`.
        if tool == "navigate":
            if not target or not _domain_allowed(target, allowlist):
                return UiAction(
                    tool="none",
                    args={},
                    rationale=f"blocked off-allowlist navigate to {target!r}",
                )
    return UiAction(tool=tool, args=args, rationale=action.rationale)


def _elements_to_text(elements: List[SalientElement]) -> str:
    return "\n".join(f"[{e.ref}] {e.role}: {e.text}" for e in elements)


# ── Modules ──────────────────────────────────────────────────────────────────


class ScreenInterpreter(dspy.Module):
    """raw page -> concise summary + salient elements + coarse state."""

    def __init__(self) -> None:
        super().__init__()
        self.interpret = dspy.ChainOfThought(ScreenInterpret)

    async def aforward(
        self,
        url: str,
        title: str,
        page_text: str,
        elements: Optional[List[Dict[str, Any]]] = None,
    ) -> dspy.Prediction:
        return await self.interpret.acall(
            url=url or "",
            title=title or "",
            page_text=(page_text or "")[:8000],
            elements_json=json.dumps(elements or [])[:6000],
        )


class TeachingDirector(dspy.Module):
    """goal + screen + student + history -> narration + ONE ui_action.

    The canonical brain of the class. Declarative ChainOfThought + a thin
    validation pass so the returned action is always on-contract and on-allowlist.
    """

    def __init__(self) -> None:
        super().__init__()
        self.direct = dspy.ChainOfThought(DirectTeaching)

    async def aforward(
        self,
        lesson_goal: str,
        lesson_knowledge: str,
        curriculum: str,
        screen_summary: str,
        salient_elements: str,
        student_message: str,
        history: str,
        allowlist: List[str],
        can_speak: bool,
        turns_remaining: int,
    ) -> dspy.Prediction:
        pred = await self.direct.acall(
            lesson_goal=lesson_goal,
            lesson_knowledge=lesson_knowledge,
            curriculum=curriculum,
            screen_summary=screen_summary,
            salient_elements=salient_elements,
            student_message=student_message or "",
            history=history,
            allowlist=", ".join(allowlist),
            can_speak=can_speak,
            turns_remaining=turns_remaining,
        )
        # Force-end if the turn budget is exhausted, regardless of the model.
        if turns_remaining <= 0:
            pred.ui_action = UiAction(
                tool="done", args={}, rationale="turn budget exhausted"
            )
        else:
            pred.ui_action = validate_ui_action(pred.ui_action, allowlist)
        return pred


class PromptComposer(dspy.Module):
    """task/topic/audience -> a strong, copy-paste-ready prompt + why."""

    def __init__(self) -> None:
        super().__init__()
        self.compose = dspy.ChainOfThought(ComposePrompt)

    async def aforward(
        self,
        task: str,
        topic: str,
        audience: str = "",
        tone: str = "",
        constraints: str = "",
    ) -> dspy.Prediction:
        return await self.compose.acall(
            task=task,
            topic=topic,
            audience=audience,
            tone=tone,
            constraints=constraints,
        )


# ── CDP-backed browser actuation (the BrowserPilot's hands) ──────────────────
# These reuse the EXISTING attached browser-use BrowserSession (handle.browser in
# main.py) — they never construct a new Browser, so they share the one CDP socket
# already connected to the Kernel cloud browser. Every mutating call re-reads a
# FRESH state summary, so element indices are never stale.


def _node_label(node: Any) -> str:
    """Best-effort, version-tolerant short label for a DOM node (<= 80 chars)."""
    for meth in ("get_all_children_text", "get_all_text_till_next_clickable_element"):
        fn = getattr(node, meth, None)
        if callable(fn):
            try:
                value = fn()
                if value:
                    return str(value).strip()[:80]
            except Exception:  # noqa: BLE001 — labels are best-effort
                pass
    attrs = getattr(node, "attributes", None) or {}
    if isinstance(attrs, dict):
        for key in ("aria-label", "placeholder", "name", "value", "title", "alt"):
            if attrs.get(key):
                return str(attrs[key]).strip()[:80]
    return (str(getattr(node, "node_value", "")) or "").strip()[:80]


def _selector_map(state: Any) -> Dict[int, Any]:
    """Read the interactive-element map at its real home: state.dom_state.

    In browser-use 0.13.x the selector_map lives on `dom_state`, NOT on the
    top-level BrowserStateSummary. (The old top-level read silently returned {}.)
    """
    dom_state = getattr(state, "dom_state", None)
    if dom_state is not None:
        sm = getattr(dom_state, "selector_map", None)
        if sm:
            return sm
    return getattr(state, "selector_map", {}) or {}


async def summarize_page(browser: Any, max_elements: int = 30) -> str:
    """Compact, model-friendly view of the current page: url, title, [index] els."""
    state = await browser.get_browser_state_summary(include_screenshot=False)
    selector_map = _selector_map(state)
    lines = [
        f"url: {getattr(state, 'url', '') or ''}",
        f"title: {getattr(state, 'title', '') or ''}",
        "interactive elements:",
    ]
    for idx, node in list(selector_map.items())[:max_elements]:
        role = str(getattr(node, "node_name", None) or "el").lower()
        label = _node_label(node)
        if label:
            lines.append(f"  [{idx}] {role} :: {label}")
    if len(lines) == 3:
        lines.append("  (no interactive elements detected)")
    return "\n".join(lines)


class BrowserTools:
    """Async ReAct tools bound to the EXISTING attached BrowserSession.

    Each mutating action re-reads a fresh state summary so the [index] values the
    model uses are always current. `navigate` is allowlist-enforced here too
    (defence in depth alongside the orchestrator + the sidecar's allowed_domains).
    """

    def __init__(self, browser: Any, allowed_domains: List[str]) -> None:
        self.browser = browser
        self.allowed = [d.strip().lower() for d in (allowed_domains or []) if d.strip()]

    async def _node(self, index: int) -> Any:
        state = await self.browser.get_browser_state_summary(include_screenshot=False)
        node = _selector_map(state).get(int(index))
        if node is None:
            raise ValueError(f"No element [{index}] on the current page.")
        return node

    async def _dispatch(self, event: Any) -> Any:
        ev = self.browser.event_bus.dispatch(event)
        await ev
        return await ev.event_result(raise_if_any=True, raise_if_none=False)

    async def read_page(self) -> str:
        """Return a compact summary of the current page (url, title, [index] elements)."""
        return await summarize_page(self.browser)

    async def navigate(self, url: str) -> str:
        """Navigate to an absolute URL (must be within the allowed domains)."""
        if not _domain_allowed(url, self.allowed):
            return f"REFUSED: {url} is outside the allowed domains {self.allowed}."
        await self.browser.navigate_to(url)
        return await summarize_page(self.browser)

    async def click(self, index: int) -> str:
        """Click the element at the given [index] from the latest page summary."""
        await self._dispatch(ClickElementEvent(node=await self._node(index)))
        return await summarize_page(self.browser)

    async def type_text(self, index: int, text: str) -> str:
        """Type text into the input at [index] (clears it first). Does NOT submit."""
        await self._dispatch(
            TypeTextEvent(node=await self._node(index), text=text, clear=True)
        )
        return f"typed into [{index}].\n" + await summarize_page(self.browser)

    async def submit(self) -> str:
        """Press Enter to submit the focused input/form."""
        await self._dispatch(SendKeysEvent(keys="Enter"))
        return await summarize_page(self.browser)

    async def scroll_to(self, text: str) -> str:
        """Scroll until the given visible text comes into view."""
        await self._dispatch(ScrollToTextEvent(text=text, direction="down"))
        return await summarize_page(self.browser)


class BrowserPilot(dspy.Module):
    """ReAct over the LIVE CDP browser for open-ended browsing goals.

    Construct it with the EXISTING attached BrowserSession (never a new Browser);
    it builds its own CDP-backed tools and runs `dspy.ReAct` (which auto-adds a
    `finish` tool). Drive it from an async context with `await pilot.aforward(goal)`
    — ReAct's `acall` awaits the async tools directly inside the FastAPI loop.
    """

    def __init__(
        self, browser: Any, allowed_domains: List[str], max_iters: int = 8
    ) -> None:
        super().__init__()
        self.tools = BrowserTools(browser, allowed_domains)
        self.react = dspy.ReAct(
            PilotStep,
            tools=[
                self.tools.read_page,
                self.tools.navigate,
                self.tools.click,
                self.tools.type_text,
                self.tools.submit,
                self.tools.scroll_to,
            ],
            max_iters=max_iters,
        )

    async def aforward(self, goal: str) -> dspy.Prediction:
        page_state = await summarize_page(self.tools.browser)
        return await self.react.acall(
            goal=goal,
            page_state=page_state,
            allowlist=", ".join(self.tools.allowed) or "(any)",
        )


def count_pilot_steps(pred: Any) -> int:
    """Number of tool actions a BrowserPilot ReAct run took (best-effort)."""
    traj = getattr(pred, "trajectory", None)
    if isinstance(traj, dict):
        return sum(1 for k in traj if str(k).startswith("tool_name_"))
    if isinstance(traj, (list, tuple)):
        return len(traj)
    return 0
