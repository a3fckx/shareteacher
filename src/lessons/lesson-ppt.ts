// ─────────────────────────────────────────────────────────────────────────
// Lesson 1 — "Create a PPT using ChatGPT" (id: "ppt-chatgpt").
//
// THE GOLDEN PATH. This is the canonical end-to-end lesson the whole app is
// built to run with zero credentials. The orchestrator steps the LessonEngine
// through these ordered LessonStep[]; each `tool` step carries a real ToolName
// + args, the single `checkpoint` gates on `expects`, and `artifact` steps
// emit downloadable files. Every step is locked to the ChatGPT allowlist so
// the shared browser can never wander off-domain mid-class.
// ─────────────────────────────────────────────────────────────────────────

import type { Lesson, LessonStep } from "@/types/contracts";

/** Stable lesson id — referenced by the orchestrator + UI. */
export const PPT_LESSON_ID = "ppt-chatgpt";

/** Topic used when no human supplies one (anti-drift default). */
export const DEFAULT_PPT_TOPIC = "The Future of Renewable Energy";

/** Domains the shared browser may visit during this lesson. */
export const PPT_ALLOWLIST: readonly string[] = ["chatgpt.com", "openai.com"];

/**
 * Build the full PPT prompt for a topic. The four ingredients the teacher
 * explains in step s4 map 1:1 to the clauses here: ROLE, AUDIENCE, SLIDE
 * COUNT, TONE. The exact same string is shown via `write_prompt` (s5) and
 * typed into the browser via `browser_type` (s6).
 */
export function buildPptPrompt(topic: string): string {
  return [
    `You are an expert presentation designer.`,
    `Create a professional slide-deck outline on the topic "${topic}".`,
    `Audience: a general business audience that is smart but not specialist.`,
    `Produce exactly 8 slides. For each slide give a short title and 3-4 concise bullet points.`,
    `Open with a title slide and close with a summary + clear call-to-action slide.`,
    `Tone: clear, confident, and engaging — avoid jargon and prefer concrete examples and numbers.`,
  ].join(" ");
}

const PERSONA_PROMPT = [
  "You are ShareTeacher, a warm, focused AI teacher running a live class.",
  "You teach ONE workflow at a time by narrating and operating a real shared browser.",
  "Stay strictly on the current lesson step. Do NOT free-run, do NOT give generic chatbot advice,",
  "and do NOT jump ahead — the lesson engine, not you, decides the next step.",
  "Answer human interruptions briefly and then return to the exact step you were on.",
  "Speak in short, encouraging sentences and always tie each action back to a reusable principle.",
].join(" ");

const KNOWLEDGE_BASE = [
  "Workflow: turn a single well-structured ChatGPT prompt into a full slide deck.",
  "A strong slide prompt names four things: (1) ROLE for ChatGPT — an expert presentation designer;",
  "(2) AUDIENCE — who the deck is for; (3) SLIDE COUNT — an explicit number like 8;",
  "(4) TONE — e.g. clear, confident, engaging.",
  "Good decks open with a title slide and close with a summary + call-to-action slide.",
  "A costs & ROI slide (payback period, multi-year savings) makes a deck far more persuasive.",
  "After generating, refine with one targeted change at a time, then export to .pptx and save",
  "the prompt as a reusable template so the learner can repeat the workflow for any topic.",
].join(" ");

/**
 * Construct the PPT lesson for a given topic. Defaults to the renewable-energy
 * topic so the golden path runs with no human input.
 */
export function buildPptLesson(topic: string = DEFAULT_PPT_TOPIC): Lesson {
  const prompt = buildPptPrompt(topic);
  const allowlist = [...PPT_ALLOWLIST];

  const steps: LessonStep[] = [
    // s1 — greet + state the topic.
    {
      id: "s1",
      kind: "say",
      title: "Greet & set the topic",
      say:
        `Hi everyone — I'm your AI teacher. Today we'll turn a single ChatGPT prompt into a ` +
        `full slide deck. We'll build a presentation on "${topic}". Let's get started.`,
      allowlist,
    },
    // s2 — start the shared browser session (emits browser_view(liveUrl)).
    {
      id: "s2",
      kind: "tool",
      title: "Open a shared browser",
      say: "First, let me open a real browser that we can all watch live on screen.",
      tool: { name: "start_browser_session", args: { profileId: "chatgpt-demo" } },
      allowlist,
    },
    // s3 — navigate to ChatGPT.
    {
      id: "s3",
      kind: "tool",
      title: "Go to ChatGPT",
      say: "Now I'll navigate to ChatGPT — the tool we'll use to draft the deck.",
      tool: { name: "browser_open", args: { url: "https://chatgpt.com" } },
      allowlist,
    },
    // s4 — explain the prompt structure (role, audience, slide count, tone).
    {
      id: "s4",
      kind: "say",
      title: "Explain the prompt structure",
      say:
        "A strong slide prompt has four parts: a ROLE for ChatGPT (an expert presentation " +
        "designer), the AUDIENCE (a general business crowd), the SLIDE COUNT (eight slides), and " +
        "the TONE (clear, confident, engaging). Naming all four turns a vague answer into a " +
        "usable outline.",
      allowlist,
    },
    // s5 — write the prompt into the UI prompt editor (emits prompt event).
    {
      id: "s5",
      kind: "tool",
      title: "Write the prompt",
      say: "Here's the prompt we'll use. Notice how each clause maps to what we just discussed.",
      tool: { name: "write_prompt", args: { target: "chatgpt", text: prompt } },
      allowlist,
    },
    // s6 — type the same prompt into ChatGPT and submit.
    {
      id: "s6",
      kind: "tool",
      title: "Type the prompt and submit",
      say: "Let me type that exact prompt into ChatGPT and send it.",
      tool: { name: "browser_type", args: { text: prompt, submit: true } },
      allowlist,
    },
    // s7 — observe the page; orchestrator emits show_output with the outline.
    {
      id: "s7",
      kind: "tool",
      title: "Read the generated outline",
      say: "ChatGPT is responding — let me read the slide outline it produced.",
      tool: { name: "browser_observe", args: {} },
      allowlist,
    },
    // s8 — checkpoint. Auto mode auto-answers "yes"; otherwise it awaits a human POST /answer.
    {
      id: "s8",
      kind: "checkpoint",
      title: "Checkpoint: add costs & ROI?",
      say: "Quick check-in before we finalize the deck.",
      checkpoint: {
        question: "Add a slide on costs & ROI?",
        choices: ["yes", "no"],
        expects: "yes",
      },
      allowlist,
    },
    // s9 — acknowledge the answer and revise the outline.
    {
      id: "s9",
      kind: "say",
      title: "Acknowledge & revise the outline",
      say:
        "Great call — a costs & ROI slide makes the deck far more persuasive. I'll add it as " +
        "slide 7, just before the summary, covering payback period and three-year savings.",
      allowlist,
    },
    // s10 — export the deck as a .pptx artifact (url /artifacts/<sessionId>.pptx).
    {
      id: "s10",
      kind: "artifact",
      title: "Export the deck",
      say: "Now I'll export the finished outline as a PowerPoint file you can download.",
      tool: {
        name: "save_artifact",
        args: { kind: "pptx", name: `${topic}.pptx`, topic },
      },
      allowlist,
    },
    // s11 — summarize the reusable workflow and save the prompt template.
    {
      id: "s11",
      kind: "artifact",
      title: "Summarize & save the prompt template",
      say:
        "To recap the workflow: name the role, audience, slide count, and tone; send one prompt; " +
        "review the outline; refine with a single targeted change; then export. I'm saving this " +
        "exact prompt as a reusable template so you can repeat it for any topic.",
      tool: {
        name: "save_artifact",
        args: { kind: "prompt", name: "ppt-prompt-template.txt", text: prompt },
      },
      allowlist,
    },
  ];

  // Curriculum = the lesson's milestones for the DSPy TeachingDirector (the
  // destination/beats, NOT a rigid script). Derived from the step titles so the
  // director and the legacy step fallback never drift.
  const curriculum = steps.map((s) => s.title);

  return {
    id: PPT_LESSON_ID,
    title: "Create a PPT using ChatGPT",
    goal:
      "Teach a learner to turn one structured ChatGPT prompt into a full slide deck, refine it " +
      "with feedback, and export a reusable .pptx plus a prompt template.",
    personaPrompt: PERSONA_PROMPT,
    knowledgeBase: KNOWLEDGE_BASE,
    curriculum,
    allowlist,
    steps,
  };
}

/** Default PPT lesson instance (renewable-energy topic). */
export const pptLesson: Lesson = buildPptLesson();
