// ─────────────────────────────────────────────────────────────────────────
// Browser controller (Organ 4) — factory.
//
// Always returns the real controller, which proxies to the Python browser_agent
// sidecar (FastAPI + browser-use) over HTTP at `env.browserAgentUrl`. There is
// no mock mode. Construction never performs I/O and never throws — a missing
// sidecar only fails when a live call (attach/open/observe/...) is made.
// ─────────────────────────────────────────────────────────────────────────

import type { BrowserController, Env } from "@/types/contracts";
import { createRealBrowserController } from "./real";

/** Build a BrowserController for the given environment (always live). */
export function createBrowserController(env: Env): BrowserController {
  return createRealBrowserController(env);
}

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
