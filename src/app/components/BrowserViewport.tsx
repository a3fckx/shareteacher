"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, PanelHeader } from "./Panel";

export function BrowserViewport({
  liveUrl,
  screenshotUrl,
  highlightLabel,
}: {
  liveUrl: string | null;
  screenshotUrl: string | null;
  highlightLabel: string | null;
}) {
  // The server-driven JPEG screenshot STREAM is the PRIMARY, always-reliable
  // browser surface: the Kernel live-view iframe paints black on an unattended
  // page (no focus/gesture), and the Recall webpage-camera has no gesture at
  // all — so whatever the iframe would show, the meeting never sees it. The
  // stream always renders. The live-view iframe is demoted to an OPT-IN human
  // takeover, mounted only on a real click (the gesture lets it focus + accept
  // input).
  const [mode, setMode] = useState<"stream" | "live">("stream");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Double-buffer the streamed frame: only swap the visible <img> once the NEXT
  // frame has decoded, so the viewport never flickers to blank between frames.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!screenshotUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setShownUrl(screenshotUrl);
    };
    img.src = screenshotUrl;
    return () => {
      cancelled = true;
    };
  }, [screenshotUrl]);

  // If takeover was requested but the live URL later disappears, fall back to
  // the stream so the panel never goes blank.
  useEffect(() => {
    if (mode === "live" && !liveUrl) setMode("stream");
  }, [mode, liveUrl]);

  const showLive = mode === "live" && !!liveUrl;
  const hasStream = !!shownUrl;
  const surface = showLive
    ? "interactive"
    : hasStream
      ? "live stream"
      : "standby";

  return (
    <Panel className="flex-1">
      <PanelHeader
        title="Live browser"
        right={
          <div className="flex items-center gap-2">
            {hasStream && !showLive && (
              <span className="flex items-center gap-1.5 rounded-full bg-good/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-good">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
                live
              </span>
            )}
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
              {surface}
            </span>
            {liveUrl && (
              <button
                type="button"
                onClick={() => {
                  const next = showLive ? "stream" : "live";
                  setMode(next);
                  if (next === "live") {
                    // A real click is the gesture the Kernel live view needs to
                    // start streaming + accept input — focus it once mounted.
                    requestAnimationFrame(() => iframeRef.current?.focus());
                  }
                }}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70 transition hover:bg-white/10"
              >
                {showLive ? "Back to stream" : "Interact"}
              </button>
            )}
          </div>
        }
      />
      <div className="relative min-h-0 flex-1 bg-black/40">
        {showLive ? (
          <iframe
            ref={iframeRef}
            src={liveUrl ?? undefined}
            title="Live browser (interactive)"
            className="h-full w-full border-0"
            allow="autoplay; clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => iframeRef.current?.focus()}
          />
        ) : hasStream ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shownUrl ?? undefined}
            alt="Live browser stream"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full min-h-[260px] w-full flex-col items-center justify-center gap-3 text-center text-white/35">
            <span className="relative flex h-10 w-10 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/30" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-accent/70" />
            </span>
            <p className="text-sm text-white/55">Warming up the browser…</p>
            <p className="max-w-xs text-xs text-white/25">
              The shared browser appears here the moment the session opens a
              page — it streams live as the teacher works.
            </p>
          </div>
        )}

        {highlightLabel && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-md border border-accent/50 bg-ink/85 px-3 py-1.5 text-xs font-medium text-accent shadow-lg">
            {highlightLabel}
          </div>
        )}
      </div>
    </Panel>
  );
}
