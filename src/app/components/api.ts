"use client";

// Client-side API helpers for the Teaching UI (Organ 5).
// Everything here talks to the JSON/SSE API only — never a server adapter.
// All parsing is defensive so the UI tolerates minor shape differences from the
// route layer.

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export interface LessonSummary {
  id: string;
  title: string;
  goal?: string;
  stepCount?: number;
}

export async function fetchLessons(): Promise<LessonSummary[]> {
  const res = await fetch("/api/lessons", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load lessons (${res.status})`);
  const data: unknown = await res.json();
  const root = asRecord(data);
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(root.lessons)
      ? (root.lessons as unknown[])
      : [];
  return list.map((raw) => {
    const l = asRecord(raw);
    const steps = l.steps;
    return {
      id: str(l.id) ?? "",
      title: str(l.title) ?? str(l.id) ?? "Untitled lesson",
      goal: str(l.goal),
      stepCount: Array.isArray(steps) ? steps.length : num(l.stepCount),
    } satisfies LessonSummary;
  });
}

export async function startSession(input: {
  lessonId: string;
  meetingUrl?: string;
}): Promise<string> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lessonId: input.lessonId,
      meetingUrl: input.meetingUrl?.trim() || undefined,
    }),
  });
  if (!res.ok) throw new Error(`Failed to start session (${res.status})`);
  const data: unknown = await res.json().catch(() => ({}));
  const root = asRecord(data);
  const id =
    str(root.id) ?? str(root.sessionId) ?? str(asRecord(root.session).id);
  if (!id) throw new Error("Session response did not include an id");
  return id;
}

export async function sendAnswer(
  sessionId: string,
  response: string,
): Promise<void> {
  await fetch(`/api/session/${encodeURIComponent(sessionId)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response, choice: response }),
  });
}

export async function requestTakeover(
  sessionId: string,
): Promise<string | null> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/takeover`,
    { method: "POST" },
  );
  if (!res.ok) return null;
  const data: unknown = await res.json().catch(() => ({}));
  const root = asRecord(data);
  return str(root.url) ?? str(root.takeoverUrl) ?? null;
}

export async function stopSession(sessionId: string): Promise<void> {
  await fetch(`/api/session/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
}

export interface SummaryTranscriptLine {
  speaker: "teacher" | "human";
  text: string;
  ts?: number;
}

export interface SummaryArtifact {
  kind: string;
  name: string;
  url: string;
}

export interface SessionSummaryData {
  sessionId: string;
  lessonId?: string | null;
  phase?: string;
  transcript: SummaryTranscriptLine[];
  artifacts: SummaryArtifact[];
  progress: { stepIndex?: number; total?: number; done?: boolean } | null;
}

export async function fetchSummary(
  sessionId: string,
): Promise<SessionSummaryData> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/summary`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to load summary (${res.status})`);
  const data: unknown = await res.json();
  const root = asRecord(data);
  const session = asRecord(root.session);

  const transcriptRaw = Array.isArray(root.transcript)
    ? (root.transcript as unknown[])
    : Array.isArray(session.transcript)
      ? (session.transcript as unknown[])
      : [];
  const transcript: SummaryTranscriptLine[] = transcriptRaw.map((raw) => {
    const l = asRecord(raw);
    const speaker = str(l.speaker) === "human" ? "human" : "teacher";
    return { speaker, text: str(l.text) ?? "", ts: num(l.ts) };
  });

  const artifactsRaw = Array.isArray(root.artifacts)
    ? (root.artifacts as unknown[])
    : Array.isArray(session.artifacts)
      ? (session.artifacts as unknown[])
      : [];
  const artifacts: SummaryArtifact[] = artifactsRaw.map((raw) => {
    const a = asRecord(raw);
    return {
      kind: str(a.kind) ?? "file",
      name: str(a.name) ?? "artifact",
      url: str(a.url) ?? "#",
    };
  });

  const progressRaw =
    root.progress !== undefined ? asRecord(root.progress) : null;
  const progress = progressRaw
    ? {
        stepIndex: num(progressRaw.stepIndex),
        total:
          num(progressRaw.total) ??
          (Array.isArray(progressRaw.artifacts)
            ? undefined
            : num(progressRaw.steps)),
        done:
          progressRaw.done === true ||
          progressRaw.done === "true" ||
          undefined,
      }
    : null;

  return {
    sessionId,
    lessonId: str(root.lessonId) ?? str(session.lessonId) ?? null,
    phase: str(root.phase) ?? str(session.phase),
    transcript,
    artifacts,
    progress,
  };
}
