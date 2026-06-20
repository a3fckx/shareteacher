// ─────────────────────────────────────────────────────────────────────────
// ShareTeacher — shared integration contracts.
//
// THIS FILE IS THE LAW. Every organ (Runway / Recall / Kernel / Browser /
// Lessons / Memory / Data) implements the interfaces here. Adapters MUST be
// constructed through their `create*` factory. There is no mock mode: every
// adapter talks to its real service. A live lesson legitimately requires
// live credentials plus a human (mic, ChatGPT login, public tunnel).
// ─────────────────────────────────────────────────────────────────────────

// Adapters are always live. `Mode` is retained as a single-member literal so
// existing `AdapterMeta.mode = "real"` assignments keep their type.
export type Mode = "real";

export interface AdapterMeta {
  /** "runway" | "recall" | "kernel" | "browser" ... */
  readonly name: string;
  readonly mode: Mode;
}

// ── Tool registry (organ ↔ organ contract) ────────────────────────────────
// Runway Character emits tool calls; the orchestrator routes them to handlers.

export type ToolName =
  // client/UI tools (drive the teaching screen)
  | "show_step"
  | "highlight_area"
  | "write_prompt"
  | "show_output"
  | "ask_checkpoint"
  | "save_artifact"
  // server/browser tools
  | "start_browser_session"
  | "browser_open"
  | "browser_observe"
  | "browser_click"
  | "browser_type"
  | "browser_task"
  | "browser_screenshot"
  | "browser_takeover_url"
  | "browser_stop";

export interface ToolCall {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult["data"]>;

export interface ToolContext {
  sessionId: string;
  browser: BrowserController;
  runtime: BrowserRuntime;
  repo: Repository;
  lessons: LessonEngine;
  /**
   * The single persistent Kernel profile every browser session binds to so the
   * human's ChatGPT login is reused on every lesson (KERNEL_PROFILE_NAME).
   */
  kernelProfile: string;
  /** Push a UI event to connected classroom clients (SSE). */
  emit: (event: StageEvent) => void;
  /**
   * Bring the shared Kernel browser live for this session — consuming the
   * pre-warmed (cold-started at createSession) browser when available, else
   * cold-starting now. Idempotent: attaches the controller and starts the
   * server-driven screenshot stream exactly once. Returns the live session info.
   */
  ensureBrowserLive?: () => Promise<BrowserSessionInfo>;
}

// ── Stage events (server → classroom UI over SSE) ──────────────────────────

export type StageEvent =
  | { type: "step"; index: number; title: string; body?: string }
  | { type: "highlight"; selector?: string; box?: Box; label?: string }
  | { type: "prompt"; text: string; target: "chatgpt" | "generic" }
  | { type: "output"; text: string; source: string }
  | { type: "checkpoint"; question: string; choices?: string[] }
  | { type: "screenshot"; url: string }
  | { type: "transcript"; speaker: "teacher" | "human"; text: string }
  | { type: "browser_view"; liveUrl: string }
  | { type: "takeover"; url: string; reason: string }
  | { type: "artifact"; kind: string; name: string; url: string }
  | { type: "status"; phase: SessionPhase; detail?: string };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Organ 1: Runway Character ──────────────────────────────────────────────

export interface CharacterStartOpts {
  sessionId: string;
  characterId?: string;
  voiceId?: string;
  personaPrompt: string;
  knowledgeBase: string;
  tools: ToolName[];
}

export interface CharacterSession {
  id: string;
  /** Encoded LiveKit join credentials the UI decodes to render the avatar tile. */
  joinToken: string;
  expiresAt: number;
}

export interface CharacterAgent extends AdapterMeta {
  start(opts: CharacterStartOpts): Promise<CharacterSession>;
  /** Feed the Character visual/textual context (e.g. current screen text). */
  sendContext(sessionId: string, context: string): Promise<void>;
  /** Long-poll / stream tool calls the Character wants executed. */
  nextToolCalls(sessionId: string): Promise<ToolCall[]>;
  /** Return a tool result to the Character. */
  resolveTool(sessionId: string, result: ToolResult): Promise<void>;
  getTranscript(sessionId: string): Promise<TranscriptLine[]>;
  getRecordingUrl(sessionId: string): Promise<string | null>;
  stop(sessionId: string): Promise<void>;
}

export interface TranscriptLine {
  ts: number;
  speaker: "teacher" | "human";
  text: string;
}

// ── Organ 2: Recall.ai meeting bot ─────────────────────────────────────────

export type MeetingPlatform = "google_meet" | "zoom" | "teams";
export type BotStatus =
  | "joining"
  | "in_waiting_room"
  | "in_call"
  | "left"
  | "failed";

export interface JoinMeetingOpts {
  sessionId: string;
  meetingUrl: string;
  /** Public URL of the teaching screen the bot streams as camera/screenshare. */
  outputUrl: string;
  botName?: string;
}

export interface MeetingBot extends AdapterMeta {
  join(opts: JoinMeetingOpts): Promise<{ botId: string; status: BotStatus }>;
  status(botId: string): Promise<BotStatus>;
  leave(botId: string): Promise<void>;
}

// ── Organ 3: Kernel browser runtime ────────────────────────────────────────

export interface BrowserSessionInfo {
  sessionId: string;
  cdpUrl: string;
  liveViewUrl: string;
  profileId: string;
}

export interface BrowserRuntime extends AdapterMeta {
  startSession(profileId: string): Promise<BrowserSessionInfo>;
  liveViewUrl(sessionId: string): Promise<string>;
  screenshot(sessionId: string): Promise<string>; // data/URL
  recordingUrl(sessionId: string): Promise<string | null>;
  stopSession(sessionId: string): Promise<void>;
}

// ── Organ 4: Browser controller (Playwright / Stagehand / Browser Use) ─────

export interface ObserveResult {
  url: string;
  title: string;
  /** Salient interactive elements the model/teacher can reference. */
  elements: { ref: string; role: string; text: string }[];
  text: string;
}

export interface BrowserController extends AdapterMeta {
  attach(info: BrowserSessionInfo): Promise<void>;
  open(url: string): Promise<void>;
  observe(): Promise<ObserveResult>;
  click(instruction: string): Promise<void>;
  type(text: string): Promise<void>;
  /** Open-ended goal handled by Browser Use; bounded by allowlist. */
  task(goal: string): Promise<{ summary: string; ok: boolean }>;
  screenshot(): Promise<string>;
  /**
   * Lightweight, lock-free JPEG frame for the always-on screenshot stream
   * (returns a `data:image/jpeg;base64,...` URL). Distinct from `screenshot()`
   * — it never takes the sidecar's per-handle lock, so frames keep flowing even
   * during a long `task()` agent run. Optional so non-streaming controllers
   * stay valid. Throws on capture failure; callers degrade (keep the last frame).
   */
  frame?(): Promise<string>;
  /** URL a human opens to take over (live view focused for input). */
  takeoverUrl(): Promise<string>;
  stop(): Promise<void>;
}

// ── Organ 6: Lesson engine ─────────────────────────────────────────────────

export type LessonStepKind = "say" | "tool" | "checkpoint" | "artifact";

export interface LessonStep {
  id: string;
  kind: LessonStepKind;
  title: string;
  /** Teacher narration / instruction. */
  say?: string;
  /** Tool to invoke for "tool" steps. */
  tool?: { name: ToolName; args: Record<string, unknown> };
  /** Checkpoint question for "checkpoint" steps. */
  checkpoint?: { question: string; choices?: string[]; expects?: string };
  /** Allowed domains while this step runs. */
  allowlist?: string[];
}

export interface Lesson {
  id: string;
  title: string;
  goal: string;
  personaPrompt: string;
  knowledgeBase: string;
  steps: LessonStep[];
}

export interface LessonRunState {
  lessonId: string;
  sessionId: string;
  stepIndex: number;
  done: boolean;
  artifacts: ArtifactRef[];
}

export interface LessonEngine {
  list(): Lesson[];
  get(lessonId: string): Lesson | undefined;
  start(lessonId: string, sessionId: string): LessonRunState;
  current(sessionId: string): LessonRunState | undefined;
  /** Advance after a step completes; returns next state. */
  advance(sessionId: string): LessonRunState | undefined;
  /** Record a human checkpoint answer; returns whether it passed. */
  answer(sessionId: string, response: string): { passed: boolean; feedback: string };
  /** Guardrail: is this domain allowed in the current step? */
  isAllowed(sessionId: string, url: string): boolean;
}

export interface ArtifactRef {
  kind: string; // "pptx" | "image" | "prompt" | "transcript" | "trace"
  name: string;
  url: string;
}

// ── Organ 7: Persistence + memory ──────────────────────────────────────────

export type SessionPhase =
  | "created"
  | "character_live"
  | "browser_live"
  | "meeting_live"
  | "teaching"
  | "completed"
  | "failed";

export interface SessionRecord {
  id: string;
  lessonId: string | null;
  phase: SessionPhase;
  meetingUrl: string | null;
  botId: string | null;
  characterSessionId: string | null;
  browserSessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Repository {
  createSession(input: Partial<SessionRecord> & { id: string }): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord>;
  appendTranscript(sessionId: string, line: TranscriptLine): Promise<void>;
  getTranscript(sessionId: string): Promise<TranscriptLine[]>;
  appendTrace(sessionId: string, entry: { ts: number; kind: string; data: unknown }): Promise<void>;
  saveArtifact(sessionId: string, artifact: ArtifactRef): Promise<void>;
  getArtifacts(sessionId: string): Promise<ArtifactRef[]>;
  saveProgress(sessionId: string, state: LessonRunState): Promise<void>;
  getProgress(sessionId: string): Promise<LessonRunState | null>;
}

export interface MemoryHooks {
  recall(query: string): Promise<string[]>;
  record(note: string, meta?: Record<string, unknown>): Promise<void>;
}

// ── Env contract (single source of config truth) ───────────────────────────

export interface Env {
  databaseUrl: string;
  runway: { apiKey?: string; baseUrl: string; characterId?: string; voiceId?: string };
  recall: { apiKey?: string; region: string; outputUrl: string };
  kernel: { apiKey?: string; baseUrl: string; profileName: string };
  /** Base URL of the Python browser-use sidecar the Next app proxies to. */
  browserAgentUrl: string;
  openai: { apiKey?: string };
  appBaseUrl: string;
}
