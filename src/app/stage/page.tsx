"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  requestTakeover,
  sendAnswer,
  stopSession,
} from "../components/api";
import { useStageStream } from "../components/useStageStream";
import { lastTeacherLine } from "../components/stage-state";
import { AvatarStage } from "../components/AvatarStage";
import { DraggablePip } from "../components/DraggablePip";
import { BrowserViewport } from "../components/BrowserViewport";
import {
  AnnotationOverlay,
  STAGE_VIEWPORT_ID,
  useAnnotations,
  useElementSize,
  zoomTransform,
} from "../components/AnnotationOverlay";
import { StepTimeline } from "../components/StepTimeline";
import { PromptPanel } from "../components/PromptPanel";
import { OutputPanel } from "../components/OutputPanel";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { CheckpointCard } from "../components/CheckpointCard";
import { TakeoverControls } from "../components/TakeoverControls";

export default function StagePage() {
  return (
    <Suspense fallback={<StageFallback />}>
      <StageInner />
    </Suspense>
  );
}

function StageFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-white/45">
      Loading classroom…
    </main>
  );
}

function StageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const lessonId = searchParams.get("lesson");

  const { state, connected, speaking, error, clearCheckpoint } =
    useStageStream(sessionId);

  const [takeoverUrl, setTakeoverUrl] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [operatorBusy, setOperatorBusy] = useState(false);

  // The browser is the MAIN surface (the "normal screen" the class looks at).
  // `presenting` is the single full-control flag: when true the live browser is
  // edge-to-edge and all chrome is hidden except the floating avatar PiP + Exit.
  // It is turned ON by the agent's share_screen(foreground) / take_control(full)
  // OR the human "Take control" button, and OFF by share_screen(restore) /
  // take_control(exit) / the Exit button.
  const [presenting, setPresenting] = useState(false);
  const [presentReason, setPresentReason] = useState<string | null>(null);
  // The lesson detail panels live in a collapsible right-side drawer, hidden by
  // default so the default view is a clean browser + avatar PiP.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const enterPresenting = useCallback((reason?: string | null) => {
    setPresenting(true);
    setPresentReason(reason ?? null);
    setDrawerOpen(false);
  }, []);
  const exitPresenting = useCallback(() => {
    setPresenting(false);
    setPresentReason(null);
  }, []);

  // Avatar-driven visual overlays (zoom / spotlight / arrow / circle / caption).
  // The page owns the state so the avatar's useClientEvent handlers (inside the
  // AvatarSession) can write it AND the zoom CSS transform can be applied to the
  // live-browser viewport wrapper here. Wipe overlays when the class ends.
  const ann = useAnnotations();
  const annClearAll = ann.clearAll;
  const { ref: viewportRef, size: viewportSize } =
    useElementSize<HTMLDivElement>();
  const zoomCss = ann.state.zoom
    ? zoomTransform(ann.state.zoom.region, viewportSize, {
        scale: ann.state.zoom.scale,
      })
    : "none";

  useEffect(() => {
    if (state.phase === "completed" || state.phase === "failed") annClearAll();
  }, [state.phase, annClearAll]);

  async function handleAnswer(response: string) {
    if (!sessionId) return;
    setAnswering(true);
    clearCheckpoint();
    try {
      await sendAnswer(sessionId, response);
    } finally {
      setAnswering(false);
    }
  }

  async function handleTakeover() {
    if (!sessionId) return;
    setOperatorBusy(true);
    try {
      const url = await requestTakeover(sessionId);
      setTakeoverUrl(url ?? state.takeover?.url ?? null);
    } finally {
      setOperatorBusy(false);
    }
  }

  async function handleStop() {
    if (!sessionId) return;
    setOperatorBusy(true);
    try {
      await stopSession(sessionId);
      router.push(`/summary/${encodeURIComponent(sessionId)}`);
    } finally {
      setOperatorBusy(false);
    }
  }

  if (!sessionId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-white/60">No session selected.</p>
        <Link
          href="/"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink"
        >
          Back to launcher
        </Link>
      </main>
    );
  }

  const effectiveTakeoverUrl = takeoverUrl ?? state.takeover?.url ?? null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      {/* ── Background "normal screen": the agent-driven browser fills the whole
          area. The avatar's `zoom` tool magnifies a region by transforming this
          wrapper; <AnnotationOverlay/> draws spotlight / arrow / circle / caption
          on a sibling plane over it. data-avatar-target keeps the built-in
          highlight/scroll_to/click working; STAGE_VIEWPORT_ID lets the overlay
          map normalized coords. */}
      <div
        ref={viewportRef}
        id={STAGE_VIEWPORT_ID}
        data-avatar-target="teaching-browser"
        className="absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute inset-0 flex flex-col transition-transform duration-700 ease-[cubic-bezier(.2,.7,.2,1)] will-change-transform"
          style={{ transform: zoomCss, transformOrigin: "0 0" }}
        >
          <BrowserViewport
            liveUrl={state.liveUrl}
            screenshotUrl={state.screenshotUrl}
            highlightLabel={state.highlight?.label ?? null}
          />
        </div>
        <AnnotationOverlay state={ann.state} />
      </div>

      {/* ── Floating, draggable avatar PiP — always on top, in both modes. The
          live <AvatarSession> stays mounted (drag only changes CSS position). */}
      <DraggablePip defaultCorner="bottom-left">
        <AvatarStage
          sessionId={sessionId}
          lessonId={lessonId}
          lastLine={lastTeacherLine(state)}
          speaking={speaking}
          phase={state.phase}
          connected={connected}
          sharing={presenting}
          variant="pip"
          onShareScreen={(args) => {
            if (args.focus === "restore") exitPresenting();
            else enterPresenting(args.reason ?? null);
          }}
          onTakeControl={(args) => {
            if (args.mode === "exit") exitPresenting();
            else enterPresenting(args.reason ?? null);
          }}
          annotate={ann}
        />
      </DraggablePip>

      {/* ── Top-right control cluster. Normal mode: Take control + operator
          (Take over / Stop). Presenting mode: only a small Exit affordance. */}
      {presenting ? (
        <button
          type="button"
          onClick={exitPresenting}
          className="fixed right-4 top-4 z-[70] flex items-center gap-1.5 rounded-full border border-edge/80 bg-panel/80 px-3.5 py-2 text-xs font-semibold text-white/85 shadow-lg backdrop-blur transition-colors hover:bg-panel"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Exit full screen
        </button>
      ) : (
        <div className="fixed right-4 top-4 z-[70] flex items-start gap-2">
          <button
            type="button"
            onClick={() => enterPresenting()}
            className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-3.5 py-2 text-sm font-semibold text-accent shadow-lg backdrop-blur transition-colors hover:bg-accent/25"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Take control
          </button>
          <TakeoverControls
            takeoverUrl={effectiveTakeoverUrl}
            connected={connected}
            busy={operatorBusy}
            onTakeover={() => void handleTakeover()}
            onStop={() => void handleStop()}
          />
        </div>
      )}

      {/* ── Lesson drawer toggle (hidden while presenting). */}
      {!presenting && !drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-4 right-4 z-[70] flex items-center gap-1.5 rounded-full border border-edge/80 bg-panel/80 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/70 shadow-lg backdrop-blur transition-colors hover:bg-panel hover:text-white"
        >
          Lesson
        </button>
      )}

      {/* ── Collapsible right-side lesson drawer. Always mounted (slides off when
          closed) so the data-avatar-target ids keep hosting the panels. */}
      <aside
        className={clsx(
          "fixed right-0 top-0 z-[75] flex h-full w-[min(380px,92vw)] flex-col gap-3 overflow-y-auto border-l border-edge bg-ink/95 p-3 shadow-2xl backdrop-blur transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]",
          drawerOpen && !presenting ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
            Lesson
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="rounded-md border border-edge bg-panel px-2 py-1 text-xs text-white/70 transition-colors hover:text-white"
          >
            Close
          </button>
        </div>
        <div
          id="lesson-steps"
          data-avatar-target="lesson-steps"
          className="flex min-h-[220px] flex-col"
        >
          <StepTimeline steps={state.steps} currentStep={state.currentStep} />
        </div>
        <div id="prompt" data-avatar-target="prompt" className="flex flex-col">
          <PromptPanel prompt={state.prompt} />
        </div>
        <div id="output" data-avatar-target="output" className="flex flex-col">
          <OutputPanel outputs={state.outputs} />
        </div>
        <div
          id="transcript"
          data-avatar-target="transcript"
          className="flex flex-col"
        >
          <TranscriptPanel transcript={state.transcript} />
        </div>
      </aside>

      {/* ── Centered bottom checkpoint overlay (only when there's a checkpoint). */}
      {state.checkpoint && (
        <div className="fixed bottom-6 left-1/2 z-[70] w-[min(560px,92vw)] -translate-x-1/2">
          <div className="rounded-2xl border border-edge/70 bg-ink/85 p-1 shadow-2xl backdrop-blur">
            <CheckpointCard
              checkpoint={state.checkpoint}
              onAnswer={(response) => void handleAnswer(response)}
              submitting={answering}
            />
          </div>
        </div>
      )}

      {/* ── Unobtrusive floating toasts (top-center). */}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[65] flex flex-col items-center gap-2 px-4">
        {error && !connected && (
          <div className="pointer-events-auto max-w-[92vw] rounded-full border border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn shadow-lg backdrop-blur">
            {error} The classroom will resume automatically when the stream
            reconnects.
          </div>
        )}
        {state.takeover && (
          <div className="pointer-events-auto max-w-[92vw] rounded-full border border-warn/50 bg-warn/10 px-4 py-2 text-xs text-warn shadow-lg backdrop-blur">
            Human takeover requested: {state.takeover.reason}
          </div>
        )}
        {presenting && presentReason && (
          <div className="pointer-events-auto max-w-[92vw] rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent shadow-lg backdrop-blur">
            {presentReason}
          </div>
        )}
      </div>
    </main>
  );
}
