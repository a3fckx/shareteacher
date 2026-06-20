"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchSummary, type SessionSummaryData } from "../../components/api";

export default function SummaryPage() {
  const params = useParams<{ id: string | string[] }>();
  const raw = params?.id;
  const sessionId = Array.isArray(raw) ? raw[0] : raw;

  const [data, setData] = useState<SessionSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      setError("No session id in the URL.");
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    fetchSummary(sessionId)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((err: unknown) => {
        if (active)
          setError(err instanceof Error ? err.message : "Could not load summary");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
            Session summary
          </span>
          <h1 className="text-xl font-semibold text-white">
            {data?.lessonId ?? "Lesson"} · {sessionId ?? "—"}
          </h1>
          {data?.phase && (
            <span className="text-xs uppercase tracking-wide text-white/45">
              {data.phase.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <Link
          href="/"
          className="rounded-lg border border-edge px-4 py-2 text-sm text-white/70 hover:border-white/30"
        >
          New session
        </Link>
      </header>

      {loading ? (
        <p className="text-sm text-white/45">Loading summary…</p>
      ) : error ? (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
          {error}
        </div>
      ) : data ? (
        <>
          {data.progress && (
            <section className="rounded-xl border border-edge bg-panel p-5">
              <h2 className="mb-2 text-sm font-semibold text-white/80">
                Progress
              </h2>
              <p className="text-sm text-white/60">
                {data.progress.done
                  ? "Lesson completed."
                  : "Lesson in progress."}
                {typeof data.progress.stepIndex === "number" && (
                  <>
                    {" "}
                    Reached step {data.progress.stepIndex + 1}
                    {typeof data.progress.total === "number"
                      ? ` of ${data.progress.total}`
                      : ""}
                    .
                  </>
                )}
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-white/80">
              Artifacts ({data.artifacts.length})
            </h2>
            {data.artifacts.length === 0 ? (
              <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-white/45">
                No artifacts were saved for this session.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.artifacts.map((artifact, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white/90">
                        {artifact.name}
                      </p>
                      <span className="text-[11px] uppercase tracking-wide text-white/35">
                        {artifact.kind}
                      </span>
                    </div>
                    <a
                      href={artifact.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-ink"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-white/80">
              Transcript ({data.transcript.length})
            </h2>
            {data.transcript.length === 0 ? (
              <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-white/45">
                No transcript was recorded.
              </p>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4">
                {data.transcript.map((line, i) => (
                  <div key={i} className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wide text-white/30">
                      {line.speaker === "human" ? "Participant" : "Teacher"}
                    </span>
                    <p className="text-sm leading-snug text-white/80">
                      {line.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
