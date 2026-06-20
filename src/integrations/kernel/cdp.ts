// ─────────────────────────────────────────────────────────────────────────
// Kernel runtime — CDP screenshot helper (real mode only).
//
// Drives a Chrome DevTools Protocol websocket to capture a PNG of the live
// page. Uses the global WHATWG `WebSocket` when available (Node 22+/undici)
// and lazily falls back to the `ws` package. If neither exists it throws a
// clear "pnpm add ws" message — but only when a screenshot is actually
// requested in real mode, never at import/boot time.
// ─────────────────────────────────────────────────────────────────────────

/** Minimal WHATWG-style socket surface. Both the global `WebSocket` and the
 *  `ws` package expose `addEventListener` + `send` + `close`. */
interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
}

type SocketCtor = new (url: string) => SocketLike;

/** Resolve a WebSocket constructor without statically importing `ws`
 *  (the specifier is non-literal so `tsc` never tries to resolve it). */
async function resolveSocketCtor(): Promise<SocketCtor> {
  const globalWs = (globalThis as { WebSocket?: SocketCtor }).WebSocket;
  if (globalWs) return globalWs;
  try {
    const specifier: string = "ws";
    const mod = (await import(specifier)) as {
      WebSocket?: SocketCtor;
      default?: SocketCtor;
    };
    const ctor = mod.WebSocket ?? mod.default;
    if (!ctor) throw new Error("module has no WebSocket export");
    return ctor;
  } catch {
    throw new Error(
      "Kernel real-mode screenshot needs a WebSocket implementation. " +
        "Use Node 22+ (built-in global WebSocket) or run: pnpm add ws",
    );
  }
}

/** Coerce an incoming CDP frame payload to a UTF-8 string. */
function frameToText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return (data as Buffer).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data as Buffer[]).toString("utf8");
  }
  return String(data);
}

interface CdpEnvelope {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/**
 * Connect to a Kernel CDP websocket, attach to the active page target, and
 * capture a PNG screenshot. Resolves a `data:image/png;base64,...` URL.
 * Rejects (with cleanup) on socket error, timeout, or protocol failure — the
 * caller is expected to degrade gracefully (e.g. fall back to the live view).
 */
export async function cdpScreenshot(
  cdpWsUrl: string,
  timeoutMs = 15_000,
): Promise<string> {
  const Ctor = await resolveSocketCtor();

  return new Promise<string>((resolve, reject) => {
    const ws = new Ctor(cdpWsUrl);
    const pending = new Map<number, (m: CdpEnvelope) => void>();
    let msgId = 0;
    let settled = false;

    const timer = setTimeout(
      () => fail(new Error("CDP screenshot timed out")),
      timeoutMs,
    );

    function cleanup(): void {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }
    function done(value: string): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function rpc(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
    ): Promise<CdpEnvelope> {
      const id = ++msgId;
      const payload: Record<string, unknown> = { id, method };
      if (params) payload.params = params;
      if (sessionId) payload.sessionId = sessionId;
      return new Promise<CdpEnvelope>((res) => {
        pending.set(id, res);
        ws.send(JSON.stringify(payload));
      });
    }

    ws.addEventListener("error", (ev: unknown) => {
      const message =
        (ev as { message?: string } | undefined)?.message ?? "unknown error";
      fail(new Error(`CDP socket error: ${message}`));
    });

    ws.addEventListener("close", () => {
      if (!settled) fail(new Error("CDP socket closed before screenshot"));
    });

    ws.addEventListener("message", (ev: unknown) => {
      let env: CdpEnvelope;
      try {
        env = JSON.parse(
          frameToText((ev as { data?: unknown })?.data),
        ) as CdpEnvelope;
      } catch {
        return;
      }
      if (typeof env.id === "number" && pending.has(env.id)) {
        const resolver = pending.get(env.id)!;
        pending.delete(env.id);
        resolver(env);
      }
    });

    ws.addEventListener("open", () => {
      void (async () => {
        try {
          const targets = await rpc("Target.getTargets");
          const infos =
            (targets.result?.targetInfos as
              | { type: string; targetId: string }[]
              | undefined) ?? [];
          const page = infos.find((t) => t.type === "page") ?? infos[0];
          if (!page) throw new Error("no CDP page target available");

          const attached = await rpc("Target.attachToTarget", {
            targetId: page.targetId,
            flatten: true,
          });
          const sessionId = attached.result?.sessionId as string | undefined;
          if (!sessionId) throw new Error("failed to attach to CDP target");

          const shot = await rpc(
            "Page.captureScreenshot",
            { format: "png" },
            sessionId,
          );
          const b64 = shot.result?.data as string | undefined;
          if (!b64) {
            throw new Error(
              shot.error?.message ?? "CDP returned no screenshot data",
            );
          }
          done(`data:image/png;base64,${b64}`);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
  });
}
