"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Empty, Panel, PanelHeader } from "./Panel";
import type { TranscriptView } from "./stage-state";

export function TranscriptPanel({
  transcript,
}: {
  transcript: TranscriptView[];
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.length]);

  return (
    <Panel className="min-h-[180px]">
      <PanelHeader title="Transcript" />
      {transcript.length === 0 ? (
        <Empty>The conversation transcript will stream here.</Empty>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
          {transcript.map((line, i) => (
            <div
              key={i}
              className={clsx(
                "flex flex-col",
                line.speaker === "human" ? "items-end" : "items-start",
              )}
            >
              <span className="mb-0.5 text-[10px] uppercase tracking-wide text-white/30">
                {line.speaker === "human" ? "Participant" : "Teacher"}
              </span>
              <p
                className={clsx(
                  "max-w-[88%] rounded-lg px-3 py-2 text-sm leading-snug",
                  line.speaker === "human"
                    ? "bg-accent/15 text-white/90"
                    : "bg-white/5 text-white/80",
                )}
              >
                {line.text}
              </p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </Panel>
  );
}
