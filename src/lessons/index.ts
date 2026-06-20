// ─────────────────────────────────────────────────────────────────────────
// Organ 6 — Lesson engine.
//
// In-memory, deterministic state machine keyed by sessionId. The orchestrator
// owns the loop; this engine just answers "what's the current step?", advances
// on completion, evaluates checkpoint answers, and enforces the per-step
// domain allowlist. Pure logic — no external services and no environment
// branching; it boots with zero credentials and behaves identically every run.
// ─────────────────────────────────────────────────────────────────────────

import type {
  Lesson,
  LessonEngine,
  LessonRunState,
  LessonStep,
} from "@/types/contracts";

import {
  pptLesson,
  buildPptLesson,
  buildPptPrompt,
  PPT_LESSON_ID,
  PPT_ALLOWLIST,
  DEFAULT_PPT_TOPIC,
} from "./lesson-ppt";
import {
  imageLesson,
  buildImageLesson,
  IMAGE_LESSON_ID,
  EXAMPLE_IMAGE_PROMPT,
} from "./lesson-image";
import {
  researchLesson,
  buildResearchLesson,
  buildResearchPrompt,
  RESEARCH_LESSON_ID,
  DEFAULT_RESEARCH_TOPIC,
} from "./lesson-research";

/** Lesson catalog. Lesson 1 (the golden path) is first by design. */
export const lessons: Lesson[] = [pptLesson, imageLesson, researchLesson];

// ── allowlist helpers ──────────────────────────────────────────────────────

/** Extract a lowercased hostname from a URL or bare host string. */
function hostOf(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** True if `url`'s host matches (exactly or as a subdomain of) any allowed domain. */
function domainAllowed(url: string, allow: readonly string[]): boolean {
  const host = hostOf(url);
  return allow.some((d) => {
    const dom = d.trim().toLowerCase();
    if (!dom) return false;
    return host === dom || host.endsWith(`.${dom}`);
  });
}

// ── engine ─────────────────────────────────────────────────────────────────

class InMemoryLessonEngine implements LessonEngine {
  private readonly catalog: Lesson[];
  private readonly states = new Map<string, LessonRunState>();

  constructor(catalog: Lesson[]) {
    this.catalog = catalog;
  }

  list(): Lesson[] {
    return this.catalog;
  }

  get(lessonId: string): Lesson | undefined {
    return this.catalog.find((l) => l.id === lessonId);
  }

  start(lessonId: string, sessionId: string): LessonRunState {
    const lesson = this.get(lessonId);
    if (!lesson) {
      throw new Error(
        `Unknown lesson "${lessonId}". Known lessons: ${this.catalog
          .map((l) => l.id)
          .join(", ")}`,
      );
    }
    const state: LessonRunState = {
      lessonId,
      sessionId,
      stepIndex: 0,
      done: lesson.steps.length === 0,
      artifacts: [],
    };
    this.states.set(sessionId, state);
    return this.snapshot(state);
  }

  current(sessionId: string): LessonRunState | undefined {
    const state = this.states.get(sessionId);
    return state ? this.snapshot(state) : undefined;
  }

  advance(sessionId: string): LessonRunState | undefined {
    const state = this.states.get(sessionId);
    if (!state) return undefined;
    if (state.done) return this.snapshot(state);

    const lesson = this.get(state.lessonId);
    if (!lesson) return undefined;

    const next = state.stepIndex + 1;
    if (next >= lesson.steps.length) {
      // Last step completed — clamp to the final index and mark done.
      state.stepIndex = Math.max(0, lesson.steps.length - 1);
      state.done = true;
    } else {
      state.stepIndex = next;
    }
    return this.snapshot(state);
  }

  complete(sessionId: string): LessonRunState | undefined {
    const state = this.states.get(sessionId);
    if (!state) return undefined;
    const lesson = this.get(state.lessonId);
    // Clamp to the final step and flip done — the director loop ends on the
    // director's own `done`/budget, not by walking the fixed steps.
    if (lesson && lesson.steps.length > 0) {
      state.stepIndex = lesson.steps.length - 1;
    }
    state.done = true;
    return this.snapshot(state);
  }

  answer(sessionId: string, response: string): { passed: boolean; feedback: string } {
    const step = this.currentStep(sessionId);
    if (!step) {
      return { passed: false, feedback: "There's no active lesson for this session." };
    }
    if (step.kind !== "checkpoint" || !step.checkpoint) {
      return { passed: false, feedback: "There's no question to answer right now." };
    }

    const given = response.trim();
    const expects = step.checkpoint.expects;

    // No expected answer configured — accept any non-empty response.
    if (!expects) {
      const ok = given.length > 0;
      return ok
        ? { passed: true, feedback: "Got it — thanks. Let's keep going." }
        : { passed: false, feedback: "I didn't catch an answer — could you say that again?" };
    }

    const passed = given.toLowerCase().includes(expects.toLowerCase());
    if (passed) {
      return { passed: true, feedback: `Perfect — "${given}" works. Let's continue.` };
    }
    return {
      passed: false,
      feedback: `No problem. For this step we'll go with "${expects}", and I'll carry on from there.`,
    };
  }

  isAllowed(sessionId: string, url: string): boolean {
    // Prefer the current step's allowlist (legacy step loop); otherwise fall back
    // to the lesson-level allowlist (director loop, which never walks steps).
    const step = this.currentStep(sessionId);
    const allow =
      step?.allowlist && step.allowlist.length > 0
        ? step.allowlist
        : this.allowlistFor(sessionId);
    // No allowlist anywhere => allow everything.
    if (!allow || allow.length === 0) return true;
    return domainAllowed(url, allow);
  }

  allowlistFor(sessionId: string): string[] {
    const state = this.states.get(sessionId);
    const lesson = state ? this.get(state.lessonId) : undefined;
    if (!lesson) return [];
    if (lesson.allowlist && lesson.allowlist.length > 0) {
      return [...lesson.allowlist];
    }
    // Older lessons without a lesson-level allowlist: union of step allowlists.
    const union = new Set<string>();
    for (const s of lesson.steps) {
      for (const d of s.allowlist ?? []) union.add(d);
    }
    return [...union];
  }

  // ── internals ──────────────────────────────────────────────────────────

  private currentStep(sessionId: string): LessonStep | undefined {
    const state = this.states.get(sessionId);
    if (!state) return undefined;
    const lesson = this.get(state.lessonId);
    return lesson?.steps[state.stepIndex];
  }

  /** Defensive copy so callers can't mutate internal run state. */
  private snapshot(state: LessonRunState): LessonRunState {
    return {
      lessonId: state.lessonId,
      sessionId: state.sessionId,
      stepIndex: state.stepIndex,
      done: state.done,
      artifacts: state.artifacts.map((a) => ({ ...a })),
    };
  }
}

/** Factory: construct a fresh in-memory lesson engine over the catalog. */
export function createLessonEngine(): LessonEngine {
  return new InMemoryLessonEngine(lessons);
}

// ── re-exports (orchestrator + UI convenience) ──────────────────────────────

export {
  // Lesson 1 — golden path
  pptLesson,
  buildPptLesson,
  buildPptPrompt,
  PPT_LESSON_ID,
  PPT_ALLOWLIST,
  DEFAULT_PPT_TOPIC,
  // Lesson 2 — image prompt
  imageLesson,
  buildImageLesson,
  IMAGE_LESSON_ID,
  EXAMPLE_IMAGE_PROMPT,
  // Lesson 3 — research
  researchLesson,
  buildResearchLesson,
  buildResearchPrompt,
  RESEARCH_LESSON_ID,
  DEFAULT_RESEARCH_TOPIC,
};
