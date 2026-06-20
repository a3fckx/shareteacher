// ─────────────────────────────────────────────────────────────────────────
// Runway Character — module-local types.
//
// RunwayCharacterAgent extends the canonical CharacterAgent contract with one
// extra, non-interface method the orchestrator uses to push teacher narration
// into the transcript: narrate(). The Character only narrates/answers — it does
// NOT free-run the lesson (anti-drift); the orchestrator steps the LessonEngine
// and calls narrate() for each "say" beat.
// ─────────────────────────────────────────────────────────────────────────

import type { CharacterAgent } from "@/types/contracts";
import type { Speaker } from "./store";

export interface RunwayCharacterAgent extends CharacterAgent {
  /**
   * Append a transcript line spoken by the teacher (default) or attributed to a
   * human. In real mode this also makes a best-effort request for the live
   * avatar to speak the line; failures degrade silently to a local transcript
   * append so the lesson always continues.
   */
  narrate(sessionId: string, text: string, speaker?: Speaker): Promise<void>;
}
