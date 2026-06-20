# ShareTeacher DSPy intelligence layer.
#
# Declarative brain for the teaching class:
#   • signatures.py — the Signatures + typed payloads (UiAction, SalientElement)
#   • programs.py   — the Modules (TeachingDirector, ScreenInterpreter,
#                     PromptComposer, BrowserPilot) + LM config + validation
#   • service.py    — the FastAPI router (/intelligence/direct|compose|pilot)
#
# main.py mounts it with:  app.include_router(intelligence.router)
# and (once CDP tools are wired) intelligence.set_pilot_runner(...).

from .programs import (  # noqa: F401
    BrowserPilot,
    BrowserTools,
    PromptComposer,
    ScreenInterpreter,
    TeachingDirector,
    configure_lm,
    count_pilot_steps,
    summarize_page,
    validate_ui_action,
)
from .service import (  # noqa: F401
    router,
    set_observe_runner,
    set_pilot_runner,
)
from .signatures import (  # noqa: F401
    UI_TOOLS,
    SalientElement,
    UiAction,
    UiTool,
)

__all__ = [
    "BrowserPilot",
    "BrowserTools",
    "PromptComposer",
    "ScreenInterpreter",
    "TeachingDirector",
    "configure_lm",
    "count_pilot_steps",
    "summarize_page",
    "validate_ui_action",
    "router",
    "set_observe_runner",
    "set_pilot_runner",
    "UI_TOOLS",
    "SalientElement",
    "UiAction",
    "UiTool",
]
