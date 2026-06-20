"use client";

// AnnotationOverlay — the visual presentation layer the live avatar drives over
// the LIVE BROWSER viewport.
//
// The Kernel teaching browser is a cross-origin <iframe> (or a screenshot <img>
// fallback) with NO addressable inner DOM. So in-browser annotations are placed
// by NORMALIZED coordinates — x/y/w/h as 0..1 fractions of the viewport box —
// which the agent estimates from the screenshots it is shown. Whole-panel
// targeting by `[data-avatar-target]` id is ALSO supported: `regionFromArgs`
// resolves a panel element's rect relative to the overlay container.
//
// State lives in `useAnnotations()` (owned by the stage page) so that:
//   • the avatar's `useClientEvent` handlers (which must live inside the
//     <AvatarSession> subtree) can `set(...)` overlays, exactly mirroring the
//     existing `share_screen` lift-to-page pattern, and
//   • the page can apply the `zoom` CSS transform to the viewport wrapper while
//     this overlay (spotlight / arrow / circle / caption) renders on a sibling
//     plane that maps normalized coords straight to CSS percentages.
//
// GPU-cheap by design: only transform / opacity / stroke-dashoffset animate
// (never SVG geometry), because the Recall webpage camera re-captures /stage and
// animating geometry would thrash the capture framerate.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface Box01 {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type AnnColor = "accent" | "good" | "warn" | "bad";
export interface ZoomState {
  region: Box01;
  scale?: number;
}
export interface ShapeState {
  box: Box01;
  shape: "circle" | "box" | "rect";
  color: AnnColor;
  label?: string;
}
export interface ArrowState {
  tip: { x: number; y: number };
  from: "left" | "right" | "top" | "bottom" | "auto";
  label?: string;
}
export interface CaptionState {
  text: string;
  position: "top" | "bottom";
}
export interface AnnotationState {
  zoom: ZoomState | null;
  spotlight: ShapeState | null;
  arrow: ArrowState | null;
  circle: ShapeState | null;
  caption: CaptionState | null;
}

const EMPTY: AnnotationState = {
  zoom: null,
  spotlight: null,
  arrow: null,
  circle: null,
  caption: null,
};

/** Per-type default hold time (ms) before the overlay auto-clears. */
const DEFAULT_MS: Record<keyof AnnotationState, number> = {
  zoom: 6000,
  spotlight: 5000,
  arrow: 4000,
  circle: 4000,
  caption: 6000,
};

const COLOR: Record<AnnColor, string> = {
  accent: "#5b8cff",
  good: "#46d39a",
  warn: "#ffb454",
  bad: "#ff5d6c",
};

/** id the stage page assigns to the viewport container the overlay maps onto. */
export const STAGE_VIEWPORT_ID = "stage-viewport";

// ── State hook (owned by the page; written by the avatar tool handlers) ───────

export interface AnnotationApi {
  state: AnnotationState;
  set: <K extends keyof AnnotationState>(
    k: K,
    v: AnnotationState[K],
    ms?: number,
  ) => void;
  clearAll: () => void;
}

export function useAnnotations(): AnnotationApi {
  const [state, setState] = useState<AnnotationState>(EMPTY);
  const timers = useRef<
    Partial<Record<keyof AnnotationState, ReturnType<typeof setTimeout>>>
  >({});

  const set = useCallback(
    <K extends keyof AnnotationState>(
      k: K,
      v: AnnotationState[K],
      ms?: number,
    ) => {
      const existing = timers.current[k];
      if (existing) clearTimeout(existing);
      setState((s) => ({ ...s, [k]: v }) as AnnotationState);
      if (v !== null) {
        timers.current[k] = setTimeout(() => {
          delete timers.current[k];
          setState((s) => ({ ...s, [k]: null }) as AnnotationState);
        }, ms ?? DEFAULT_MS[k]);
      }
    },
    [],
  );

  const clearAll = useCallback(() => {
    for (const t of Object.values(timers.current)) clearTimeout(t);
    timers.current = {};
    setState(EMPTY);
  }, []);

  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
    },
    [],
  );

  return { state, set, clearAll };
}

// ── Coordinate helpers (used by the avatar tool handlers) ─────────────────────

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clampBox(b: Box01): Box01 {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  return {
    x,
    y,
    w: Math.min(Math.max(b.w, 0.01), 1 - x),
    h: Math.min(Math.max(b.h, 0.01), 1 - y),
  };
}

/** Resolve a `[data-avatar-target]` / id panel to a normalized box of the viewport. */
function boxFromTarget(target: string): Box01 | null {
  if (typeof document === "undefined") return null;
  const container = document.getElementById(STAGE_VIEWPORT_ID);
  const el =
    document.getElementById(target) ??
    document.querySelector(`[data-avatar-target="${target}"]`);
  if (!container || !(el instanceof HTMLElement)) return null;
  const cr = container.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (cr.width === 0 || cr.height === 0) return null;
  return clampBox({
    x: (er.left - cr.left) / cr.width,
    y: (er.top - cr.top) / cr.height,
    w: er.width / cr.width,
    h: er.height / cr.height,
  });
}

/**
 * Turn raw tool args into a normalized viewport box. Prefers explicit x/y/w/h
 * (the only way to reach a spot INSIDE the cross-origin browser); falls back to
 * resolving a `[data-avatar-target]` panel id. Returns null when neither works.
 */
export function regionFromArgs(
  a: { target?: string; x?: number; y?: number; w?: number; h?: number },
  defW = 0.18,
  defH = 0.12,
): Box01 | null {
  if (a.x != null && a.y != null) {
    return clampBox({ x: a.x, y: a.y, w: a.w ?? defW, h: a.h ?? defH });
  }
  if (a.target) return boxFromTarget(a.target);
  return null;
}

/** Resolve a single point (arrow tip) from x/y or the center of a target panel. */
export function pointFromArgs(a: {
  target?: string;
  x?: number;
  y?: number;
}): { x: number; y: number } | null {
  if (a.x != null && a.y != null) return { x: clamp01(a.x), y: clamp01(a.y) };
  if (a.target) {
    const b = boxFromTarget(a.target);
    if (b) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return null;
}

/**
 * CSS transform that magnifies `region` to the center of a `size`-px viewport.
 * transform-origin MUST be `0 0` on the zoom layer this string is applied to.
 */
export function zoomTransform(
  region: Box01,
  size: { w: number; h: number },
  opts?: { scale?: number; maxScale?: number },
): string {
  if (size.w === 0 || size.h === 0) return "none";
  const maxScale = opts?.maxScale ?? 4;
  const rw = Math.max(region.w, 0.04);
  const rh = Math.max(region.h, 0.04);
  const fit = Math.min(1 / rw, 1 / rh);
  const s =
    opts?.scale != null
      ? Math.min(maxScale, Math.max(1, opts.scale))
      : Math.min(maxScale, Math.max(1, fit));
  const cx = (region.x + rw / 2) * size.w;
  const cy = (region.y + rh / 2) * size.h;
  return `translate(${size.w / 2 - s * cx}px, ${size.h / 2 - s * cy}px) scale(${s})`;
}

// ── Size hook (ResizeObserver) ────────────────────────────────────────────────

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

// ── Overlay ───────────────────────────────────────────────────────────────────

export function AnnotationOverlay({ state }: { state: AnnotationState }) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const { spotlight, arrow, circle, caption } = state;
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      {spotlight && (
        <Spotlight
          box={spotlight.box}
          shape={spotlight.shape}
          color={COLOR[spotlight.color]}
          label={spotlight.label}
        />
      )}
      {circle && (
        <Ring
          box={circle.box}
          shape={circle.shape}
          color={COLOR[circle.color]}
          label={circle.label}
        />
      )}
      {arrow && size.w > 0 && (
        <Arrow tip={arrow.tip} from={arrow.from} label={arrow.label} size={size} />
      )}
      {caption && <Caption text={caption.text} position={caption.position} />}
    </div>
  );
}

function Spotlight({
  box,
  shape,
  color,
  label,
}: {
  box: Box01;
  shape: "circle" | "box" | "rect";
  color: string;
  label?: string;
}) {
  const cx = (box.x + box.w / 2) * 100;
  const cy = (box.y + box.h / 2) * 100;
  const rx = (box.w / 2) * 100;
  const ry = (box.h / 2) * 100;
  const isRect = shape === "rect" || shape === "box";
  return (
    <div className="ann-fade absolute inset-0">
      <svg
        className="h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <defs>
          <filter id="ann-feather">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          <mask id="ann-spot">
            <rect width="100" height="100" fill="white" />
            {isRect ? (
              <rect
                x={box.x * 100}
                y={box.y * 100}
                width={box.w * 100}
                height={box.h * 100}
                rx="2"
                fill="black"
                filter="url(#ann-feather)"
              />
            ) : (
              <ellipse
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                fill="black"
                filter="url(#ann-feather)"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100"
          height="100"
          fill="rgba(4,6,12,0.72)"
          mask="url(#ann-spot)"
        />
        {!isRect && (
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={color}
            strokeWidth="0.4"
            opacity="0.85"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {label && (
        <div
          className="absolute inset-x-0 flex justify-center"
          style={{ top: `${Math.min(cy + ry + 4, 92)}%` }}
        >
          <span className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
            {label}
          </span>
        </div>
      )}
    </div>
  );
}

function Ring({
  box,
  shape,
  color,
  label,
}: {
  box: Box01;
  shape: "circle" | "box" | "rect";
  color: string;
  label?: string;
}) {
  return (
    <div
      className="ann-pop absolute"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          border: `2.5px solid ${color}`,
          borderRadius: shape === "circle" ? "9999px" : "10px",
          boxShadow: `0 0 0 2px ${color}33, 0 0 22px 4px ${color}66, inset 0 0 18px ${color}22`,
        }}
      />
      {label && (
        <span
          className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-ink"
          style={{ background: color }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

function Arrow({
  tip,
  from,
  label,
  size,
}: {
  tip: { x: number; y: number };
  from: "left" | "right" | "top" | "bottom" | "auto";
  label?: string;
  size: { w: number; h: number };
}) {
  const tx = tip.x * size.w;
  const ty = tip.y * size.h;
  const L = 140;
  const dir = from === "auto" ? (tip.x > 0.5 ? "right" : "left") : from;
  const start =
    dir === "right"
      ? { x: tx + L, y: ty }
      : dir === "top"
        ? { x: tx, y: ty - L }
        : dir === "bottom"
          ? { x: tx, y: ty + L }
          : { x: tx - L, y: ty };
  const len = Math.hypot(tx - start.x, ty - start.y);
  return (
    <svg className="absolute inset-0 h-full w-full">
      <defs>
        <marker
          id="ann-arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="7"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L7,3 L0,6 Z" fill={COLOR.accent} />
        </marker>
      </defs>
      <line
        x1={start.x}
        y1={start.y}
        x2={tx}
        y2={ty}
        stroke={COLOR.accent}
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd="url(#ann-arrowhead)"
        className="ann-arrow"
        style={{
          strokeDasharray: len,
          strokeDashoffset: len,
          filter: "drop-shadow(0 0 6px #5b8cff88)",
        }}
      />
      {label && (
        <text
          x={start.x}
          y={start.y - 8}
          fill="#fff"
          fontSize="13"
          fontWeight="600"
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </svg>
  );
}

function Caption({
  text,
  position,
}: {
  text: string;
  position: "top" | "bottom";
}) {
  return (
    <div
      className="absolute inset-x-0 flex justify-center px-4"
      style={{ [position]: "5%" } as CSSProperties}
    >
      <div className="ann-fade-up max-w-[82%] rounded-xl border border-white/10 bg-black/55 px-5 py-2.5 text-center text-lg font-semibold leading-snug text-white shadow-2xl backdrop-blur-md">
        {text}
      </div>
    </div>
  );
}
