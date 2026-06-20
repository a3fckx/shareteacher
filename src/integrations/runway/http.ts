// ─────────────────────────────────────────────────────────────────────────
// Runway Character — isolated HTTP client (the only transport; real-only).
//
// ALL network access for the Runway Characters realtime API lives here so the
// rest of the adapter stays transport-agnostic. The core create/poll/consume
// chain throws on failure; the "ASSUMPTION" methods below are best-effort and
// callers may catch them (real GWM-1 runs those over the data channel).
//
// Endpoint surface (verified against docs.dev.runwayml.com, June 2026):
//   POST   /v1/realtime_sessions                       -> create a session
//   GET    /v1/realtime_sessions/{id}                  -> poll until READY
//   POST   /v1/realtime_sessions/{id}/consume          -> LiveKit credentials
//   GET    /v1/avatars/{avatarId}/conversations/{id}   -> transcript + recording
//
// Auth:  Authorization: Bearer <RUNWAY_API_KEY>   (server-side only)
//        X-Runway-Version: 2024-11-06
//
// Methods tagged "ASSUMPTION" below are not fully documented for the realtime
// surface yet; callers MUST treat them as best-effort (try/catch + fallback).
// Uses global fetch (Node >=18 / Next runtime) — no extra dependency required.
// ─────────────────────────────────────────────────────────────────────────

import type { Env, ToolResult, TranscriptLine } from "@/types/contracts";
import type { RealtimeToolDef } from "@/lib/avatar-tools";
import { nowMs } from "./store";

/** Date-versioned API contract pin (Runway requires this header). */
export const RUNWAY_API_VERSION = "2024-11-06";

interface CreateSessionResponse {
  id: string;
  status?: string;
  failure?: unknown;
}

interface PollSessionResponse {
  status?: string;
  sessionKey?: string;
  failure?: unknown;
}

interface ConsumeResponse {
  url: string;
  token: string;
  roomName: string;
}

export interface NormalizedConversation {
  transcript: TranscriptLine[];
  recordingUrl: string | null;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function normalizeTranscript(raw: unknown): TranscriptLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row): TranscriptLine => {
      const o = (row ?? {}) as Record<string, unknown>;
      const speaker: TranscriptLine["speaker"] =
        o.speaker === "human" ? "human" : "teacher";
      const text = typeof o.text === "string" ? o.text : "";
      const ts = typeof o.ts === "number" ? o.ts : nowMs();
      return { ts, speaker, text };
    })
    .filter((line) => line.text.length > 0);
}

export class RunwayHttp {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(env: Env) {
    // Trim a trailing slash so `${baseUrl}/v1/...` never doubles up.
    this.baseUrl = env.runway.baseUrl.replace(/\/+$/, "");
    this.apiKey = env.runway.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    init?: { body?: unknown; authToken?: string },
  ): Promise<T> {
    const token = init?.authToken ?? this.apiKey;
    if (!token) throw new Error("Runway API key missing (RUNWAY_API_KEY)");
    const hasBody = init?.body !== undefined;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Runway-Version": RUNWAY_API_VERSION,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(init?.body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Runway ${method} ${path} -> ${res.status} ${res.statusText} ${detail}`.trim(),
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * POST /v1/realtime_sessions — create a Character realtime session.
   *
   * Tools are registered HERE, in the create payload, as an array of
   * `{ type: "client_event" | "backend_rpc", name, description, parameters? }`
   * objects (see src/lib/avatar-tools.ts → RUNWAY_TOOLS). This is the documented
   * wire shape — verified against the installed SDK runtime
   * (node_modules/@runwayml/avatars/dist/api.js: `clientTool` emits only
   * `{type,name,description}`, `pageActionTools` append the `parameters` array)
   * and the official avatars-sdk-react example. The browser then registers
   * handlers for these same tools over the WebRTC data channel via
   * <PageActions/> and `useClientEvent(...)`.
   */
  async createRealtimeSession(input: {
    avatarId?: string;
    personality: string;
    startScript?: string;
    tools?: readonly RealtimeToolDef[];
  }): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>("POST", "/v1/realtime_sessions", {
      body: {
        model: "gwm1_avatars",
        avatar: { type: "custom", avatarId: input.avatarId },
        personality: input.personality,
        startScript: input.startScript,
        ...(input.tools && input.tools.length ? { tools: input.tools } : {}),
      },
    });
  }

  /**
   * GET /v1/realtime_sessions/{id} on a loop until status === READY. Returns the
   * sessionKey used to consume credentials. Throws on FAILED or timeout.
   */
  async pollUntilReady(
    sessionId: string,
    opts?: { attempts?: number; intervalMs?: number },
  ): Promise<{ sessionKey: string }> {
    const attempts = opts?.attempts ?? 30;
    const intervalMs = opts?.intervalMs ?? 1000;
    for (let i = 0; i < attempts; i++) {
      const r = await this.request<PollSessionResponse>(
        "GET",
        `/v1/realtime_sessions/${sessionId}`,
      );
      const status = (r.status ?? "").toUpperCase();
      if (status === "READY" && r.sessionKey) return { sessionKey: r.sessionKey };
      if (status === "FAILED") {
        throw new Error(
          `Runway session ${sessionId} FAILED: ${JSON.stringify(r.failure ?? {})}`,
        );
      }
      await delay(intervalMs);
    }
    throw new Error(
      `Runway session ${sessionId} not READY after ${attempts} attempts`,
    );
  }

  /**
   * POST /v1/realtime_sessions/{id}/consume — exchange sessionKey for LiveKit
   * creds. The endpoint rejects the request unless a JSON body + Content-Type
   * are present, so we always send an empty object.
   */
  async consume(sessionId: string, sessionKey: string): Promise<ConsumeResponse> {
    return this.request<ConsumeResponse>(
      "POST",
      `/v1/realtime_sessions/${sessionId}/consume`,
      { authToken: sessionKey, body: {} },
    );
  }

  /**
   * ASSUMPTION: push visual/screen context to a live session. The documented
   * realtime surface delivers context over the WebRTC data channel client-side;
   * a REST mirror is assumed here for the server orchestrator. Best-effort.
   */
  async sendContext(sessionId: string | undefined, context: string): Promise<void> {
    if (!sessionId) return;
    await this.request<void>("POST", `/v1/realtime_sessions/${sessionId}/context`, {
      body: { context },
    });
  }

  /**
   * ASSUMPTION: ask the live avatar to speak a scripted line. Mirrors the
   * orchestrator-driven narration server-side. Best-effort.
   */
  async say(sessionId: string | undefined, text: string): Promise<void> {
    if (!sessionId) return;
    await this.request<void>("POST", `/v1/realtime_sessions/${sessionId}/say`, {
      body: { text },
    });
  }

  /**
   * ASSUMPTION: return a tool result to the session for a tool the Character
   * requested over the data channel. Best-effort.
   */
  async resolveTool(
    sessionId: string | undefined,
    result: ToolResult,
  ): Promise<void> {
    if (!sessionId) return;
    await this.request<void>(
      "POST",
      `/v1/realtime_sessions/${sessionId}/tool_result`,
      { body: result },
    );
  }

  /** DELETE /v1/realtime_sessions/{id} — end the session. Best-effort. */
  async stopSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    await this.request<void>("DELETE", `/v1/realtime_sessions/${sessionId}`);
  }

  /** GET /v1/avatars/{avatarId}/conversations/{id} — transcript + recording. */
  async getConversation(
    avatarId: string,
    conversationId: string,
  ): Promise<NormalizedConversation> {
    const r = await this.request<{
      transcript?: unknown;
      recordingUrl?: string | null;
    }>("GET", `/v1/avatars/${avatarId}/conversations/${conversationId}`);
    return {
      transcript: normalizeTranscript(r.transcript),
      recordingUrl: r.recordingUrl ?? null,
    };
  }
}
