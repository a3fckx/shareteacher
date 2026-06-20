// ─────────────────────────────────────────────────────────────────────────
// Recall bot status mapping.
//
// Recall exposes a bot's lifecycle as a `status_changes` array of status
// codes (and, on newer API surfaces, a top-level `status` object). We collapse
// the raw Recall codes into the project's BotStatus contract, covering join,
// waiting-room, in-call, leave, and failure/timeout (fatal) states.
// ─────────────────────────────────────────────────────────────────────────

import type { BotStatus } from "@/types/contracts";

export interface RecallStatusChange {
  code?: string | null;
  message?: string | null;
  created_at?: string | null;
  sub_code?: string | null;
}

/** Minimal shape of the Recall bot resource we depend on. */
export interface RecallBot {
  id: string;
  status_changes?: RecallStatusChange[] | null;
  /** Newer API surfaces may carry a top-level status. */
  status?: { code?: string | null } | string | null;
}

/** Pull the most recent Recall status code from a bot resource, if any. */
export function latestStatusCode(bot: RecallBot): string | undefined {
  const status = bot.status;
  if (status && typeof status === "object" && typeof status.code === "string") {
    return status.code;
  }
  if (typeof status === "string" && status) return status;

  const changes = bot.status_changes;
  if (Array.isArray(changes) && changes.length > 0) {
    const last = changes[changes.length - 1];
    if (last && typeof last.code === "string") return last.code;
  }
  return undefined;
}

/**
 * Collapse a raw Recall status code into the BotStatus contract.
 * Unknown/absent codes are treated as still "joining" (least surprising for a
 * freshly created bot); explicit fatal codes (join failure, kicked, timeout)
 * map to "failed".
 */
export function mapRecallStatus(code: string | undefined): BotStatus {
  switch (code) {
    case undefined:
    case "":
    case "ready":
    case "joining_call":
      return "joining";

    case "in_waiting_room":
    case "participant_in_waiting_room":
      return "in_waiting_room";

    case "in_call_not_recording":
    case "in_call_recording":
    case "recording_permission_allowed":
    case "recording_permission_denied":
      return "in_call";

    case "call_ended":
    case "recording_done":
    case "done":
    case "analysis_done":
    case "media_expired":
      return "left";

    case "fatal":
      return "failed";

    default:
      return "joining";
  }
}
