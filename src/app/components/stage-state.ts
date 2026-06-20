// Pure state model for the classroom stage. No React, no server imports —
// just types and a reducer that folds StageEvent (from the SSE stream) into a
// renderable view model. Types are imported type-only from the contracts law.

import type { Box, SessionPhase, StageEvent } from "@/types/contracts";

export interface StepView {
  index: number;
  title: string;
  body?: string;
}

export interface OutputView {
  text: string;
  source: string;
}

export interface TranscriptView {
  speaker: "teacher" | "human";
  text: string;
}

export interface ArtifactView {
  kind: string;
  name: string;
  url: string;
}

export interface HighlightView {
  selector?: string;
  box?: Box;
  label?: string;
}

export interface ClassroomState {
  steps: StepView[];
  currentStep: number;
  highlight: HighlightView | null;
  prompt: { text: string; target: "chatgpt" | "generic" } | null;
  outputs: OutputView[];
  checkpoint: { question: string; choices?: string[] } | null;
  screenshotUrl: string | null;
  liveUrl: string | null;
  transcript: TranscriptView[];
  takeover: { url: string; reason: string } | null;
  artifacts: ArtifactView[];
  phase: SessionPhase | null;
  statusDetail?: string;
}

export const initialClassroomState: ClassroomState = {
  steps: [],
  currentStep: -1,
  highlight: null,
  prompt: null,
  outputs: [],
  checkpoint: null,
  screenshotUrl: null,
  liveUrl: null,
  transcript: [],
  takeover: null,
  artifacts: [],
  phase: null,
  statusDetail: undefined,
};

function upsertStep(steps: StepView[], next: StepView): StepView[] {
  const others = steps.filter((s) => s.index !== next.index);
  return [...others, next].sort((a, b) => a.index - b.index);
}

export function lastTeacherLine(state: ClassroomState): string | null {
  for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
    if (state.transcript[i].speaker === "teacher") return state.transcript[i].text;
  }
  return null;
}

/** Fold one stage event into the classroom view model. */
export function reduceStage(state: ClassroomState, e: StageEvent): ClassroomState {
  switch (e.type) {
    case "step":
      return {
        ...state,
        steps: upsertStep(state.steps, {
          index: e.index,
          title: e.title,
          body: e.body,
        }),
        currentStep: e.index,
      };
    case "highlight":
      return {
        ...state,
        highlight: { selector: e.selector, box: e.box, label: e.label },
      };
    case "prompt":
      return { ...state, prompt: { text: e.text, target: e.target } };
    case "output":
      return { ...state, outputs: [...state.outputs, { text: e.text, source: e.source }] };
    case "checkpoint":
      return { ...state, checkpoint: { question: e.question, choices: e.choices } };
    case "screenshot":
      return { ...state, screenshotUrl: e.url };
    case "transcript":
      return {
        ...state,
        transcript: [...state.transcript, { speaker: e.speaker, text: e.text }],
      };
    case "browser_view":
      return { ...state, liveUrl: e.liveUrl };
    case "takeover":
      return { ...state, takeover: { url: e.url, reason: e.reason } };
    case "artifact":
      return {
        ...state,
        artifacts: [...state.artifacts, { kind: e.kind, name: e.name, url: e.url }],
      };
    case "status":
      return { ...state, phase: e.phase, statusDetail: e.detail };
    default:
      return state;
  }
}
