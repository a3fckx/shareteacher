import { Empty, Panel, PanelHeader } from "./Panel";
import type { OutputView } from "./stage-state";

export function OutputPanel({ outputs }: { outputs: OutputView[] }) {
  return (
    <Panel className="min-h-[180px]">
      <PanelHeader title="Model output" />
      {outputs.length === 0 ? (
        <Empty>Model and tool output (like the slide outline) appears here.</Empty>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {outputs.map((output, i) => (
            <div key={i} className="rounded-lg border border-edge bg-ink/40 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">
                {output.source}
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-white/85">
                {output.text}
              </pre>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
