import importlib
import logging
from typing import Any

logger = logging.getLogger("browser_agent.skills")

async def run_skill_by_name(name: str, browser: Any, **args) -> Any:
    """Dynamically load and run a browser skill by name."""
    try:
        # Load absolute or relative import depending on sys.path
        module_name = f"skills.{name}"
        module = importlib.import_module(module_name)
        run_fn = getattr(module, "run", None)
        if not run_fn or not callable(run_fn):
            raise AttributeError(f"Skill module '{name}' does not define an async 'run' function.")
        
        logger.info(f"Running skill '{name}' with args: {args}")
        return await run_fn(browser, **args)
    except ModuleNotFoundError as e:
        raise ValueError(f"Skill '{name}' not found. Ensure browser_agent/skills/{name}.py exists.") from e
