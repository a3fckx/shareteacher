// ─────────────────────────────────────────────────────────────────────────
// Organ 1 — Runway Character. Public entry point.
//
// createCharacterAgent(env) returns a RunwayCharacterAgent, which IS a
// CharacterAgent (it extends the canonical contract) plus an extra narrate()
// method the orchestrator uses to push teacher narration into the transcript.
//
// There is no mock: the agent always talks to the live Runway Characters
// (GWM-1) realtime API. RUNWAY_API_KEY is required at run time.
//
// SERVER-ONLY: this module reads secrets from env — never import it into a
// client component.
// ─────────────────────────────────────────────────────────────────────────

import type { Env } from "@/types/contracts";
import type { RunwayCharacterAgent } from "./types";
import { createRealCharacterAgent } from "./real";

export function createCharacterAgent(env: Env): RunwayCharacterAgent {
  return createRealCharacterAgent(env);
}

export type { RunwayCharacterAgent } from "./types";
export type { RunwayJoinCredentials, Speaker } from "./store";
export { decodeJoinToken, encodeJoinToken } from "./store";
export { RUNWAY_API_VERSION } from "./http";
