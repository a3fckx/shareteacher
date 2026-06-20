"use client";

// DraggablePip — a floating, draggable, always-on-top picture-in-picture shell.
//
// Wraps the avatar widget (the teacher's face + voice) as a fixed-position card
// the user can drag anywhere on screen, like a video-call self-view. It is the
// SAME element in the tree regardless of where it is dragged — only the inline
// `left/top` (or corner anchor) changes — so the children NEVER remount. That is
// load-bearing: the live <AvatarSession> inside must stay continuously connected
// (a remount would reconnect and burn credits).
//
// Interactive children (the mic toggle, the connect button) opt out of starting
// a drag via `closest("button, a, input, …, [data-no-drag]")`, so clicking them
// works normally while dragging anywhere else on the card moves the PiP.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import clsx from "clsx";

type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

/** Gap kept between the PiP and the viewport edges (px). */
const MARGIN = 16;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/** Inline style that anchors the PiP to a corner before it has been measured. */
function cornerStyle(corner: Corner): CSSProperties {
  const right = corner.includes("right");
  const top = corner.includes("top");
  return {
    left: right ? undefined : MARGIN,
    right: right ? MARGIN : undefined,
    top: top ? MARGIN : undefined,
    bottom: top ? undefined : MARGIN,
  };
}

export function DraggablePip({
  children,
  defaultCorner = "bottom-left",
}: {
  children: ReactNode;
  defaultCorner?: Corner;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const offset = useRef<{ dx: number; dy: number } | null>(null);
  // null until first measured → renders via the corner anchor; once set the PiP
  // is positioned by explicit left/top (drag updates this, no remount).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Convert the corner anchor into explicit left/top once mounted. The measured
  // rect equals the anchored position, so there is no visual jump.
  useEffect(() => {
    const el = ref.current;
    if (!el || pos) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.top });
  }, [pos]);

  // Keep the PiP fully on-screen when the viewport resizes.
  useEffect(() => {
    function onResize() {
      const el = ref.current;
      if (!el) return;
      setPos((p) => {
        if (!p) return p;
        return {
          left: clamp(p.left, MARGIN, window.innerWidth - el.offsetWidth - MARGIN),
          top: clamp(p.top, MARGIN, window.innerHeight - el.offsetHeight - MARGIN),
        };
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Let interactive controls (mic toggle, buttons) work without starting a drag.
    if (
      (e.target as HTMLElement).closest(
        "button, a, input, textarea, select, [data-no-drag]",
      )
    ) {
      return;
    }
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    offset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const o = offset.current;
    const el = ref.current;
    if (!o || !el) return;
    setPos({
      left: clamp(e.clientX - o.dx, MARGIN, window.innerWidth - el.offsetWidth - MARGIN),
      top: clamp(e.clientY - o.dy, MARGIN, window.innerHeight - el.offsetHeight - MARGIN),
    });
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!offset.current) return;
    offset.current = null;
    setDragging(false);
    ref.current?.releasePointerCapture?.(e.pointerId);
  }

  const style: CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : cornerStyle(defaultCorner);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={style}
      className={clsx(
        "fixed z-[80] touch-none select-none overflow-hidden rounded-2xl border border-edge/80 bg-black/20 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.8)] ring-1 ring-white/5 backdrop-blur transition-shadow",
        dragging ? "cursor-grabbing shadow-[0_30px_70px_-16px_rgba(0,0,0,0.9)]" : "cursor-grab",
      )}
    >
      {children}
    </div>
  );
}
