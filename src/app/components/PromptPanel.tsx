import { Empty, Panel, PanelHeader } from "./Panel";

export function PromptPanel({
  prompt,
}: {
  prompt: { text: string; target: "chatgpt" | "generic" } | null;
}) {
  return (
    <Panel className="min-h-[180px]">
      <PanelHeader
        title="Prompt"
        right={
          prompt ? (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
              {prompt.target === "chatgpt" ? "ChatGPT" : "Generic"}
            </span>
          ) : undefined
        }
      />
      {prompt ? (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed text-white/85">
          {prompt.text}
        </pre>
      ) : (
        <Empty>The teacher&rsquo;s prompt will show here as it is written.</Empty>
      )}
    </Panel>
  );
}
