import clsx from "clsx";
import { Empty, Panel, PanelHeader } from "./Panel";
import type { StepView } from "./stage-state";

export function StepTimeline({
  steps,
  currentStep,
}: {
  steps: StepView[];
  currentStep: number;
}) {
  return (
    <Panel className="flex-1">
      <PanelHeader
        title="Lesson steps"
        right={
          steps.length > 0 ? (
            <span className="text-[11px] text-white/40">
              {Math.max(0, currentStep) + 1}/{steps.length}
            </span>
          ) : undefined
        }
      />
      {steps.length === 0 ? (
        <Empty>Lesson steps will appear here as the teacher progresses.</Empty>
      ) : (
        <ol className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {steps.map((step) => {
            const isCurrent = step.index === currentStep;
            const isDone = step.index < currentStep;
            return (
              <li
                key={step.index}
                className={clsx(
                  "flex gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  isCurrent
                    ? "border-accent/60 bg-accent/10"
                    : "border-transparent",
                )}
              >
                <span
                  className={clsx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    isCurrent
                      ? "bg-accent text-ink"
                      : isDone
                        ? "bg-good/20 text-good"
                        : "bg-white/8 text-white/40",
                  )}
                >
                  {isDone ? "✓" : step.index + 1}
                </span>
                <div className="min-w-0">
                  <p
                    className={clsx(
                      "text-sm font-medium leading-snug",
                      isCurrent ? "text-white" : "text-white/70",
                    )}
                  >
                    {step.title}
                  </p>
                  {step.body && (
                    <p className="mt-0.5 text-xs leading-snug text-white/45">
                      {step.body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
