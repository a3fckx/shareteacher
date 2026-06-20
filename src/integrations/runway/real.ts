// ─────────────────────────────────────────────────────────────────────────
// Runway Character — the (only) adapter: a thin client over RunwayHttp.
//
// REAL-ONLY. There is no mock and no mock/degraded branch. Construction never
// performs I/O and never throws (createCharacterAgent just wires env into the
// HTTP client + an in-memory transcript mirror); failures surface only when a
// live call is actually made.
//
// Live flow on start() — a single live call chain; any failure propagates:
//   1. POST /v1/realtime_sessions             (create)
//   2. GET  /v1/realtime_sessions/{id}         (poll until READY -> sessionKey)
//   3. POST /v1/realtime_sessions/{id}/consume (sessionKey) -> LiveKit creds
// The LiveKit { url, token, roomName } is packed into joinToken via
// encodeJoinToken so the client can render the avatar tile. The session uses
// avatar { type: "custom", avatarId } where avatarId = env.runway.characterId.
//
// Secondary REST mirrors (sendContext/say/resolveTool) are best-effort: real
// GWM-1 delivers context/tool calls client-side over the LiveKit data channel,
// so a REST miss is logged and non-fatal. Transcript comes from getConversation
// with the local mirror as the immediate source until the remote populates.
// ─────────────────────────────────────────────────────────────────────────

import type {
  CharacterSession,
  CharacterStartOpts,
  Env,
  ToolCall,
  ToolResult,
  TranscriptLine,
} from "@/types/contracts";
import type { RunwayCharacterAgent } from "./types";
import { RunwayHttp } from "./http";
import {
  encodeJoinToken,
  nowMs,
  RunwaySessionStore,
  seedGreetingText,
  type Speaker,
} from "./store";

const TAG = "[runway:real]";

function logWarn(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  // Best-effort secondary REST mirrors (context/say/tool_result/transcript) run
  // client-side over the data channel; a REST miss here is non-fatal and logged.
  console.warn(`${TAG} ${message}${detail ? `: ${detail}` : ""}`);
}

export function createRealCharacterAgent(env: Env): RunwayCharacterAgent {
  const store = new RunwaySessionStore();
  const http = new RunwayHttp(env);

  return {
    name: "runway",
    mode: "real",

    async start(opts: CharacterStartOpts): Promise<CharacterSession> {
      // Seed the local transcript/context mirror (greeting + expiry). This is
      // session state, not a fallback: the real LiveKit join token is filled in
      // below from the live create -> poll -> consume chain.
      const state = store.ensure(opts.sessionId, opts, "runway");
      const avatarId = opts.characterId ?? env.runway.characterId;
      if (!avatarId) {
        throw new Error(
          "Runway start requires an avatar id (RUNWAY_CHARACTER_ID or opts.characterId)",
        );
      }

      // Live call chain. Any failure here is a genuine failure of a live call
      // and propagates to the caller (the orchestrator marks the session
      // failed). There is no mock/degraded session.
      const created = await http.createRealtimeSession({
        avatarId,
        personality: opts.personaPrompt,
        startScript: seedGreetingText(opts),
      });
      const { sessionKey } = await http.pollUntilReady(created.id);
      const creds = await http.consume(created.id, sessionKey);

      state.conversationId = created.id;
      state.avatarId = avatarId;
      state.joinToken = encodeJoinToken({
        provider: "runway",
        url: creds.url,
        token: creds.token,
        roomName: creds.roomName,
      });
      // /consume returns no explicit session expiry; the LiveKit token carries
      // its own. The seeded far-future expiresAt is a coarse UI hint; renewal is
      // handled by the orchestrator.

      return {
        id: opts.sessionId,
        joinToken: state.joinToken,
        expiresAt: state.expiresAt,
      };
    },

    async sendContext(sessionId: string, context: string): Promise<void> {
      store.setContext(sessionId, context);
      try {
        await http.sendContext(store.conversationId(sessionId), context);
      } catch (err) {
        logWarn(`sendContext non-fatal for ${sessionId}`, err);
      }
    },

    async nextToolCalls(_sessionId: string): Promise<ToolCall[]> {
      // Tool calls arrive over the realtime WebRTC data channel (client-side),
      // not this REST adapter. The orchestrator drives the lesson; return [].
      return [];
    },

    async resolveTool(sessionId: string, result: ToolResult): Promise<void> {
      try {
        await http.resolveTool(store.conversationId(sessionId), result);
      } catch (err) {
        logWarn(`resolveTool non-fatal for ${sessionId}`, err);
      }
    },

    async narrate(
      sessionId: string,
      text: string,
      speaker: Speaker = "teacher",
    ): Promise<void> {
      const line: TranscriptLine = { ts: nowMs(), speaker, text };
      store.append(sessionId, line);
      // Best-effort: have the live avatar speak teacher lines.
      if (speaker === "teacher") {
        try {
          await http.say(store.conversationId(sessionId), text);
        } catch (err) {
          logWarn(`narrate/say non-fatal for ${sessionId}`, err);
        }
      }
    },

    async getTranscript(sessionId: string): Promise<TranscriptLine[]> {
      const state = store.get(sessionId);
      if (state?.avatarId && state?.conversationId) {
        try {
          const remote = await http.getConversation(
            state.avatarId,
            state.conversationId,
          );
          if (remote.transcript.length > 0) return remote.transcript;
        } catch (err) {
          logWarn(`getTranscript remote failed for ${sessionId}; using mirror`, err);
        }
      }
      return store.getLines(sessionId);
    },

    async getRecordingUrl(sessionId: string): Promise<string | null> {
      const state = store.get(sessionId);
      if (state?.avatarId && state?.conversationId) {
        try {
          const remote = await http.getConversation(
            state.avatarId,
            state.conversationId,
          );
          if (remote.recordingUrl) {
            store.setRecordingUrl(sessionId, remote.recordingUrl);
            return remote.recordingUrl;
          }
        } catch (err) {
          logWarn(`getRecordingUrl remote failed for ${sessionId}`, err);
        }
      }
      return store.getRecordingUrl(sessionId);
    },

    async stop(sessionId: string): Promise<void> {
      try {
        await http.stopSession(store.conversationId(sessionId));
      } catch (err) {
        logWarn(`stop non-fatal for ${sessionId}`, err);
      }
      store.remove(sessionId);
    },
  };
}
