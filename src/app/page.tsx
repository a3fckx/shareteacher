"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchLessons,
  startSession,
  type LessonSummary,
} from "./components/api";
import { LessonCard } from "./components/LessonCard";

export default function LauncherPage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function loadLessons() {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchLessons();
      setLessons(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load lessons");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLessons();
  }, []);

  async function handleStart() {
    if (!selectedId || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const id = await startSession({ lessonId: selectedId, meetingUrl });
      router.push(
        `/stage?session=${encodeURIComponent(id)}&lesson=${encodeURIComponent(selectedId)}`,
      );
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Could not start the session",
      );
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
          ShareTeacher
        </span>
        <h1 className="text-2xl font-semibold text-white">
          Start a teaching session
        </h1>
        <p className="max-w-2xl text-sm text-white/55">
          Pick a lesson. The Runway teacher joins, shares a real browser, and
          walks your meeting through the workflow step by step.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/80">Lessons</h2>
          {loadError && (
            <button
              type="button"
              onClick={() => void loadLessons()}
              className="text-xs text-accent underline underline-offset-2"
            >
              Retry
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-edge bg-panel/60"
              />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
            {loadError}
          </div>
        ) : lessons.length === 0 ? (
          <div className="rounded-xl border border-edge bg-panel p-4 text-sm text-white/55">
            No lessons are available yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                selected={lesson.id === selectedId}
                onSelect={() => setSelectedId(lesson.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-edge bg-panel p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white/80">
            Meeting link{" "}
            <span className="font-normal text-white/40">(optional)</span>
          </span>
          <input
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://meet.google.com/…  or leave blank for in-app classroom"
            className="rounded-lg border border-edge bg-ink/50 px-3 py-2.5 text-sm text-white/90 outline-none focus:border-accent"
          />
          <span className="text-xs text-white/40">
            Provide a Google Meet, Zoom, or Teams link to send the teacher into a
            live meeting. Leave empty to run the classroom in the browser.
          </span>
        </label>

        {startError && (
          <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {startError}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={!selectedId || starting}
          className="self-start rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start teaching session"}
        </button>
      </section>
    </main>
  );
}
