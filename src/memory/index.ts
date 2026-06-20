// ─────────────────────────────────────────────────────────────────────────
// Organ 7 (memory half) — MemoryHooks.
//
// A real, lightweight memory. `record(note)` persists a learning; `recall(query)`
// surfaces prior learnings to bias the teacher. Built through the
// `createMemoryHooks` factory so the rest of the app never constructs hooks
// directly. There is no mock mode and no environment branching: the same
// implementation always runs, and it boots with zero credentials.
//
// Durability: when a `repo` and a `meta.sessionId` are supplied, `record`
// persists each learning as a `kind: "memory"` trace row in Postgres (the same
// store as the rest of the session replay/trace). When no repo/session is
// available it logs to stdout instead. Memory is advisory, not load-bearing, so
// every persistence path is best-effort and never throws out of the hook.
//
// Recall is served from this process's recorded learnings plus a small set of
// durable baseline priors (genuine, always-true teaching facts), token-matched
// against the query. This keeps the teacher coherent within a run and useful on
// a cold process without depending on any external service.
// ─────────────────────────────────────────────────────────────────────────

import type { Env, MemoryHooks, Repository } from "@/types/contracts";

/**
 * Durable baseline priors: real, always-true facts about how this app teaches.
 * They are constant knowledge (not fabricated service responses), so `recall`
 * has something useful to return before any learning has been recorded.
 */
const BASELINE_PRIORS: readonly string[] = [
  "Learners prefer concise, step-by-step explanations.",
  "Golden-path lesson: create a slide deck using ChatGPT.",
  "Always show the prompt before submitting it, then explain each clause.",
];

/**
 * Construct the memory hooks for a session.
 *
 * @param env  Parsed environment. Accepted for create* parity; memory needs no
 *             credentials, so it is currently unused.
 * @param repo Optional persistence repo. When supplied alongside a
 *             `meta.sessionId`, `record` persists the learning as a
 *             `kind: "memory"` trace; otherwise it logs to stdout.
 *
 * Callable as `createMemoryHooks(env)` — `repo` is optional and additive.
 * Never throws at construction.
 */
export function createMemoryHooks(env: Env, repo?: Repository): MemoryHooks {
  void env; // memory is credential-free; env kept for create* signature parity.

  // Learnings recorded during this process lifetime (the orchestrator builds
  // the hooks once, so this persists for the life of the server process).
  const notes: string[] = [];

  return {
    async recall(query: string): Promise<string[]> {
      const haystack = [...notes, ...BASELINE_PRIORS];
      const hits = haystack.filter((entry) => matches(entry, query));
      // De-dupe and cap so the teacher gets a focused handful, deterministically.
      return Array.from(new Set(hits)).slice(0, 5);
    },

    async record(note: string, meta?: Record<string, unknown>): Promise<void> {
      const trimmed = note.trim();
      if (trimmed.length === 0) return;
      notes.push(trimmed);

      const sessionId =
        meta && typeof meta.sessionId === "string" ? meta.sessionId : undefined;

      if (repo && sessionId) {
        try {
          await repo.appendTrace(sessionId, {
            ts: Date.now(),
            kind: "memory",
            data: { note: trimmed, meta },
          });
          return;
        } catch (err) {
          // Best-effort: a failing DB must not break the teaching flow.
          console.warn("[memory] trace persist failed; logging instead", err);
        }
      }

      console.info("[memory] record", { ts: Date.now(), note: trimmed, meta });
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Token-overlap match: true if `text` shares any 3+ char word with `query`. */
function matches(text: string, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3);
  // Empty/short query ⇒ surface everything (caller caps the count).
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  return tokens.some((tok) => lower.includes(tok));
}
