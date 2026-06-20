// ─────────────────────────────────────────────────────────────────────────
// Organ 2: Recall.ai meeting bot — REAL ONLY.
//
// `createMeetingBot(env)` always returns a live Recall.ai client. There is no
// mock: the adapter talks to the real Recall API. Construction NEVER throws —
// a missing RECALL_API_KEY is only surfaced when an actual live call is made
// (join / status / leave), so the app boots even without credentials.
//
// The bot joins the meeting and streams our public teaching screen
// (`outputUrl`) into the call as the bot's camera via Recall's Output Media
// "webpage" feature, then polls / leaves through the v1 bot API.
//
// REQUIREMENT — public RECALL_OUTPUT_URL tunnel:
//   For the bot to actually render and stream the teaching screen, `outputUrl`
//   (RECALL_OUTPUT_URL) MUST be a PUBLIC https URL reachable from Recall's
//   cloud (e.g. an ngrok / cloudflared tunnel to `/stage`). A `localhost`
//   value will not work — Recall cannot reach it. The meeting link itself must
//   be a real Google Meet / Zoom / Teams URL (anti-SSRF enforced in url.ts).
//
// Auth: `Authorization: Token <RECALL_API_KEY>`. Region selects the Recall
// data-residency host, e.g. ap-northeast-1 -> https://ap-northeast-1.recall.ai.
// ─────────────────────────────────────────────────────────────────────────

import type {
  BotStatus,
  Env,
  JoinMeetingOpts,
  MeetingBot,
} from "@/types/contracts";
import { MeetingUrlError, validateMeetingUrl } from "./url";
import { latestStatusCode, mapRecallStatus, type RecallBot } from "./status";

const ADAPTER_NAME = "recall";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_BOT_NAME = "ShareTeacher";
const DEFAULT_REGION = "ap-northeast-1";

export class RecallError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RecallError";
    this.status = status;
  }
}

// Re-export so callers/tests can distinguish a bad-URL rejection (client error)
// from a transport/API failure.
export { MeetingUrlError };

/**
 * Build the Recall meeting-bot adapter (always live).
 *
 * Never throws at construction: a missing RECALL_API_KEY only fails the first
 * live request (join / status / leave). This keeps the app bootable without
 * credentials while guaranteeing every successful call is real.
 */
export function createMeetingBot(env: Env): MeetingBot {
  // apiKey may be undefined here — that is intentional. We do NOT throw at
  // construction; the guard lives in recallFetch so only a live call fails.
  const apiKey = env.recall.apiKey;
  const region = env.recall.region || DEFAULT_REGION;
  const baseUrl = `https://${region}.recall.ai`;
  const defaultOutputUrl = env.recall.outputUrl;

  async function recallFetch(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    if (!apiKey) {
      throw new RecallError(
        "RECALL_API_KEY is required to call Recall.ai (no mock fallback)",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new RecallError(
          `Recall request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`,
        );
      }
      throw new RecallError(
        `Recall request failed: ${method} ${path}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new RecallError(
        `Recall API ${res.status} on ${method} ${path}: ${raw.slice(0, 500)}`,
        res.status,
      );
    }
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new RecallError(`Recall returned non-JSON on ${method} ${path}`);
    }
  }

  return {
    name: ADAPTER_NAME,
    mode: "real",

    async join(opts: JoinMeetingOpts): Promise<{ botId: string; status: BotStatus }> {
      // Anti-SSRF: only real Meet/Zoom/Teams hosts over https pass.
      const { url } = validateMeetingUrl(opts.meetingUrl);
      const outputUrl = opts.outputUrl || defaultOutputUrl;
      const payload = {
        meeting_url: url,
        bot_name: opts.botName ?? DEFAULT_BOT_NAME,
        // Stream our teaching screen into the meeting as the bot's camera.
        // outputUrl MUST be a public URL reachable from Recall's cloud.
        output_media: {
          camera: {
            kind: "webpage",
            config: { url: outputUrl },
          },
        },
      };
      const bot = (await recallFetch(
        "POST",
        "/api/v1/bot/",
        payload,
      )) as RecallBot;
      if (!bot || typeof bot.id !== "string") {
        throw new RecallError("Recall create-bot response missing id");
      }
      return { botId: bot.id, status: mapRecallStatus(latestStatusCode(bot)) };
    },

    async status(botId: string): Promise<BotStatus> {
      const bot = (await recallFetch(
        "GET",
        `/api/v1/bot/${encodeURIComponent(botId)}/`,
      )) as RecallBot;
      return mapRecallStatus(latestStatusCode(bot));
    },

    async leave(botId: string): Promise<void> {
      try {
        await recallFetch(
          "POST",
          `/api/v1/bot/${encodeURIComponent(botId)}/leave_call/`,
          {},
        );
      } catch (err) {
        // Idempotent leave: if the bot is already gone / not in a call, the
        // desired end-state (not in the meeting) is already true.
        if (
          err instanceof RecallError &&
          err.status &&
          [400, 404, 409].includes(err.status)
        ) {
          return;
        }
        throw err;
      }
    },
  };
}
