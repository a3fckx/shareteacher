// ─────────────────────────────────────────────────────────────────────────
// Lesson 3 — "Research with YouTube + ChatGPT" (id: "research-youtube").
//
// Shorter than the golden path but valid: start → demo → checkpoint →
// artifact. Demonstrates a two-tool research loop (gather on YouTube,
// synthesize in ChatGPT) and saves a reusable synthesis prompt. Allowlist
// spans both YouTube and the ChatGPT/OpenAI surface.
// ─────────────────────────────────────────────────────────────────────────

import type { Lesson, LessonStep } from "@/types/contracts";

export const RESEARCH_LESSON_ID = "research-youtube";

export const RESEARCH_ALLOWLIST: readonly string[] = [
  "youtube.com",
  "chatgpt.com",
  "openai.com",
];

/** Topic the demo researches when no human supplies one. */
export const DEFAULT_RESEARCH_TOPIC = "The Future of Renewable Energy";

/** Build the ChatGPT synthesis prompt for a research topic. */
export function buildResearchPrompt(topic: string): string {
  return [
    `You are a rigorous research assistant.`,
    `I am studying "${topic}" using a few YouTube explainer videos.`,
    `From the key points I paste below, produce: (1) a 5-bullet summary,`,
    `(2) the 3 most important open questions, and (3) two credible sources to verify the claims.`,
    `Flag anything that sounds like hype or is unsupported.`,
  ].join(" ");
}

const PERSONA_PROMPT = [
  "You are ShareTeacher running a short class on a research workflow.",
  "Teach the loop: gather on YouTube, then synthesize and fact-check in ChatGPT.",
  "Stay on the current step, answer interruptions briefly, then resume exactly where you were.",
].join(" ");

const KNOWLEDGE_BASE = [
  "Research loop: (1) search YouTube for explainer videos on the topic and skim titles/chapters;",
  "(2) pull the key claims; (3) paste them into ChatGPT and ask for a structured summary, open",
  "questions, and credible sources to verify; (4) always fact-check — video creators can be wrong",
  "or biased. Save the synthesis prompt as a template so the loop is repeatable for any topic.",
].join(" ");

export function buildResearchLesson(topic: string = DEFAULT_RESEARCH_TOPIC): Lesson {
  const allowlist = [...RESEARCH_ALLOWLIST];
  const synthesisPrompt = buildResearchPrompt(topic);
  const searchUrl =
    "https://youtube.com/results?search_query=" + encodeURIComponent(topic);

  const steps: LessonStep[] = [
    // start
    {
      id: "s1",
      kind: "say",
      title: "Start: the research loop",
      say:
        `Let's learn a reliable research loop: gather facts from YouTube, then synthesize and ` +
        `fact-check them in ChatGPT. We'll research "${topic}".`,
      allowlist,
    },
    // demo — open the shared browser
    {
      id: "s2",
      kind: "tool",
      title: "Open a shared browser",
      say: "I'll open a browser so we can search together.",
      tool: { name: "start_browser_session", args: { profileId: "research-demo" } },
      allowlist,
    },
    // demo — search YouTube
    {
      id: "s3",
      kind: "tool",
      title: "Search YouTube",
      say: "First stop: YouTube, to find a couple of solid explainer videos on the topic.",
      tool: { name: "browser_open", args: { url: searchUrl } },
      allowlist,
    },
    // demo — synthesize in ChatGPT
    {
      id: "s4",
      kind: "tool",
      title: "Synthesize in ChatGPT",
      say:
        "Now the key move: hand the key points to ChatGPT and ask for a structured summary, open " +
        "questions, and sources to verify. Here's the synthesis prompt.",
      tool: { name: "write_prompt", args: { target: "chatgpt", text: synthesisPrompt } },
      allowlist,
    },
    // checkpoint
    {
      id: "s5",
      kind: "checkpoint",
      title: "Checkpoint: fact-check the claims?",
      say: "Before we save anything — one habit to lock in.",
      checkpoint: {
        question: "Should we always fact-check the video claims in ChatGPT?",
        choices: ["yes", "no"],
        expects: "yes",
      },
      allowlist,
    },
    // artifact
    {
      id: "s6",
      kind: "artifact",
      title: "Save the research prompt template",
      say:
        "Exactly — always verify. I'm saving this synthesis prompt as a reusable template so you " +
        "can run the same research loop on any topic.",
      tool: {
        name: "save_artifact",
        args: { kind: "prompt", name: "research-prompt-template.txt", text: synthesisPrompt },
      },
      allowlist,
    },
  ];

  return {
    id: RESEARCH_LESSON_ID,
    title: "Research with YouTube + ChatGPT",
    goal:
      "Teach a learner a repeatable research loop — gather on YouTube, synthesize and fact-check " +
      "in ChatGPT — and save a reusable synthesis prompt.",
    personaPrompt: PERSONA_PROMPT,
    knowledgeBase: KNOWLEDGE_BASE,
    steps,
  };
}

export const researchLesson: Lesson = buildResearchLesson();
