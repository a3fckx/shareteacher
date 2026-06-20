// ─────────────────────────────────────────────────────────────────────────
// Organ 0 — Orchestrator.
//
// getOrchestrator() builds the Env (getEnv) and all seven organs ONCE, then
// exposes the session lifecycle the API routes call:
//
//   createSession({ lessonId, meetingUrl? }) -> sessionId   (phase "created")
//   runSession(sessionId)                     -> async teaching loop
//   answer(sessionId, response)               -> resolve a human checkpoint
//   joinMeeting(sessionId, meetingUrl)        -> send the screen into a call
//   takeover(sessionId)                       -> hand the browser to a human
//   stop(sessionId)                           -> tear the session down
//   getSummary(sessionId)                     -> session + transcript + artifacts
//   listLessons()                             -> id/title/goal catalog
//
// The live avatar is brought up entirely CLIENT-SIDE (the browser POSTs to
// /api/session/[id]/avatar, which runs its own create -> poll -> consume chain);
// the loop does NOT start a second, redundant Runway realtime session. The loop
// optionally joins the meeting, then STEPS the LessonEngine: `say` narrates a
// transcript line, `tool`/`artifact` dispatch a ToolHandler, `checkpoint` emits
// a question and ALWAYS awaits a real human answer() (with a timeout fallback so
// a silent classroom never hangs forever). There is no mock/auto mode — a live
// lesson legitimately needs live services plus a human (mic, ChatGPT login).
//
// Server-only module. Never import into a client component.
// ─────────────────────────────────────────────────────────────────────────

import { nanoid } from "nanoid";

import { getEnv } from "@/server/env";
import { createCharacterAgent } from "@/integrations/runway";
import { createMeetingBot } from "@/integrations/recall";
import { createBrowserRuntime } from "@/integrations/kernel";
import { createBrowserController } from "@/integrations/browser";
import { createLessonEngine } from "@/lessons";
import { createRepository } from "@/db/repo";
import { createMemoryHooks } from "@/memory";

import { toolRegistry } from "./tools";
import { publish } from "./sse";

import type {
  ArtifactRef,
  BotStatus,
  BrowserSessionInfo,
  DirectResponse,
  DirectorTurn,
  Env,
  Lesson,
  LessonRunState,
  LessonStep,
  ObserveResult,
  SessionRecord,
  ToolContext,
  ToolName,
  TranscriptLine,
  UiAction,
} from "@/types/contracts";

// ── tunables ─────────────────────────────────────────────────────────────────

const STEP_DELAY_MS = 700; // pause between steps/turns so it feels live
const ANSWER_TIMEOUT_MS = 120_000; // human-answer ceiling before fallback
// Director loop: how many TeachingDirector turns before we force-complete the
// class. The director also returns `done` once the lesson goal is met, and the
// sidecar force-ends when turns_remaining hits 0 — this is the outer ceiling.
const MAX_DIRECTOR_TURNS = 40;
// The live GWM-1 avatar has NO inbound text/speech channel (verified by the
// speech-research track): it ad-libs from persona + startScript + what it hears/
// sees, and there is no supported "say" API. So narration is authoritative ON
// SCREEN (transcript + caption StageEvents) and only GROUNDS the avatar via
// sendContext — it is never depended on to be recited aloud. Flip to true only
// if a real live say() mechanism is ever found.
const AVATAR_CAN_SPEAK = false;
// After this many CONSECUTIVE mid-loop director failures we end the loop rather
// than spin — a turn-0 failure instead falls back to the fixed lesson steps.
const MAX_DIRECTOR_FAILURES = 3;
// Cadence of the always-on screenshot stream. ~1.4fps JPEG keeps the browser
// reliably visible (the live-view iframe paints black for an unattended page)
// while staying trivially cheap (~60–180KB/s on localhost).
const SCREENSHOT_INTERVAL_MS = 1500;
// Back-off when a frame capture fails (e.g. mid tab/target switch) so we don't
// hammer the sidecar; the viewport keeps showing the previous frame meanwhile.
const SCREENSHOT_BACKOFF_MS = 2500;

// ── public shapes ────────────────────────────────────────────────────────────

export interface SessionSummary {
  session: SessionRecord | null;
  transcript: TranscriptLine[];
  artifacts: ArtifactRef[];
  progress: LessonRunState | null;
}

export interface Orchestrator {
  createSession(input: { lessonId: string; meetingUrl?: string }): Promise<string>;
  runSession(sessionId: string): Promise<void>;
  answer(sessionId: string, response: string): Promise<void>;
  joinMeeting(
    sessionId: string,
    meetingUrl: string,
  ): Promise<{ botId: string; status: BotStatus }>;
  takeover(sessionId: string): Promise<string>;
  stop(sessionId: string): Promise<void>;
  getSummary(sessionId: string): Promise<SessionSummary>;
  listLessons(): { id: string; title: string; goal: string }[];
}

// ── per-session runtime state (loop control + human-answer signalling) ───────

interface SessionRuntime {
  sessionId: string;
  stopped: boolean;
  takenOver: boolean;
  /** Set while the loop is blocked awaiting a human checkpoint answer. */
  awaitingAnswer: ((response: string) => void) | null;
  /**
   * Student messages that arrived OUTSIDE a checkpoint (live interjections).
   * The director loop drains this each turn into `student_message` so the brain
   * can react to questions mid-class. Resolved checkpoints bypass this queue.
   */
  studentInbox: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stageOutputUrl(baseUrl: string, sessionId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("session", sessionId);
  return url.toString();
}

async function safe(fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn("[orchestrator] non-fatal:", errMsg(err));
  }
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ── arg coercion for the director's open-shaped ui_action args ───────────────

function argStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function argStrList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

/** Empty page summary used on cold start / when an observe() call fails. */
const EMPTY_OBSERVE: ObserveResult = {
  url: "",
  title: "",
  elements: [],
  text: "",
};

// ── orchestrator construction ────────────────────────────────────────────────

function buildOrchestrator(env: Env): Orchestrator {
  // The seven organs, constructed once.
  const repo = createRepository(env); // Organ 7 — data
  const character = createCharacterAgent(env); // Organ 1 — Runway
  const meetingBot = createMeetingBot(env); // Organ 2 — Recall
  const browserRuntime = createBrowserRuntime(env); // Organ 3 — Kernel
  const browser = createBrowserController(env); // Organ 4 — controller
  const lessons = createLessonEngine(); // Organ 6 — lessons
  const memory = createMemoryHooks(env, repo); // Organ 7 — memory

  const runtimes = new Map<string, SessionRuntime>();

  // ── browser warm-up + live-stream state ───────────────────────────────────
  // PRE-WARM: the Kernel browser (~12s cold start) is kicked off at
  // createSession time so the boot overlaps avatar bring-up and the first
  // narration steps, hiding it from the teaching critical path.
  //   warmBrowsers  — the in-flight/resolved cold-start promise per session.
  //   attachedSet   — sessions whose controller has been attached (attach once).
  //   liveSessions  — dedup guard so ensureBrowserLive runs its attach exactly
  //                   once even when prewarm and the start_browser_session tool
  //                   race to consume the same warm browser.
  //   streams       — the per-session screenshot-stream loop handle.
  const warmBrowsers = new Map<string, Promise<BrowserSessionInfo>>();
  const attachedSet = new Set<string>();
  const liveSessions = new Map<string, Promise<BrowserSessionInfo>>();

  interface StreamState {
    timer: ReturnType<typeof setTimeout> | null;
    cancelled: boolean;
  }
  const streams = new Map<string, StreamState>();

  /**
   * Server-driven screenshot stream: every ~1.5s grab a lock-free JPEG frame
   * from the controller and publish it as a `screenshot` StageEvent so the
   * classroom UI (and the Recall webpage-camera) always shows a fresh, reliable
   * browser image — independent of whether the live-view iframe renders.
   * A single shared pump per session (capture is not per-viewer). Idempotent.
   */
  function startScreenshotStream(sessionId: string): void {
    if (streams.has(sessionId)) return;
    if (!browser.frame) return; // controller without a stream surface — skip.
    const st: StreamState = { timer: null, cancelled: false };
    streams.set(sessionId, st);

    const tick = async (): Promise<void> => {
      if (st.cancelled) return;
      const rt = runtimes.get(sessionId);
      if (rt?.stopped) {
        stopScreenshotStream(sessionId);
        return;
      }
      let nextDelay = SCREENSHOT_INTERVAL_MS;
      try {
        const dataUrl = browser.frame ? await browser.frame() : null;
        if (!st.cancelled && dataUrl) {
          publish(sessionId, { type: "screenshot", url: dataUrl });
        }
      } catch {
        // Capture hiccup (e.g. mid target switch) — keep the last frame, back off.
        nextDelay = SCREENSHOT_BACKOFF_MS;
      }
      if (st.cancelled) return;
      st.timer = setTimeout(() => void tick(), nextDelay);
    };

    // Kick off on the next tick so the caller (attach) finishes first.
    st.timer = setTimeout(() => void tick(), 0);
  }

  function stopScreenshotStream(sessionId: string): void {
    const st = streams.get(sessionId);
    if (!st) return;
    st.cancelled = true;
    if (st.timer) clearTimeout(st.timer);
    streams.delete(sessionId);
  }

  /**
   * Bring the shared Kernel browser live: consume the pre-warmed cold-start when
   * present (else cold-start now), attach the controller once, persist the
   * runtime session id, and start the screenshot stream. Deduped per session so
   * a racing prewarm + start_browser_session tool never double-attach or spawn a
   * second Kernel browser.
   */
  function ensureBrowserLive(sessionId: string): Promise<BrowserSessionInfo> {
    const inflight = liveSessions.get(sessionId);
    if (inflight) return inflight;
    const p = (async () => {
      const warm = warmBrowsers.get(sessionId);
      const info = warm
        ? await warm
        : await browserRuntime.startSession(env.kernel.profileName);
      if (!attachedSet.has(sessionId)) {
        await browser.attach(info);
        attachedSet.add(sessionId);
      }
      await safe(() =>
        repo.updateSession(sessionId, { browserSessionId: info.sessionId }),
      );
      startScreenshotStream(sessionId);
      return info;
    })();
    liveSessions.set(sessionId, p);
    p.catch(() => liveSessions.delete(sessionId));
    return p;
  }

  /** Kick the cold start at createSession time and bring it live in the
   *  background, emitting browser_view as soon as the live URL is known. */
  function prewarmBrowser(sessionId: string): void {
    if (warmBrowsers.has(sessionId)) return;
    warmBrowsers.set(
      sessionId,
      browserRuntime.startSession(env.kernel.profileName),
    );
    void ensureBrowserLive(sessionId)
      .then((info) =>
        publish(sessionId, { type: "browser_view", liveUrl: info.liveViewUrl }),
      )
      .catch((err) => {
        // Pre-warm is opportunistic — failure is recovered when the lesson's
        // start_browser_session step runs ensureBrowserLive again.
        warmBrowsers.delete(sessionId);
        console.warn("[orchestrator] browser prewarm failed:", errMsg(err));
      });
  }

  /** Tear down all browser warm/stream state for a session (used by stop()). */
  async function teardownBrowser(sessionId: string): Promise<void> {
    stopScreenshotStream(sessionId);
    attachedSet.delete(sessionId);
    liveSessions.delete(sessionId);
    // If a prewarm is still in-flight (or resolved but never consumed), make
    // sure its Kernel browser is stopped so free-plan minutes aren't burned.
    const warm = warmBrowsers.get(sessionId);
    warmBrowsers.delete(sessionId);
    if (warm) {
      await safe(async () => {
        const info = await warm;
        await browserRuntime.stopSession(info.sessionId);
      });
    }
  }

  function ensureRuntime(sessionId: string): SessionRuntime {
    let rt = runtimes.get(sessionId);
    if (!rt) {
      rt = {
        sessionId,
        stopped: false,
        takenOver: false,
        awaitingAnswer: null,
        studentInbox: [],
      };
      runtimes.set(sessionId, rt);
    }
    return rt;
  }

  function makeCtx(sessionId: string): ToolContext {
    return {
      sessionId,
      browser,
      runtime: browserRuntime,
      repo,
      lessons,
      // Every browser session binds to the one persistent ChatGPT-login profile.
      kernelProfile: env.kernel.profileName,
      emit: (event) => publish(sessionId, event),
      ensureBrowserLive: () => ensureBrowserLive(sessionId),
    };
  }

  // ── transcript helpers (persist + stream + best-effort avatar narration) ──

  async function narrateTeacher(sessionId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await safe(() => character.narrate(sessionId, trimmed, "teacher"));
    await safe(() =>
      repo.appendTranscript(sessionId, {
        ts: Date.now(),
        speaker: "teacher",
        text: trimmed,
      }),
    );
    publish(sessionId, { type: "transcript", speaker: "teacher", text: trimmed });
  }

  async function narrateHuman(sessionId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await safe(() =>
      repo.appendTranscript(sessionId, {
        ts: Date.now(),
        speaker: "human",
        text: trimmed,
      }),
    );
    publish(sessionId, { type: "transcript", speaker: "human", text: trimmed });
  }

  // ── tool dispatch (each handler emits its own StageEvent) ─────────────────

  async function dispatchTool(
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<void> {
    const handler = toolRegistry[name];
    if (!handler) {
      publish(sessionId, {
        type: "status",
        phase: "teaching",
        detail: `unknown tool: ${name}`,
      });
      return;
    }
    await safe(() =>
      repo.appendTrace(sessionId, {
        ts: Date.now(),
        kind: "tool_call",
        data: { name, args },
      }),
    );
    try {
      const data = await handler(args, makeCtx(sessionId));
      await safe(() =>
        repo.appendTrace(sessionId, {
          ts: Date.now(),
          kind: "tool_result",
          data: { name, ok: true, data },
        }),
      );
    } catch (err) {
      // Resilience: a single tool failure must not kill the class. Log, trace,
      // surface a status, and let the lesson continue.
      await safe(() =>
        repo.appendTrace(sessionId, {
          ts: Date.now(),
          kind: "tool_error",
          data: { name, error: errMsg(err) },
        }),
      );
      publish(sessionId, {
        type: "status",
        phase: "teaching",
        detail: `tool ${name} failed: ${errMsg(err)}`,
      });
    }
  }

  // ── checkpoint resolution (auto vs human) ─────────────────────────────────

  /**
   * Park the loop until a human answer() signals, with a timeout fallback so a
   * silent classroom never hangs forever. Shared by the legacy step checkpoints
   * and the director's `checkpoint` action. There is no auto-resolve.
   */
  function parkForAnswer(rt: SessionRuntime, fallback: string): Promise<string> {
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        rt.awaitingAnswer = null;
        resolve(value);
      };
      rt.awaitingAnswer = (response) => finish(response);
      setTimeout(() => finish(fallback), ANSWER_TIMEOUT_MS);
    });
  }

  function resolveCheckpoint(
    rt: SessionRuntime,
    cp: NonNullable<LessonStep["checkpoint"]>,
  ): Promise<string> {
    return parkForAnswer(rt, cp.expects ?? cp.choices?.[0] ?? "yes");
  }

  async function handleCheckpoint(
    sessionId: string,
    rt: SessionRuntime,
    cp: NonNullable<LessonStep["checkpoint"]>,
  ): Promise<void> {
    publish(sessionId, {
      type: "checkpoint",
      question: cp.question,
      choices: cp.choices,
    });
    const response = await resolveCheckpoint(rt, cp);
    if (rt.stopped) return;
    await narrateHuman(sessionId, response);
    const result = lessons.answer(sessionId, response);
    await narrateTeacher(sessionId, result.feedback);
  }

  // ── one step ──────────────────────────────────────────────────────────────

  async function processStep(
    sessionId: string,
    rt: SessionRuntime,
    step: LessonStep,
  ): Promise<void> {
    // Every step that carries narration speaks it first.
    if (step.say && step.say.trim()) {
      await narrateTeacher(sessionId, step.say);
    }
    if (rt.stopped) return;

    switch (step.kind) {
      case "say":
        break;
      case "tool":
      case "artifact":
        if (step.tool) {
          await dispatchTool(sessionId, step.tool.name, step.tool.args);
        }
        break;
      case "checkpoint":
        if (step.checkpoint) {
          await handleCheckpoint(sessionId, rt, step.checkpoint);
        }
        break;
    }
  }

  // ── director loop (DSPy TeachingDirector drives every turn) ───────────────

  /**
   * Ground the live avatar with the director's intent for this turn. GWM-1 has
   * NO inbound text channel, so this is the ONLY supported lever (best-effort
   * sendContext) — it nudges the avatar's ad-lib toward the current beat. The
   * exact teaching CONTENT is shown on screen via the transcript StageEvent
   * (narrateTeacher), never depended on to be recited by the avatar.
   */
  async function groundAvatar(
    sessionId: string,
    resp: DirectResponse,
  ): Promise<void> {
    const grounding = [
      resp.milestone ? `Current focus: ${resp.milestone}.` : "",
      resp.screen_summary ? `On screen: ${resp.screen_summary}` : "",
      resp.narration ? `Teaching point: ${resp.narration}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (grounding) {
      await safe(() => character.sendContext(sessionId, grounding));
    }
  }

  /**
   * Execute the director's single chosen ui_action. Browser/flow/output verbs map
   * onto EXISTING tool-registry handlers (so the StageEvent + ToolName contracts
   * are untouched); on-stage overlay verbs with no existing handler are emitted
   * as the additive `ui_action` StageEvent for the overlay UI to route. The
   * allowlist is enforced again inside browser_open + the sidecar (defence in
   * depth). `done`/`checkpoint`/`none` are handled by the loop, not here.
   */
  async function executeUiAction(
    sessionId: string,
    action: UiAction,
    allowlist: string[],
  ): Promise<void> {
    const args = action.args ?? {};
    switch (action.tool) {
      // ── browser actuation (existing browser_* handlers) ──
      case "navigate":
        await dispatchTool(sessionId, "browser_open", args);
        return;
      case "click":
        await dispatchTool(sessionId, "browser_click", args);
        return;
      case "type":
        await dispatchTool(sessionId, "browser_type", args);
        return;
      case "observe":
        await dispatchTool(sessionId, "browser_observe", {});
        return;
      case "pilot": {
        const goal = argStr(args.goal);
        if (!goal) return;
        const result = await safeCall(() => browser.pilot(goal, allowlist), {
          outcome: "pilot unavailable",
          success: false,
        });
        publish(sessionId, {
          type: "output",
          text: result.outcome,
          source: "pilot",
        });
        return;
      }
      // ── output / prompt / artifact (existing handlers) ──
      case "write_prompt":
        await dispatchTool(sessionId, "write_prompt", args);
        return;
      case "show_output":
        await dispatchTool(sessionId, "show_output", args);
        return;
      case "highlight":
        await dispatchTool(sessionId, "highlight_area", args);
        return;
      case "artifact":
        await dispatchTool(sessionId, "save_artifact", args);
        return;
      // ── on-stage overlays with no existing StageEvent: emit the additive one ──
      case "caption":
      case "zoom":
      case "spotlight":
      case "arrow":
      case "circle":
      case "scroll_to":
      case "share_screen":
      case "take_control":
      case "clear_overlay":
        publish(sessionId, { type: "ui_action", tool: action.tool, args });
        return;
      // ── handled by the loop; nothing to actuate here ──
      case "checkpoint":
      case "done":
      case "none":
        return;
      default:
        // Unknown verb (the brain validates to a closed set, but stay safe):
        // surface it as a generic ui_action rather than dropping it silently.
        publish(sessionId, {
          type: "ui_action",
          tool: String(action.tool),
          args,
        });
        return;
    }
  }

  /** The director asked a question: emit it, park for a real human answer. */
  async function directorCheckpoint(
    sessionId: string,
    rt: SessionRuntime,
    args: Record<string, unknown>,
  ): Promise<string> {
    const question = argStr(args.question, "Shall we continue?");
    const choices = argStrList(args.choices);
    publish(sessionId, { type: "checkpoint", question, choices });
    const answer = await parkForAnswer(rt, choices?.[0] ?? "yes");
    if (!rt.stopped) await narrateHuman(sessionId, answer);
    return answer;
  }

  /**
   * Build the per-turn DirectorScreenCtx from a fresh observe(). Sent raw (text +
   * elements) so the sidecar's ScreenInterpreter produces the summary server-side
   * (the ScreenInterpreter is reachable through /direct, no separate endpoint).
   */
  function toScreenCtx(o: ObserveResult) {
    return {
      url: o.url,
      title: o.title,
      elements: o.elements,
      text: o.text,
    };
  }

  /**
   * The canonical teaching loop: the DSPy TeachingDirector chooses one move per
   * turn toward the lesson GOAL (curriculum = milestones, not a script). Bounded
   * by MAX_DIRECTOR_TURNS, pausable by human takeover, parking on checkpoints,
   * ending on the director's `done`. Returns { ran:false } ONLY when the
   * intelligence sidecar is unreachable on turn 0, so runSession can fall back to
   * the lesson's fixed steps and still hold class.
   */
  async function runDirectorLoop(
    sessionId: string,
    rt: SessionRuntime,
    lesson: Lesson,
    lessonId: string,
  ): Promise<{ ran: boolean }> {
    const allowlist = lessons.allowlistFor(sessionId);
    const history: DirectorTurn[] = [];
    let turn = 0;
    let stepCounter = -1;
    let lastMilestone = "";
    let failures = 0;

    // Bring the shared browser live so the director has a real screen to read
    // and can navigate from turn 0 (idempotent — consumes the prewarm).
    const info = await safeCall(() => ensureBrowserLive(sessionId), null);
    if (info) {
      publish(sessionId, { type: "browser_view", liveUrl: info.liveViewUrl });
    }

    while (!rt.stopped && turn < MAX_DIRECTOR_TURNS) {
      if (rt.takenOver) {
        // Human is driving — pause the director without burning the budget.
        await delay(STEP_DELAY_MS);
        continue;
      }

      // Drain any live student interjections captured since the last turn.
      const studentMessage = rt.studentInbox.splice(0).join("\n").trim();
      if (studentMessage) history.push({ role: "student", text: studentMessage });

      // 1) Read the current screen (empty on cold start / on transient failure).
      const screen = await safeCall(() => browser.observe(), EMPTY_OBSERVE);

      // 2) Ask the director for the next move.
      let resp: DirectResponse;
      try {
        resp = await browser.direct({
          session_id: sessionId,
          turn,
          lesson: {
            id: lessonId,
            title: lesson.title,
            goal: lesson.goal,
            knowledge_base: lesson.knowledgeBase,
            curriculum: lesson.curriculum,
          },
          screen: toScreenCtx(screen),
          student_message: studentMessage,
          history: history.slice(-12),
          constraints: {
            allowlist,
            turn_budget_remaining: MAX_DIRECTOR_TURNS - turn,
            can_speak: AVATAR_CAN_SPEAK,
          },
        });
      } catch (err) {
        if (turn === 0) {
          // Brain never reached — let runSession fall back to fixed steps.
          publish(sessionId, {
            type: "status",
            phase: "teaching",
            detail: `director unavailable, using lesson steps: ${errMsg(err)}`,
          });
          return { ran: false };
        }
        // Mid-loop hiccup — skip the turn, keep the class alive.
        failures += 1;
        if (failures >= MAX_DIRECTOR_FAILURES) {
          publish(sessionId, {
            type: "status",
            phase: "teaching",
            detail: "director failing repeatedly; ending loop",
          });
          break;
        }
        turn += 1;
        await delay(STEP_DELAY_MS);
        continue;
      }
      failures = 0;
      if (rt.stopped) break;

      // 3) Narration is authoritative ON SCREEN (transcript) + grounds the avatar.
      await narrateTeacher(sessionId, resp.narration);
      if (resp.narration.trim()) {
        history.push({ role: "teacher", text: resp.narration });
      }
      await groundAvatar(sessionId, resp);

      // Step timeline: one entry per milestone change (keeps it readable).
      if (resp.milestone && resp.milestone !== lastMilestone) {
        lastMilestone = resp.milestone;
        stepCounter += 1;
        publish(sessionId, {
          type: "step",
          index: stepCounter,
          title: resp.milestone,
          body: resp.narration,
        });
      }

      const action = resp.ui_action;
      await safe(() =>
        repo.appendTrace(sessionId, {
          ts: Date.now(),
          kind: "director_turn",
          data: { turn, milestone: resp.milestone, action },
        }),
      );

      // 4) Terminal / fork / actuate.
      if (action.tool === "done" || resp.done) break;
      if (action.tool === "checkpoint") {
        const answer = await directorCheckpoint(sessionId, rt, action.args ?? {});
        history.push({ role: "student", text: answer });
        if (rt.stopped) break;
        turn += 1;
        await delay(STEP_DELAY_MS);
        continue;
      }
      await executeUiAction(sessionId, action, allowlist);
      history.push({
        role: "action",
        text: `${action.tool} ${JSON.stringify(action.args ?? {})}`,
      });

      await safe(() =>
        repo.saveProgress(
          sessionId,
          lessons.current(sessionId) ??
            lessons.start(lessonId, sessionId),
        ),
      );

      turn += 1;
      await delay(STEP_DELAY_MS);
    }

    if (turn >= MAX_DIRECTOR_TURNS) {
      publish(sessionId, {
        type: "status",
        phase: "teaching",
        detail: "reached max director turns",
      });
    }
    return { ran: true };
  }

  /**
   * FALLBACK teaching loop: the original fixed-step LessonEngine walk, used only
   * when the intelligence sidecar is unreachable so a live class still happens.
   * Mirrors the pre-director behaviour exactly (narrate → tool/checkpoint/say,
   * advance, persist) minus the final done-flip, which the unified completion in
   * runSession performs via lessons.complete().
   */
  async function runLegacyLessonLoop(
    sessionId: string,
    rt: SessionRuntime,
    lesson: Lesson,
    lessonId: string,
    fallbackState: LessonRunState,
  ): Promise<void> {
    const steps = lesson.steps;
    // Restart the engine at step 0 so the walk + isAllowed track the steps.
    lessons.start(lessonId, sessionId);
    for (let i = 0; i < steps.length; i++) {
      if (rt.stopped) break;
      const step = steps[i];
      publish(sessionId, {
        type: "step",
        index: i,
        title: step.title,
        body: step.say,
      });
      await processStep(sessionId, rt, step);
      await safe(() =>
        repo.saveProgress(sessionId, lessons.current(sessionId) ?? fallbackState),
      );
      if (rt.stopped) break;
      if (i < steps.length - 1) {
        lessons.advance(sessionId);
        await delay(STEP_DELAY_MS);
      }
    }
  }

  // ── meeting join (shared by runSession + public joinMeeting) ──────────────

  async function joinMeetingInternal(
    sessionId: string,
    meetingUrl: string,
  ): Promise<{ botId: string; status: BotStatus }> {
    const res = await meetingBot.join({
      sessionId,
      meetingUrl,
      outputUrl: stageOutputUrl(env.recall.outputUrl, sessionId),
      botName: "ShareTeacher",
    });
    await safe(() =>
      repo.updateSession(sessionId, {
        meetingUrl,
        botId: res.botId,
        phase: "meeting_live",
      }),
    );
    publish(sessionId, {
      type: "status",
      phase: "meeting_live",
      detail: `bot ${res.botId} (${res.status})`,
    });
    await narrateTeacher(
      sessionId,
      "I've connected our teaching screen to the meeting — everyone there can follow along now.",
    );
    return res;
  }

  // ── public API ──────────────────────────────────────────────────────────

  return {
    async createSession({ lessonId, meetingUrl }) {
      const lesson = lessons.get(lessonId);
      if (!lesson) {
        throw new Error(
          `Unknown lesson "${lessonId}". Known: ${lessons
            .list()
            .map((l) => l.id)
            .join(", ")}`,
        );
      }
      const sessionId = nanoid();
      await repo.createSession({
        id: sessionId,
        lessonId,
        meetingUrl: meetingUrl ?? null,
        phase: "created",
      });
      lessons.start(lessonId, sessionId);
      ensureRuntime(sessionId);
      publish(sessionId, { type: "status", phase: "created" });
      // PRE-WARM the Kernel browser now so its ~12s cold start overlaps avatar
      // bring-up and the first narration steps instead of stalling the lesson
      // when start_browser_session is reached. Best-effort; never blocks create.
      prewarmBrowser(sessionId);
      return sessionId;
    },

    async runSession(sessionId) {
      const rt = ensureRuntime(sessionId);
      const session = await safeCall<SessionRecord | null>(
        () => repo.getSession(sessionId),
        null,
      );
      if (!session) {
        publish(sessionId, {
          type: "status",
          phase: "failed",
          detail: "session not found",
        });
        return;
      }
      const lessonId = session.lessonId;
      const lesson = lessonId ? lessons.get(lessonId) : undefined;
      if (!lesson || !lessonId) {
        await safe(() => repo.updateSession(sessionId, { phase: "failed" }));
        publish(sessionId, {
          type: "status",
          phase: "failed",
          detail: "session has no runnable lesson",
        });
        return;
      }

      try {
        // 1) Avatar bring-up is CLIENT-SIDE only. The browser POSTs to
        //    /api/session/[id]/avatar, which runs its own create -> poll READY ->
        //    consume chain and renders the LiveKit avatar tile. The orchestrator
        //    deliberately does NOT start a second Runway realtime session here:
        //    it would be redundant (no client ever joins it), it would target a
        //    disjoint conversationId, and — most importantly — a transient Runway
        //    hiccup (poll timeout, FAILED status, consume error) would otherwise
        //    abort runSession via the catch below and the teaching loop would
        //    never run. The teaching loop must run regardless of Runway realtime
        //    availability, so the avatar is never on the loop's critical path.
        await safe(() =>
          repo.updateSession(sessionId, { phase: "character_live" }),
        );
        publish(sessionId, { type: "status", phase: "character_live" });

        // 2) Bias the teacher with any recalled learnings (best effort).
        await safe(async () => {
          const hints = await memory.recall(lesson.goal);
          if (hints.length) {
            await repo.appendTrace(sessionId, {
              ts: Date.now(),
              kind: "memory_recall",
              data: { hints },
            });
          }
        });

        // 3) Optionally join the meeting (failure degrades, never fatal).
        if (session.meetingUrl) {
          try {
            await joinMeetingInternal(sessionId, session.meetingUrl);
          } catch (err) {
            publish(sessionId, {
              type: "status",
              phase: "character_live",
              detail: `meeting join skipped: ${errMsg(err)}`,
            });
          }
        }
        if (rt.stopped) return;

        // 4) DIRECTOR-DRIVEN teaching loop. The lesson supplies the GOAL +
        //    curriculum (milestones); the DSPy TeachingDirector decides each
        //    move (narration + one ui_action) which the orchestrator actuates
        //    through the existing tool registry / StageEvent emitters. If the
        //    intelligence sidecar is unreachable on the FIRST turn we fall back
        //    to the lesson's fixed steps so a live class still happens.
        await safe(() => repo.updateSession(sessionId, { phase: "teaching" }));
        publish(sessionId, { type: "status", phase: "teaching" });

        const fallbackState =
          lessons.current(sessionId) ?? lessons.start(lessonId, sessionId);

        const { ran } = await runDirectorLoop(sessionId, rt, lesson, lessonId);
        if (!ran && !rt.stopped) {
          await runLegacyLessonLoop(
            sessionId,
            rt,
            lesson,
            lessonId,
            fallbackState,
          );
        }

        if (rt.stopped) {
          publish(sessionId, {
            type: "status",
            phase: session.phase ?? "teaching",
            detail: "session stopped",
          });
          return;
        }

        // 5) Mark the lesson done + persist + record the learning + complete.
        //    The director ends on its own `done`; complete() flips done = true
        //    for both the director and the legacy-fallback paths.
        lessons.complete(sessionId);
        await safe(() =>
          repo.saveProgress(
            sessionId,
            lessons.current(sessionId) ?? fallbackState,
          ),
        );
        await safe(() =>
          memory.record(`Completed lesson "${lesson.title}" (${lesson.id}).`, {
            sessionId,
            lessonId,
          }),
        );
        await safe(() => repo.updateSession(sessionId, { phase: "completed" }));
        publish(sessionId, { type: "status", phase: "completed" });
        // Lesson over: freeze the viewport on its final frame (the <img> keeps
        // its last src) and stop polling. Full teardown still happens on stop().
        stopScreenshotStream(sessionId);
      } catch (err) {
        // On failure the browser/runtime may be unusable — stop the stream so it
        // doesn't spin in error back-off forever.
        stopScreenshotStream(sessionId);
        await safe(() => repo.updateSession(sessionId, { phase: "failed" }));
        publish(sessionId, {
          type: "status",
          phase: "failed",
          detail: errMsg(err),
        });
      }
    },

    async answer(sessionId, response) {
      const rt = ensureRuntime(sessionId);
      if (rt.awaitingAnswer) {
        const signal = rt.awaitingAnswer;
        rt.awaitingAnswer = null;
        signal(response);
        return;
      }
      // No checkpoint is currently waiting — this is a live interjection. Queue
      // it so the director picks it up as `student_message` next turn, and log
      // the human turn so the transcript reflects it immediately.
      rt.studentInbox.push(response);
      await narrateHuman(sessionId, response);
    },

    async joinMeeting(sessionId, meetingUrl) {
      // Validation lives in the Recall adapter (anti-SSRF) and throws on a bad
      // URL — the route maps that to a 400.
      return joinMeetingInternal(sessionId, meetingUrl);
    },

    async takeover(sessionId) {
      const rt = ensureRuntime(sessionId);
      rt.takenOver = true;
      const url = await safeCall(() => browser.takeoverUrl(), "");
      publish(sessionId, {
        type: "takeover",
        url,
        reason: "human takeover requested",
      });
      await narrateTeacher(
        sessionId,
        "Okay — I'm handing you the controls. Take your time; I'll keep guiding from here.",
      );
      return url;
    },

    async stop(sessionId) {
      const rt = runtimes.get(sessionId);
      if (rt) {
        rt.stopped = true;
        if (rt.awaitingAnswer) {
          const signal = rt.awaitingAnswer;
          rt.awaitingAnswer = null;
          signal("stop");
        }
      }
      // Stop the screenshot stream first so no frame is published mid-teardown,
      // and stop any pre-warmed-but-unconsumed Kernel browser.
      await teardownBrowser(sessionId);
      const session = await safeCall<SessionRecord | null>(
        () => repo.getSession(sessionId),
        null,
      );
      await safe(() => browser.stop());
      if (session?.botId) await safe(() => meetingBot.leave(session.botId!));
      if (session?.browserSessionId) {
        await safe(() => browserRuntime.stopSession(session.browserSessionId!));
      }
      await safe(() => character.stop(sessionId));
      publish(sessionId, {
        type: "status",
        phase: session?.phase ?? "created",
        detail: "session stopped",
      });
    },

    async getSummary(sessionId) {
      const [session, transcript, artifacts, progress] = await Promise.all([
        safeCall<SessionRecord | null>(() => repo.getSession(sessionId), null),
        safeCall<TranscriptLine[]>(() => repo.getTranscript(sessionId), []),
        safeCall<ArtifactRef[]>(() => repo.getArtifacts(sessionId), []),
        safeCall<LessonRunState | null>(() => repo.getProgress(sessionId), null),
      ]);
      return {
        session,
        transcript,
        artifacts,
        progress,
      };
    },

    listLessons() {
      return lessons
        .list()
        .map((l) => ({ id: l.id, title: l.title, goal: l.goal }));
    },
  };
}

// ── singleton ────────────────────────────────────────────────────────────────

const SINGLETON_KEY = "__shareteacher_orchestrator__";
type GlobalWithOrch = typeof globalThis & { [SINGLETON_KEY]?: Orchestrator };
const g = globalThis as GlobalWithOrch;

/** Build (once) and return the process-wide Orchestrator. */
export function getOrchestrator(): Orchestrator {
  if (g[SINGLETON_KEY]) return g[SINGLETON_KEY]!;
  const orch = buildOrchestrator(getEnv());
  g[SINGLETON_KEY] = orch;
  return orch;
}
