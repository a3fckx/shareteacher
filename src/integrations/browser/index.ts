// ─────────────────────────────────────────────────────────────────────────
// Browser controller (Organ 4) — factory.
//
// Always returns the real controller, which proxies to the Python browser_agent
// sidecar (FastAPI + browser-use) over HTTP at `env.browserAgentUrl`. There is
// no mock mode. Construction never performs I/O and never throws — a missing
// sidecar only fails when a live call (attach/open/observe/...) is made.
//
// The same controller is ALSO the client for the DSPy intelligence layer that
// runs inside that sidecar: direct() drives one TeachingDirector turn, pilot()
// delegates an open-ended browser goal to the ReAct BrowserPilot, and compose()
// asks the PromptComposer for a strong reusable prompt. They proxy to the
// sidecar's /intelligence/{direct,compose,pilot} routes (see ./real.ts).
// ─────────────────────────────────────────────────────────────────────────

import type { BrowserController, Env } from "@/types/contracts";
import { createRealBrowserController } from "./real";

/** Build a BrowserController for the given environment (always live). */
export function createBrowserController(env: Env): BrowserController {
  return createRealBrowserController(env);
}

// Re-export the DSPy intelligence wire types so orchestration code can import the
// director contract from one place alongside the controller that speaks it.
export type {
  ComposeRequest,
  ComposeResponse,
  DirectRequest,
  DirectResponse,
  DirectorTurn,
  PilotResult,
  SalientElement,
  UiAction,
  UiActionTool,
} from "@/types/contracts";

export { createRealBrowserController } from "./real";
export {
  buildPptOutline,
  buildPptPrompt,
  extractTopic,
  looksLikePptPrompt,
  DEFAULT_TOPIC,
} from "./ppt-outline";
export {
  DEFAULT_ALLOWLIST,
  isAllowed,
  resolveAllowlist,
} from "./allowlist";
