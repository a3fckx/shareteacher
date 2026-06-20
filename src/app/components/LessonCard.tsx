"use client";

import clsx from "clsx";
import type { LessonSummary } from "./api";

export function LessonCard({
  lesson,
  selected,
  onSelect,
}: {
  lesson: LessonSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "flex w-full flex-col gap-2 rounded-xl border bg-panel p-4 text-left transition-colors",
        selected
          ? "border-accent ring-1 ring-accent/40"
          : "border-edge hover:border-white/25",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/90">{lesson.title}</h3>
        <span
          className={clsx(
            "mt-0.5 h-4 w-4 shrink-0 rounded-full border",
            selected ? "border-accent bg-accent" : "border-white/25",
          )}
        />
      </div>
      {lesson.goal && (
        <p className="line-clamp-3 text-xs leading-snug text-white/55">
          {lesson.goal}
        </p>
      )}
      {typeof lesson.stepCount === "number" && (
        <span className="mt-1 text-[11px] uppercase tracking-wide text-white/35">
          {lesson.stepCount} step{lesson.stepCount === 1 ? "" : "s"}
        </span>
      )}
    </button>
  );
}
