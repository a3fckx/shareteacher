// ─────────────────────────────────────────────────────────────────────────
// Runway Character — in-memory session store + pure helpers.
//
// The real adapter keeps a *local mirror* of transcript/context here so the
// classroom UI can render a seeded greeting and a retrievable transcript while
// the live LiveKit join token is being fetched. There are no mock credentials:
// the join token is empty until `POST /v1/realtime_sessions/{id}/consume`
// returns real LiveKit creds.
//
// IMPORTANT: never call Date.now() at module top level. `nowMs()` reads the
// clock lazily, inside function calls only.
// ─────────────────────────────────────────────────────────────────────────

import type { CharacterStartOpts, TranscriptLine } from "@/types/contracts";

/** Far-future-but-finite TTL for a session join token (1 year, in ms). */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365;

export type Speaker = TranscriptLine["speaker"];

/**
 * Opaque-but-structured handle the classroom UI uses to render the avatar
 * tile. Carries the LiveKit WebRTC credentials returned by
 * `POST /v1/realtime_sessions/{id}/consume`. The UI should `decodeJoinToken()` it.
 */
export interface RunwayJoinCredentials {
  provider: "runway";
  /** WebRTC/LiveKit signalling server URL the avatar tile connects to. */
  url: string;
  /** Auth token for the realtime room. */
  token: string;
  /** LiveKit room name. */
  roomName: string;
}

export interface RunwaySessionState {
  sessionId: string;
  provider: "runway";
  /** Present once `start()` has run; absent for lazily-created bare state. */
  opts?: CharacterStartOpts;
  /** Encoded RunwayJoinCredentials (see encodeJoinToken). */
  joinToken: string;
  expiresAt: number;
  /** Latest screen/visual context fed via sendContext(). */
  latestContext: string;
  transcript: TranscriptLine[];
  recordingUrl: string | null;
  /** Runway realtime-session id (real mode); used for conversation lookups. */
  conversationId?: string;
  /** Avatar id backing the conversation (real mode). */
  avatarId?: string;
}

/** Read the wall clock lazily. Keeps the module import side-effect free. */
export function nowMs(): number {
  return Date.now();
}

export function encodeJoinToken(creds: RunwayJoinCredentials): string {
  return JSON.stringify(creds);
}

export function decodeJoinToken(token: string): RunwayJoinCredentials | null {
  try {
    const parsed = JSON.parse(token) as Partial<RunwayJoinCredentials>;
    if (
      parsed &&
      typeof parsed.url === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.roomName === "string"
    ) {
      return {
        provider: "runway",
        url: parsed.url,
        token: parsed.token,
        roomName: parsed.roomName,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The first line the teacher "says". Persona/topic is orchestrator-driven; this
 * is only a friendly seed so getTranscript() is non-empty immediately and the
 * golden-path Lesson 1 has an opening beat.
 */
export function seedGreetingText(opts?: CharacterStartOpts): string {
  void opts; // persona is applied live by Runway / the orchestrator, not here.
  return (
    "Hi, I'm your ShareTeacher guide. Today we'll learn how to create a " +
    "PowerPoint using ChatGPT. Whenever you have a question, just jump in."
  );
}

/** In-memory, per-process session table. */
export class RunwaySessionStore {
  private readonly sessions = new Map<string, RunwaySessionState>();

  /**
   * Idempotently create a session, seeding a join token, expiry, and greeting
   * on first creation. Returns the live state object.
   */
  ensure(
    sessionId: string,
    opts: CharacterStartOpts,
    provider: "runway" = "runway",
  ): RunwaySessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.opts = opts;
      return existing;
    }
    const state: RunwaySessionState = {
      sessionId,
      provider,
      opts,
      // Empty until POST /consume returns real LiveKit creds.
      joinToken: "",
      expiresAt: nowMs() + SESSION_TTL_MS,
      latestContext: "",
      transcript: [
        { ts: nowMs(), speaker: "teacher", text: seedGreetingText(opts) },
      ],
      recordingUrl: null,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  get(sessionId: string): RunwaySessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /** Lazily create a minimal state so narrate()/setContext() never throw. */
  private ensureBare(sessionId: string): RunwaySessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const state: RunwaySessionState = {
      sessionId,
      provider: "runway",
      joinToken: "",
      expiresAt: nowMs() + SESSION_TTL_MS,
      latestContext: "",
      transcript: [],
      recordingUrl: null,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  setContext(sessionId: string, context: string): void {
    this.ensureBare(sessionId).latestContext = context;
  }

  getContext(sessionId: string): string {
    return this.sessions.get(sessionId)?.latestContext ?? "";
  }

  append(sessionId: string, line: TranscriptLine): void {
    this.ensureBare(sessionId).transcript.push(line);
  }

  getLines(sessionId: string): TranscriptLine[] {
    return [...(this.sessions.get(sessionId)?.transcript ?? [])];
  }

  setRecordingUrl(sessionId: string, url: string | null): void {
    const st = this.sessions.get(sessionId);
    if (st) st.recordingUrl = url;
  }

  getRecordingUrl(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.recordingUrl ?? null;
  }

  conversationId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.conversationId;
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
