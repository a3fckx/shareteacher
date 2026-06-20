// ─────────────────────────────────────────────────────────────────────────
// Organ 7 (data half): Persistence.
//
// `createRepository(env)` returns a Postgres-backed Repository when a real DB
// is reachable, and otherwise transparently falls back to an in-memory store
// so the app boots and Lesson 1 runs end-to-end with ZERO credentials.
//
// Resilience contract: on ANY error during the first health ping (or a later
// op) we log a warning and degrade to the in-memory repository — the app keeps
// running. `createInMemoryRepository()` is also exported for tests. This is a
// resilience fallback, not a mock: there is no mock switch.
//
// Server-only module: imports the drizzle client and must never reach a client
// component. Build through the factory; never `new` a concrete class.
// ─────────────────────────────────────────────────────────────────────────

import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { artifacts, progress, sessions, traces, transcripts } from "@/db/schema";
import {
  type ArtifactRef,
  type Env,
  type LessonRunState,
  type Repository,
  type SessionPhase,
  type SessionRecord,
  type TranscriptLine,
} from "@/types/contracts";

type TraceEntry = { ts: number; kind: string; data: unknown };

// ── Pure helpers (no module-load side effects, no module-load timestamps) ───

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapSessionRow(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    lessonId: row.lessonId,
    phase: row.phase as SessionPhase,
    meetingUrl: row.meetingUrl,
    botId: row.botId,
    characterSessionId: row.characterSessionId,
    browserSessionId: row.browserSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Build the row for an idempotent create, preserving prior createdAt. */
function mergeForCreate(
  existing: SessionRecord | undefined,
  input: Partial<SessionRecord> & { id: string },
  now: number,
): SessionRecord {
  return {
    id: input.id,
    lessonId: input.lessonId ?? existing?.lessonId ?? null,
    phase: input.phase ?? existing?.phase ?? "created",
    meetingUrl: input.meetingUrl ?? existing?.meetingUrl ?? null,
    botId: input.botId ?? existing?.botId ?? null,
    characterSessionId:
      input.characterSessionId ?? existing?.characterSessionId ?? null,
    browserSessionId:
      input.browserSessionId ?? existing?.browserSessionId ?? null,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
}

/** Apply a partial patch; `undefined` fields are left untouched, `null` clears. */
function applySessionPatch(
  existing: SessionRecord,
  patch: Partial<SessionRecord>,
  now: number,
): SessionRecord {
  return {
    id: existing.id,
    lessonId: patch.lessonId !== undefined ? patch.lessonId : existing.lessonId,
    phase: patch.phase !== undefined ? patch.phase : existing.phase,
    meetingUrl:
      patch.meetingUrl !== undefined ? patch.meetingUrl : existing.meetingUrl,
    botId: patch.botId !== undefined ? patch.botId : existing.botId,
    characterSessionId:
      patch.characterSessionId !== undefined
        ? patch.characterSessionId
        : existing.characterSessionId,
    browserSessionId:
      patch.browserSessionId !== undefined
        ? patch.browserSessionId
        : existing.browserSessionId,
    createdAt:
      patch.createdAt !== undefined ? patch.createdAt : existing.createdAt,
    updatedAt: now,
  };
}

function cloneState(s: LessonRunState): LessonRunState {
  return {
    lessonId: s.lessonId,
    sessionId: s.sessionId,
    stepIndex: s.stepIndex,
    done: s.done,
    artifacts: s.artifacts.map((a) => ({ ...a })),
  };
}

// ── In-memory repository (deterministic resilience fallback) ────────────────

/**
 * Pure in-memory Repository. The resilience fallback used when DATABASE access
 * is unavailable. No I/O, no external services — boots instantly.
 */
export function createInMemoryRepository(): Repository {
  const sessionStore = new Map<string, SessionRecord>();
  const transcriptStore = new Map<string, TranscriptLine[]>();
  const traceStore = new Map<string, TraceEntry[]>();
  const artifactStore = new Map<string, ArtifactRef[]>();
  const progressStore = new Map<string, LessonRunState>();

  return {
    async createSession(input) {
      const now = Date.now();
      const existing = sessionStore.get(input.id);
      const rec = mergeForCreate(existing, input, now);
      sessionStore.set(rec.id, rec);
      return { ...rec };
    },

    async getSession(id) {
      const rec = sessionStore.get(id);
      return rec ? { ...rec } : null;
    },

    async updateSession(id, patch) {
      const existing = sessionStore.get(id);
      if (!existing) throw new Error(`session not found: ${id}`);
      const updated = applySessionPatch(existing, patch, Date.now());
      sessionStore.set(id, updated);
      return { ...updated };
    },

    async appendTranscript(sessionId, line) {
      const arr = transcriptStore.get(sessionId) ?? [];
      arr.push({ ts: line.ts, speaker: line.speaker, text: line.text });
      transcriptStore.set(sessionId, arr);
    },

    async getTranscript(sessionId) {
      const arr = transcriptStore.get(sessionId) ?? [];
      return arr.map((l) => ({ ...l })).sort((a, b) => a.ts - b.ts);
    },

    async appendTrace(sessionId, entry) {
      const arr = traceStore.get(sessionId) ?? [];
      arr.push({ ts: entry.ts, kind: entry.kind, data: entry.data });
      traceStore.set(sessionId, arr);
    },

    async saveArtifact(sessionId, artifact) {
      const arr = artifactStore.get(sessionId) ?? [];
      arr.push({ kind: artifact.kind, name: artifact.name, url: artifact.url });
      artifactStore.set(sessionId, arr);
    },

    async getArtifacts(sessionId) {
      const arr = artifactStore.get(sessionId) ?? [];
      return arr.map((a) => ({ ...a }));
    },

    async saveProgress(sessionId, state) {
      progressStore.set(sessionId, cloneState(state));
    },

    async getProgress(sessionId) {
      const s = progressStore.get(sessionId);
      return s ? cloneState(s) : null;
    },
  };
}

// ── Postgres operations (stateless; each uses the lazy drizzle singleton) ───

async function pgCreateSession(
  input: Partial<SessionRecord> & { id: string },
): Promise<SessionRecord> {
  const db = getDb();
  const now = Date.now();
  const existingRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, input.id))
    .limit(1);
  const existing = existingRows[0] ? mapSessionRow(existingRows[0]) : undefined;
  const rec = mergeForCreate(existing, input, now);
  await db
    .insert(sessions)
    .values(rec)
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        lessonId: rec.lessonId,
        phase: rec.phase,
        meetingUrl: rec.meetingUrl,
        botId: rec.botId,
        characterSessionId: rec.characterSessionId,
        browserSessionId: rec.browserSessionId,
        updatedAt: rec.updatedAt,
      },
    });
  return rec;
}

async function pgGetSession(id: string): Promise<SessionRecord | null> {
  const rows = await getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  return rows[0] ? mapSessionRow(rows[0]) : null;
}

async function pgUpdateSession(
  id: string,
  patch: Partial<SessionRecord>,
): Promise<SessionRecord> {
  const db = getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  if (rows.length === 0) throw new Error(`session not found: ${id}`);
  const updated = applySessionPatch(mapSessionRow(rows[0]), patch, Date.now());
  await db
    .update(sessions)
    .set({
      lessonId: updated.lessonId,
      phase: updated.phase,
      meetingUrl: updated.meetingUrl,
      botId: updated.botId,
      characterSessionId: updated.characterSessionId,
      browserSessionId: updated.browserSessionId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    })
    .where(eq(sessions.id, id));
  return updated;
}

async function pgAppendTranscript(
  sessionId: string,
  line: TranscriptLine,
): Promise<void> {
  await getDb().insert(transcripts).values({
    sessionId,
    ts: line.ts,
    speaker: line.speaker,
    text: line.text,
  });
}

async function pgGetTranscript(sessionId: string): Promise<TranscriptLine[]> {
  const rows = await getDb()
    .select()
    .from(transcripts)
    .where(eq(transcripts.sessionId, sessionId))
    .orderBy(asc(transcripts.ts), asc(transcripts.id));
  return rows.map((r) => ({
    ts: r.ts,
    speaker: r.speaker as TranscriptLine["speaker"],
    text: r.text,
  }));
}

async function pgAppendTrace(
  sessionId: string,
  entry: TraceEntry,
): Promise<void> {
  await getDb().insert(traces).values({
    sessionId,
    ts: entry.ts,
    kind: entry.kind,
    data: entry.data,
  });
}

async function pgSaveArtifact(
  sessionId: string,
  artifact: ArtifactRef,
): Promise<void> {
  await getDb().insert(artifacts).values({
    sessionId,
    kind: artifact.kind,
    name: artifact.name,
    url: artifact.url,
  });
}

async function pgGetArtifacts(sessionId: string): Promise<ArtifactRef[]> {
  const rows = await getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))
    .orderBy(asc(artifacts.id));
  return rows.map((r) => ({ kind: r.kind, name: r.name, url: r.url }));
}

async function pgSaveProgress(
  sessionId: string,
  state: LessonRunState,
): Promise<void> {
  const done = state.done ? "true" : "false";
  await getDb()
    .insert(progress)
    .values({
      sessionId,
      lessonId: state.lessonId,
      stepIndex: state.stepIndex,
      done,
      state,
    })
    .onConflictDoUpdate({
      target: progress.sessionId,
      set: {
        lessonId: state.lessonId,
        stepIndex: state.stepIndex,
        done,
        state,
      },
    });
}

async function pgGetProgress(
  sessionId: string,
): Promise<LessonRunState | null> {
  const rows = await getDb()
    .select()
    .from(progress)
    .where(eq(progress.sessionId, sessionId))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].state as LessonRunState;
}

// ── Postgres repository with health-ping + degrade-to-memory resilience ─────

function createPostgresRepository(): Repository {
  const mem = createInMemoryRepository();

  // "unknown" until the first op triggers a health ping. Memoised across calls.
  let resolved: "pg" | "mem" | null = null;
  let ping: Promise<void> | null = null;

  async function usePg(): Promise<boolean> {
    if (resolved === "pg") return true;
    if (resolved === "mem") return false;
    if (!ping) {
      ping = (async () => {
        try {
          await getDb().execute(sql`select 1`);
          resolved = "pg";
        } catch (err) {
          resolved = "mem";
          console.warn(
            `[repo] postgres health ping failed; falling back to in-memory repository: ${errMsg(
              err,
            )}`,
          );
        }
      })();
    }
    await ping;
    return resolved === "pg";
  }

  function degrade(err: unknown): void {
    if (resolved !== "mem") {
      resolved = "mem";
      console.warn(
        `[repo] postgres operation failed; degrading to in-memory repository: ${errMsg(
          err,
        )}`,
      );
    }
  }

  // Run the real op when healthy; on first-ping failure or any op error, fall
  // back to the in-memory store so the app keeps running.
  async function run<T>(
    real: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    if (!(await usePg())) return fallback();
    try {
      return await real();
    } catch (err) {
      degrade(err);
      return fallback();
    }
  }

  return {
    createSession: (input) =>
      run(
        () => pgCreateSession(input),
        () => mem.createSession(input),
      ),
    getSession: (id) =>
      run(
        () => pgGetSession(id),
        () => mem.getSession(id),
      ),
    updateSession: (id, patch) =>
      run(
        () => pgUpdateSession(id, patch),
        () => mem.updateSession(id, patch),
      ),
    appendTranscript: (sessionId, line) =>
      run(
        () => pgAppendTranscript(sessionId, line),
        () => mem.appendTranscript(sessionId, line),
      ),
    getTranscript: (sessionId) =>
      run(
        () => pgGetTranscript(sessionId),
        () => mem.getTranscript(sessionId),
      ),
    appendTrace: (sessionId, entry) =>
      run(
        () => pgAppendTrace(sessionId, entry),
        () => mem.appendTrace(sessionId, entry),
      ),
    saveArtifact: (sessionId, artifact) =>
      run(
        () => pgSaveArtifact(sessionId, artifact),
        () => mem.saveArtifact(sessionId, artifact),
      ),
    getArtifacts: (sessionId) =>
      run(
        () => pgGetArtifacts(sessionId),
        () => mem.getArtifacts(sessionId),
      ),
    saveProgress: (sessionId, state) =>
      run(
        () => pgSaveProgress(sessionId, state),
        () => mem.saveProgress(sessionId, state),
      ),
    getProgress: (sessionId) =>
      run(
        () => pgGetProgress(sessionId),
        () => mem.getProgress(sessionId),
      ),
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Construct the Repository for the current environment.
 *
 * Always returns the Postgres-backed repo, which health-pings on first use and
 * transparently degrades to an in-memory store if the DB is unreachable. There
 * is no mock switch — `databaseUrl` always has a default, so persistence is
 * always "configured"; reachability is what gates real vs. the resilience
 * fallback. The in-memory store is a degrade path, not a mock.
 */
export function createRepository(_env: Env): Repository {
  return createPostgresRepository();
}
