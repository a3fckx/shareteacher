"use client";

// AvatarStage — the polished, live Runway GWM-1 avatar WIDGET.
//
// It POSTs to /api/session/[id]/avatar to run the server-side
// create -> poll -> consume chain, then renders the genuinely realtime LiveKit
// avatar via `@runwayml/avatars-react`'s <AvatarSession> as a video-led widget:
// a prominent <AvatarVideo> hero with a live status pill, a streaming caption,
// a HUD <ControlBar> (mic + operator screen share) and an <AudioRenderer> whose
// page audio is what the Recall webpage camera carries into the meeting.
//
// Connection auto-starts on mount (hands-free video agent). Two-way audio is on
// so the class can talk to the live teacher. While connecting (or on error) a
// matching fallback widget keeps the classroom header from going blank.
//
// The session subtree also hosts the agent's TOOLS: <PageActions/> executes the
// built-in highlight / scroll_to / click calls against the stage DOM, and
// AvatarToolHandlers routes the custom `share_screen` tool up to the page so the
// agent can bring the teaching browser to the foreground (the page owns the
// layout side-effect). Client tools are fire-and-forget — no values returned.
//
// SECURITY: this is a client component. It only ever receives the LiveKit
// SessionCredentials (serverUrl + token + roomName) from the server route; the
// Runway sessionKey / API secret never reach the browser. Do NOT import any
// server adapter here.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AudioRenderer,
  AvatarSession,
  AvatarVideo,
  ControlBar,
  PageActions,
  ScreenShareVideo,
  useAvatarStatus,
  useClientEvent,
  useTranscript,
  type SessionCredentials,
} from "@runwayml/avatars-react";
import clsx from "clsx";
import type { SessionPhase } from "@/types/contracts";
import {
  shareScreenTool,
  takeControlTool,
  zoomTool,
  spotlightTool,
  arrowTool,
  circleTool,
  captionTool,
  clearOverlayTool,
  type ShareScreenArgs,
  type TakeControlArgs,
} from "@/lib/avatar-tools";
import {
  regionFromArgs,
  pointFromArgs,
  type AnnotationApi,
} from "./AnnotationOverlay";

/** The subset of the annotation API the avatar tool handlers need to drive. */
type AnnotateApi = Pick<AnnotationApi, "set" | "clearAll">;

type ConnectState = "idle" | "connecting" | "live" | "error";

export interface AvatarStageProps {
  sessionId: string;
  lessonId: string | null;
  /** SSE-derived context for the fallback caption (before/without a live avatar). */
  lastLine: string | null;
  speaking: boolean;
  phase: SessionPhase | null;
  connected: boolean;
  /**
   * True while the agent has the teaching browser in the foreground (driven by
   * the page in response to `share_screen`). Surfaces a "Presenting" badge.
   */
  sharing?: boolean;
  /**
   * Invoked when the live agent calls the `share_screen` client tool. The stage
   * page uses it to bring the embedded Kernel teaching browser to the foreground
   * (focus="foreground") or back to the normal layout (focus="restore").
   */
  onShareScreen?: (args: ShareScreenArgs) => void;
  /**
   * Invoked when the live agent calls the `take_control` client tool. The stage
   * page uses it to take the class fully into the live browser (mode="full",
   * edge-to-edge) or return to the normal screen (mode="exit").
   */
  onTakeControl?: (args: TakeControlArgs) => void;
  /**
   * The page-owned annotation API. The avatar's zoom / spotlight / arrow /
   * circle / caption / clear_overlay tool calls write into it; the page renders
   * the matching <AnnotationOverlay/> + zoom transform over the live browser.
   */
  annotate?: AnnotateApi;
  /**
   * "panel" = the full header widget (default, unchanged). "pip" = a compact
   * ~240px floating picture-in-picture card for the draggable PiP shell. Both
   * variants share the SAME <AvatarSession> subtree so switching layouts never
   * remounts the live session.
   */
  variant?: "panel" | "pip";
}

export function AvatarStage({
  sessionId,
  lessonId,
  lastLine,
  speaking,
  phase,
  connected,
  sharing,
  onShareScreen,
  onTakeControl,
  annotate,
  variant = "panel",
}: AvatarStageProps) {
  const [creds, setCreds] = useState<SessionCredentials | null>(null);
  const [state, setState] = useState<ConnectState>("idle");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const connect = useCallback(async () => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    setState("connecting");
    setError(null);
    try {
      const res = await fetch(
        `/api/session/${encodeURIComponent(sessionId)}/avatar`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lessonId: lessonId ?? undefined }),
        },
      );
      const data: unknown = await res.json().catch(() => ({}));
      const rec =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {};
      if (!res.ok) {
        throw new Error(
          typeof rec.error === "string"
            ? rec.error
            : `Avatar connect failed (${res.status})`,
        );
      }
      // The server returns SDK-shaped creds (serverUrl). Tolerate a raw `url`.
      const serverUrl =
        (typeof rec.serverUrl === "string" && rec.serverUrl) ||
        (typeof rec.url === "string" && rec.url) ||
        "";
      const token = typeof rec.token === "string" ? rec.token : "";
      const roomName = typeof rec.roomName === "string" ? rec.roomName : "";
      const sid =
        typeof rec.sessionId === "string" ? rec.sessionId : sessionId;
      if (!serverUrl || !token || !roomName) {
        throw new Error("Avatar credentials were incomplete");
      }
      setCreds({ sessionId: sid, serverUrl, token, roomName });
      setState("live");
    } catch (err) {
      startedRef.current = false;
      setError(err instanceof Error ? err.message : "Could not connect teacher");
      setState("error");
    }
  }, [sessionId, lessonId]);

  // Hands-free video agent: auto-connect the live teacher the moment the stage
  // mounts. Runs once; on error the fallback widget offers a retry.
  useEffect(() => {
    void connect();
  }, [connect]);

  const handleEnd = useCallback(() => {
    setCreds(null);
    setState("idle");
    startedRef.current = false;
    // Best-effort: tear the Runway session down so credits aren't held open.
    if (sessionId) {
      void fetch(`/api/session/${encodeURIComponent(sessionId)}/avatar`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }, [sessionId]);

  if (creds) {
    return (
      <AvatarSession
        credentials={creds}
        audio // realtime two-way: enable the mic so the class can talk to the live teacher
        video={false} // no camera prompt
        onError={(e) => setError(e.message)}
        onEnd={handleEnd}
      >
        {/* Play the avatar's voice (remote audio track). On the Recall webpage
            camera this page audio is what gets carried into the meeting. */}
        <AudioRenderer />
        {/* Agent TOOLS — execute built-in click / scroll_to / highlight tool
            calls against the DOM (targets resolved by id or [data-avatar-target]). */}
        <PageActions />
        {/* Route the custom tools (share_screen + take_control + the annotation
            overlays) to the stage layout. useClientEvent only works inside an
            AvatarSession. */}
        <AvatarToolHandlers
          onShareScreen={onShareScreen}
          onTakeControl={onTakeControl}
          annotate={annotate}
        />
        {variant === "pip" ? (
          <LivePipWidget fallbackLine={lastLine} sharing={sharing} error={error} />
        ) : (
          <LiveAvatarWidget
            fallbackLine={lastLine}
            phase={phase}
            sharing={sharing}
            error={error}
          />
        )}
      </AvatarSession>
    );
  }

  return variant === "pip" ? (
    <FallbackPipWidget
      lastLine={lastLine}
      speaking={speaking}
      connected={connected}
      state={state}
      error={error}
      canConnect={!!sessionId}
      onConnect={() => void connect()}
    />
  ) : (
    <FallbackWidget
      lastLine={lastLine}
      speaking={speaking}
      phase={phase}
      connected={connected}
      state={state}
      error={error}
      canConnect={!!sessionId}
      onConnect={() => void connect()}
    />
  );
}

// ── Client-tool handlers (must live inside an AvatarSession) ─────────────────
// Renders nothing; subscribes to the avatar's custom client tools and forwards
// them up to the page (which owns the layout + overlay side-effects). Client
// tools are fire-and-forget (no return value). useClientEvent only works inside
// an AvatarSession, so these are the single home for the overlay wiring.
function AvatarToolHandlers({
  onShareScreen,
  onTakeControl,
  annotate,
}: {
  onShareScreen?: (args: ShareScreenArgs) => void;
  onTakeControl?: (args: TakeControlArgs) => void;
  annotate?: AnnotateApi;
}) {
  // Screen share: bring the live teaching browser to the foreground / restore it.
  useClientEvent(shareScreenTool, (args) => {
    onShareScreen?.(args);
  });

  // Take control: take the class fully into the live browser (mode='full',
  // edge-to-edge) or return to the normal screen (mode='exit').
  useClientEvent(takeControlTool, (args) => {
    onTakeControl?.(args);
  });

  // zoom — magnify a region (or reset). region comes from x/y/w/h or a panel id.
  useClientEvent(zoomTool, (args) => {
    if (!annotate) return;
    if (args.reset) {
      annotate.set("zoom", null);
      return;
    }
    const region = regionFromArgs(args);
    if (region) annotate.set("zoom", { region, scale: args.scale }, args.duration);
  });

  // spotlight — dim everything except one region.
  useClientEvent(spotlightTool, (args) => {
    if (!annotate) return;
    const box = regionFromArgs(args);
    if (box) {
      annotate.set(
        "spotlight",
        { box, shape: args.shape ?? "circle", color: "accent", label: args.label },
        args.duration,
      );
    }
  });

  // arrow — point at a spot. tip comes from x/y or a panel center.
  useClientEvent(arrowTool, (args) => {
    if (!annotate) return;
    const tip = pointFromArgs(args);
    if (tip) {
      annotate.set(
        "arrow",
        { tip, from: args.from ?? "auto", label: args.label },
        args.duration,
      );
    }
  });

  // circle / box — ring a region.
  useClientEvent(circleTool, (args) => {
    if (!annotate) return;
    const box = regionFromArgs(args);
    if (box) {
      annotate.set(
        "circle",
        {
          box,
          shape: args.shape ?? "circle",
          color: args.color ?? "accent",
          label: args.label,
        },
        args.duration,
      );
    }
  });

  // caption — large lower-third over the stage.
  useClientEvent(captionTool, (args) => {
    if (!annotate) return;
    annotate.set(
      "caption",
      { text: args.text, position: args.position ?? "bottom" },
      args.duration,
    );
  });

  // clear_overlay — wipe everything immediately.
  useClientEvent(clearOverlayTool, () => {
    annotate?.clearAll();
  });

  return null;
}

// ── Shared widget chrome ─────────────────────────────────────────────────────

/** Outer card shared by the live + fallback widgets so they never "jump". */
function WidgetShell({
  glow,
  children,
}: {
  glow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "relative flex min-h-0 overflow-hidden rounded-2xl border bg-gradient-to-br from-panel to-[#0c0f16] transition-shadow duration-500",
        glow
          ? "border-accent/30 shadow-[0_0_0_1px_rgba(91,140,255,0.12),0_22px_55px_-24px_rgba(91,140,255,0.5)]"
          : "border-edge shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]",
      )}
    >
      {/* Premium top accent hairline. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent" />
      {children}
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block animate-spin rounded-full border-2 border-white/15 border-t-white/70",
        className ?? "h-5 w-5",
      )}
    />
  );
}

/** Live-audio equalizer — a quiet "this is on air" pulse under the hero. */
function Equalizer({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-end gap-[3px]", className)} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="block h-3 w-[3px] origin-bottom rounded-full bg-good/90 shadow-[0_0_6px_rgba(70,211,154,0.5)]"
          style={{
            animation: "annEq 0.9s ease-in-out infinite",
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: SessionPhase | null }) {
  if (!phase) return null;
  return (
    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
      {phase.replace(/_/g, " ")}
    </span>
  );
}

// ── Live widget (inside an AvatarSession) ────────────────────────────────────

function LiveAvatarWidget({
  fallbackLine,
  phase,
  sharing,
  error,
}: {
  fallbackLine: string | null;
  phase: SessionPhase | null;
  sharing?: boolean;
  error: string | null;
}) {
  const status = useAvatarStatus();
  // useTranscript is the live source of spoken words (GWM-1 streams them over
  // the data channel). Used as a rolling caption under the video.
  const transcript = useTranscript({ interim: true, bufferSize: 50 });
  const lastSpoken = transcript.length
    ? transcript[transcript.length - 1].text
    : null;

  const ready = status.status === "ready";
  const errored = status.status === "error";
  const label =
    status.status === "ready"
      ? "Live"
      : status.status === "waiting"
        ? "Waiting"
        : status.status === "connecting"
          ? "Connecting"
          : status.status === "ending"
            ? "Ending"
            : status.status === "ended"
              ? "Ended"
              : "Error";

  return (
    <WidgetShell glow={ready}>
      {/* Hero: the prominent live avatar video. */}
      <div className="relative aspect-[4/3] w-[224px] shrink-0 self-stretch overflow-hidden bg-black sm:w-[264px] lg:w-[296px]">
        <AvatarVideo className="absolute inset-0 h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        {/* Cinematic gradient so overlays stay legible. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
        {/* Inner accent frame while live. */}
        {ready && (
          <div className="pointer-events-none absolute inset-0 rounded-l-2xl ring-1 ring-inset ring-accent/20" />
        )}

        {/* LIVE status pill (top-left). */}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur">
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              ready
                ? "animate-pulse bg-good shadow-[0_0_8px_rgba(70,211,154,0.9)]"
                : errored
                  ? "bg-bad"
                  : "bg-warn",
            )}
          />
          <span
            className={clsx(
              ready ? "text-good" : errored ? "text-bad" : "text-white/75",
            )}
          >
            {label}
          </span>
        </div>

        {/* Live-audio equalizer (bottom-left) once the teacher is on air. */}
        {ready && <Equalizer className="absolute bottom-2.5 left-2.5" />}

        {/* Connecting / waiting overlay until the first video frame is ready. */}
        {!ready && !errored && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-white/60">
            <Spinner className="h-6 w-6" />
            <span className="text-[11px] font-medium tracking-wide">
              {label}…
            </span>
          </div>
        )}

        {/* Operator screen-share preview (LiveKit getDisplayMedia). Renders as a
            small PiP only while an operator is actually sharing; the component
            returns null otherwise, so this is invisible at rest. */}
        <ScreenShareVideo className="absolute bottom-2.5 right-2.5 z-10 aspect-video w-[72px] overflow-hidden rounded-md border border-white/25 shadow-lg [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      </div>

      {/* Info + controls column. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-3.5 sm:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-white">
              ShareTeacher
            </span>
            <PhaseBadge phase={phase} />
            {sharing && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                Presenting
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
            Live AI teacher
          </p>
          <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-white/75">
            {lastSpoken ?? fallbackLine ?? "Connecting the teacher…"}
          </p>
          {(error || errored) && (
            <p className="mt-1.5 line-clamp-2 text-xs text-bad">
              {errored ? status.error.message : error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-white/40">
            <span
              className={clsx(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                ready ? "bg-good" : "bg-white/30",
              )}
            />
            <span className="truncate">Two-way audio · live in meeting</span>
          </span>
          {/* HUD: mic toggle + operator screen-share button (getDisplayMedia
              needs a user gesture — the agent uses the `share_screen` tool
              instead). Camera + end-call hidden to keep the class uninterrupted. */}
          <ControlBar
            showMicrophone
            showCamera={false}
            showScreenShare
            showEndCall={false}
          />
        </div>
      </div>
    </WidgetShell>
  );
}

// ── Live PiP widget (compact, for the floating DraggablePip) ─────────────────
// Same AvatarSession subtree as LiveAvatarWidget; just a tighter, vertical card
// sized for the floating picture-in-picture: a ~240px avatar hero, a LIVE pill,
// a slim caption (last spoken line), and a minimal mic control row.

function LivePipWidget({
  fallbackLine,
  sharing,
  error,
}: {
  fallbackLine: string | null;
  sharing?: boolean;
  error: string | null;
}) {
  const status = useAvatarStatus();
  const transcript = useTranscript({ interim: true, bufferSize: 50 });
  const lastSpoken = transcript.length
    ? transcript[transcript.length - 1].text
    : null;

  const ready = status.status === "ready";
  const errored = status.status === "error";
  const label =
    status.status === "ready"
      ? "Live"
      : status.status === "waiting"
        ? "Waiting"
        : status.status === "connecting"
          ? "Connecting"
          : status.status === "ending"
            ? "Ending"
            : status.status === "ended"
              ? "Ended"
              : "Error";

  return (
    <div className="relative flex w-[240px] flex-col bg-gradient-to-br from-panel to-[#0c0f16]">
      {/* Premium top accent hairline. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent" />

      {/* Hero: the live avatar video. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
        <AvatarVideo className="absolute inset-0 h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/10" />
        {ready && (
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-accent/20" />
        )}

        {/* Drag-grip hint (the whole card is draggable). */}
        <span className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-6 -translate-x-1/2 rounded-full bg-white/35" />

        {/* LIVE status pill (top-left). */}
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] backdrop-blur">
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              ready
                ? "animate-pulse bg-good shadow-[0_0_8px_rgba(70,211,154,0.9)]"
                : errored
                  ? "bg-bad"
                  : "bg-warn",
            )}
          />
          <span
            className={clsx(
              ready ? "text-good" : errored ? "text-bad" : "text-white/75",
            )}
          >
            {label}
          </span>
        </div>

        {/* Presenting badge (top-right) while the browser is foregrounded. */}
        {sharing && (
          <span className="absolute right-2 top-2 rounded-full bg-accent/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-accent backdrop-blur">
            Presenting
          </span>
        )}

        {ready && <Equalizer className="absolute bottom-2 left-2" />}

        {!ready && !errored && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
            <Spinner className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">
              {label}…
            </span>
          </div>
        )}

        {/* Operator screen-share preview (null at rest). */}
        <ScreenShareVideo className="absolute bottom-2 right-2 z-10 aspect-video w-[60px] overflow-hidden rounded-md border border-white/25 shadow-lg [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
      </div>

      {/* Caption + minimal controls. */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <p className="line-clamp-2 min-h-[2.4em] text-[12px] leading-snug text-white/75">
          {lastSpoken ?? fallbackLine ?? "Connecting the teacher…"}
        </p>
        {(error || errored) && (
          <p className="line-clamp-1 text-[11px] text-bad">
            {errored ? status.error.message : error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-white/40">
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                ready ? "bg-good" : "bg-white/30",
              )}
            />
            Live in meeting
          </span>
          {/* Mic toggle only — keep the PiP control row minimal. data-no-drag so
              tapping the mic never starts a drag. */}
          <div data-no-drag>
            <ControlBar
              showMicrophone
              showCamera={false}
              showScreenShare={false}
              showEndCall={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Fallback PiP widget (no live avatar yet / credentials absent) ────────────

function FallbackPipWidget({
  lastLine,
  speaking,
  connected,
  state,
  error,
  canConnect,
  onConnect,
}: {
  lastLine: string | null;
  speaking: boolean;
  connected: boolean;
  state: ConnectState;
  error: string | null;
  canConnect: boolean;
  onConnect: () => void;
}) {
  const connecting = state === "connecting";
  const statusLabel = connecting
    ? "Connecting"
    : connected
      ? "Standby"
      : "Offline";

  return (
    <div className="relative flex w-[240px] flex-col bg-gradient-to-br from-panel to-[#0c0f16]">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-accent/25 via-panel to-good/15">
        {connecting ? (
          <Spinner className="h-7 w-7" />
        ) : (
          <div
            className={clsx(
              "flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-good/70 text-lg font-semibold text-ink shadow-[0_8px_30px_-8px_rgba(91,140,255,0.7)]",
              speaking && "ring-4 ring-accent/40",
            )}
          >
            AI
          </div>
        )}
        <span className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-6 -translate-x-1/2 rounded-full bg-white/35" />
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] backdrop-blur">
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              connecting ? "bg-warn" : connected ? "bg-white/40" : "bg-bad",
            )}
          />
          <span className="text-white/75">{statusLabel}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2.5">
        <p className="line-clamp-2 min-h-[2.4em] text-[12px] leading-snug text-white/75">
          {lastLine ?? "Bringing the live teacher online…"}
        </p>
        {error && <p className="line-clamp-1 text-[11px] text-bad">{error}</p>}
        <button
          type="button"
          onClick={onConnect}
          disabled={!canConnect || connecting}
          data-no-drag
          className="self-start rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink shadow-[0_6px_20px_-8px_rgba(91,140,255,0.8)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {connecting
            ? "Connecting…"
            : state === "error"
              ? "Retry"
              : "Connect teacher"}
        </button>
      </div>
    </div>
  );
}

// ── Fallback widget (no live avatar yet / credentials absent) ────────────────

function FallbackWidget({
  lastLine,
  speaking,
  phase,
  connected,
  state,
  error,
  canConnect,
  onConnect,
}: {
  lastLine: string | null;
  speaking: boolean;
  phase: SessionPhase | null;
  connected: boolean;
  state: ConnectState;
  error: string | null;
  canConnect: boolean;
  onConnect: () => void;
}) {
  const connecting = state === "connecting";
  const statusLabel = connecting
    ? "Connecting"
    : connected
      ? "Standby"
      : "Offline";

  return (
    <WidgetShell>
      {/* Hero placeholder while the live video is not yet available. */}
      <div className="relative flex aspect-[4/3] w-[224px] shrink-0 items-center justify-center self-stretch overflow-hidden bg-gradient-to-br from-accent/25 via-panel to-good/15 sm:w-[264px] lg:w-[296px]">
        {connecting ? (
          <Spinner className="h-8 w-8" />
        ) : (
          <div
            className={clsx(
              "flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-good/70 text-xl font-semibold text-ink shadow-[0_8px_30px_-8px_rgba(91,140,255,0.7)] transition-shadow",
              speaking && "ring-4 ring-accent/40",
            )}
          >
            AI
          </div>
        )}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur">
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              connecting ? "bg-warn" : connected ? "bg-white/40" : "bg-bad",
            )}
          />
          <span className="text-white/75">{statusLabel}</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-3.5 sm:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-white">
              ShareTeacher
            </span>
            <PhaseBadge phase={phase} />
          </div>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
            Live AI teacher
          </p>
          <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-white/75">
            {lastLine ?? "Bringing the live teacher online…"}
          </p>
          {error && <p className="mt-1.5 line-clamp-2 text-xs text-bad">{error}</p>}
        </div>

        <button
          type="button"
          onClick={onConnect}
          disabled={!canConnect || connecting}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink shadow-[0_6px_20px_-8px_rgba(91,140,255,0.8)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {connecting
            ? "Connecting…"
            : state === "error"
              ? "Retry"
              : "Connect teacher"}
        </button>
      </div>
    </WidgetShell>
  );
}
