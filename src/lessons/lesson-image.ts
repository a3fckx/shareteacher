// ─────────────────────────────────────────────────────────────────────────
// Lesson 2 — "Write a great image prompt" (id: "image-prompt").
//
// Shorter than the golden path but valid: start → demo → checkpoint →
// artifact. Teaches the anatomy of a strong image prompt and saves it as a
// reusable template. Locked to the ChatGPT/OpenAI image surface.
// ─────────────────────────────────────────────────────────────────────────

import type { Lesson, LessonStep } from "@/types/contracts";

export const IMAGE_LESSON_ID = "image-prompt";

export const IMAGE_ALLOWLIST: readonly string[] = ["chatgpt.com", "openai.com"];

/** Example image prompt demonstrating subject, style, lighting, composition, aspect. */
export const EXAMPLE_IMAGE_PROMPT =
  "A photorealistic wide-angle shot of a futuristic solar farm at golden hour, glossy panels " +
  "stretching to the horizon, dramatic cinematic lighting with a soft lens flare, 16:9 aspect " +
  "ratio, ultra-detailed, shot on a 35mm lens.";

const PERSONA_PROMPT = [
  "You are ShareTeacher running a short, focused class on writing image prompts.",
  "Teach by example and stay on the current step — do not free-run or improvise extra steps.",
  "Answer interruptions briefly, then return to the exact step you were on.",
].join(" ");

const KNOWLEDGE_BASE = [
  "A strong image prompt names five things: SUBJECT (what is in frame), STYLE (photo, 3D, illustration),",
  "LIGHTING (golden hour, studio, cinematic), COMPOSITION (wide-angle, close-up, rule-of-thirds),",
  "and ASPECT/RENDER details (16:9, ultra-detailed, lens). Vague prompts produce generic images;",
  "specific, layered prompts produce art-directed ones. Save winning prompts as templates and swap",
  "only the SUBJECT to reuse them.",
].join(" ");

export function buildImageLesson(): Lesson {
  const allowlist = [...IMAGE_ALLOWLIST];

  const steps: LessonStep[] = [
    // start
    {
      id: "s1",
      kind: "say",
      title: "Start: anatomy of an image prompt",
      say:
        "Let's learn to write image prompts that look art-directed instead of generic. The trick " +
        "is to name five layers: subject, style, lighting, composition, and aspect/render details.",
      allowlist,
    },
    // demo
    {
      id: "s2",
      kind: "tool",
      title: "Demo: write a layered prompt",
      say:
        "Here's a prompt that names all five layers. See how each phrase adds one specific " +
        "direction — that's what gives you control over the result.",
      tool: { name: "write_prompt", args: { target: "chatgpt", text: EXAMPLE_IMAGE_PROMPT } },
      allowlist,
    },
    // checkpoint
    {
      id: "s3",
      kind: "checkpoint",
      title: "Checkpoint: add cinematic lighting?",
      say: "Quick choice before we save the template.",
      checkpoint: {
        question: "Add cinematic lighting to the prompt?",
        choices: ["yes", "no"],
        expects: "yes",
      },
      allowlist,
    },
    // artifact
    {
      id: "s4",
      kind: "artifact",
      title: "Save the prompt template",
      say:
        "Cinematic lighting it is. I'm saving this as a reusable image-prompt template — next " +
        "time, just swap the subject and keep the rest.",
      tool: {
        name: "save_artifact",
        args: { kind: "prompt", name: "image-prompt-template.txt", text: EXAMPLE_IMAGE_PROMPT },
      },
      allowlist,
    },
  ];

  return {
    id: IMAGE_LESSON_ID,
    title: "Write a great image prompt",
    goal:
      "Teach a learner the five layers of a strong image prompt and save a reusable template.",
    personaPrompt: PERSONA_PROMPT,
    knowledgeBase: KNOWLEDGE_BASE,
    steps,
  };
}

export const imageLesson: Lesson = buildImageLesson();
