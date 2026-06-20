// ─────────────────────────────────────────────────────────────────────────
// Server-Sent-Events hub (Organ 0 transport).
//
// An in-memory pub/sub keyed by sessionId. The orchestrator + tools `publish`
// StageEvents; the classroom UI `subscribe`s over an SSE ReadableStream. Recent
// events are buffered per session so a late subscriber (the UI usually connects
// AFTER the fire-and-forget runSession already started) replays everything it
// missed and catches up to the live tail.
//
// Server-only module. No external services — boots with zero credentials.
// ─────────────────────────────────────────────────────────────────────────

import type { StageEvent } from "@/types/contracts";

const encoder = new TextEncoder();

/** How many recent events to retain per session for late-subscriber catch-up. */
const MAX_BUFFER = 500;

/** Heartbeat keeps intermediaries from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

type Controller = ReadableStreamDefaultController<Uint8Array>;

interface SessionHub {
  controllers: Set<Controller>;
  buffer: StageEvent[];
}

// Survive Next dev hot-reload: stash the hub map on globalThis so repeated
// module evaluations share one set of streams/buffers.
const globalKey = "__shareteacher_sse_hubs__";
type GlobalWithHubs = typeof globalThis & {
  [globalKey]?: Map<string, SessionHub>;
};
const g = globalThis as GlobalWithHubs;
const hubs: Map<string, SessionHub> = g[globalKey] ?? new Map();
g[globalKey] = hubs;

function getHub(sessionId: string): SessionHub {
  let hub = hubs.get(sessionId);
  if (!hub) {
    hub = { controllers: new Set(), buffer: [] };
    hubs.set(sessionId, hub);
  }
  return hub;
}

function frame(event: StageEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** Push a StageEvent to every live subscriber of `sessionId` and buffer it. */
export function publish(sessionId: string, event: StageEvent): void {
  const hub = getHub(sessionId);
  // The always-on screenshot STREAM publishes a fresh JPEG frame every ~1.5s.
  // Only the LATEST frame is useful to a late subscriber, and buffering every
  // frame would bloat memory and replay megabytes of base64 on each reconnect
  // (and evict lesson step/transcript history out of the capped buffer). So
  // collapse older buffered screenshots, keeping just the newest. Live
  // subscribers still receive every frame below — this only trims the REPLAY
  // buffer. Lightweight signals (step/prompt/transcript/...) are buffered in full.
  if (event.type === "screenshot") {
    for (let i = hub.buffer.length - 1; i >= 0; i--) {
      if (hub.buffer[i].type === "screenshot") hub.buffer.splice(i, 1);
    }
  }
  hub.buffer.push(event);
  if (hub.buffer.length > MAX_BUFFER) hub.buffer.shift();

  const chunk = frame(event);
  for (const controller of [...hub.controllers]) {
    try {
      controller.enqueue(chunk);
    } catch {
      // Stream already closed/cancelled — drop it.
      hub.controllers.delete(controller);
    }
  }
}

/**
 * Open an SSE ReadableStream for `sessionId`. On connect it replays the buffered
 * events (catch-up), then streams live events plus periodic heartbeats. The
 * stream auto-unregisters on cancel (client disconnect).
 */
export function subscribe(sessionId: string): ReadableStream<Uint8Array> {
  const hub = getHub(sessionId);
  let self: Controller | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      self = controller;
      // Opening comment so proxies flush headers immediately.
      try {
        controller.enqueue(encoder.encode(`: connected ${sessionId}\n\n`));
      } catch {
        /* ignore */
      }
      // Replay everything the late subscriber missed.
      for (const event of hub.buffer) {
        try {
          controller.enqueue(frame(event));
        } catch {
          /* ignore */
        }
      }
      hub.controllers.add(controller);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
          if (self) hub.controllers.delete(self);
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (self) hub.controllers.delete(self);
    },
  });
}

/** Snapshot of buffered events (handy for tests / debugging). */
export function bufferedEvents(sessionId: string): StageEvent[] {
  return [...(hubs.get(sessionId)?.buffer ?? [])];
}

/** Close all subscribers for a session and drop its hub + buffer. */
export function closeSession(sessionId: string): void {
  const hub = hubs.get(sessionId);
  if (!hub) return;
  for (const controller of [...hub.controllers]) {
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  }
  hubs.delete(sessionId);
}
