"use client";

export function TakeoverControls({
  takeoverUrl,
  connected,
  busy,
  onTakeover,
  onStop,
}: {
  takeoverUrl: string | null;
  connected: boolean;
  busy: boolean;
  onTakeover: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          Operator
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/45">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-good" : "bg-bad"}`}
          />
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onTakeover}
          className="flex-1 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm font-semibold text-warn transition-colors hover:bg-warn/20 disabled:opacity-50"
        >
          Take over
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onStop}
          className="flex-1 rounded-lg border border-bad/50 bg-bad/10 px-3 py-2 text-sm font-semibold text-bad transition-colors hover:bg-bad/20 disabled:opacity-50"
        >
          Stop
        </button>
      </div>

      {takeoverUrl && (
        <a
          href={takeoverUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate rounded-lg bg-ink/50 px-3 py-2 text-xs text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
          Open takeover view ↗
        </a>
      )}
    </div>
  );
}
