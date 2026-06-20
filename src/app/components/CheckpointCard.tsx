"use client";

import { useState } from "react";

export function CheckpointCard({
  checkpoint,
  onAnswer,
  submitting,
}: {
  checkpoint: { question: string; choices?: string[] } | null;
  onAnswer: (response: string) => void;
  submitting: boolean;
}) {
  const [freeText, setFreeText] = useState("");

  if (!checkpoint) return null;

  const hasChoices = !!checkpoint.choices && checkpoint.choices.length > 0;

  return (
    <div className="rounded-xl border border-warn/50 bg-warn/10 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn">
          Checkpoint
        </span>
      </div>
      <p className="mb-3 text-sm font-medium leading-snug text-white/90">
        {checkpoint.question}
      </p>

      {hasChoices ? (
        <div className="flex flex-wrap gap-2">
          {checkpoint.choices!.map((choice, i) => (
            <button
              key={i}
              type="button"
              disabled={submitting}
              onClick={() => onAnswer(choice)}
              className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-white/85 transition-colors hover:border-accent hover:text-white disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = freeText.trim();
            if (!value || submitting) return;
            onAnswer(value);
            setFreeText("");
          }}
        >
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            disabled={submitting}
            placeholder="Type your answer…"
            className="flex-1 rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-white/90 outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting || !freeText.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
