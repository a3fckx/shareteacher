// ─────────────────────────────────────────────────────────────────────────
// Browser controller (Organ 4) — REAL only.
//
// Thin HTTP client to the Python "browser_agent" sidecar (FastAPI + browser-use)
// that drives the Kernel cloud browser over its CDP websocket. Every controller
// method proxies to a sidecar endpoint at `env.browserAgentUrl`; open-ended
// goals (task) run through browser-use's LLM agent inside the sidecar, while
// open/click/type/observe/screenshot are deterministic actions on the same
// remote browser. There is no mock and no in-process browser here.
//
// Construction performs NO I/O and never throws — a missing sidecar or bad
// CDP url only surfaces when a live call is made. Navigation is bounded by the
// lesson domain allowlist on BOTH sides: open() refuses off-allowlist URLs here,
// and the sidecar receives the allowlist so its agent cannot wander off either.
//
// Server-only module. Never import from a client component.
// ─────────────────────────────────────────────────────────────────────────

import type {
  BrowserController,
  BrowserSessionInfo,
  Env,
  ObserveResult,
} from "@/types/contracts";
import {
  allowlistFromEnv,
  assertAllowed,
  resolveAllowlist,
} from "./allowlist";

// Default per-call timeout. `task()` gets a much longer budget because an
// open-ended browser-use agent run can take many model+browser round trips.
const DEFAULT_TIMEOUT_MS = 30_000;
const TASK_TIMEOUT_MS = 180_000;
// The screenshot-stream frame must be quick; a slow capture is dropped (the
// stream keeps showing the previous frame) rather than stalling the loop.
const FRAME_TIMEOUT_MS = 8_000;
// JPEG quality for the always-on stream — small frames (~40–120KB), trivial on
// localhost; the live-view iframe stays the high-fidelity human-takeover path.
const FRAME_QUALITY = 50;

export function createRealBrowserController(env: Env): BrowserController {
  const base = (env.browserAgentUrl || "http://localhost:8700").replace(
    /\/+$/,
    "",
  );
  // Effective allowlist: built-in defaults plus any BROWSER_ALLOWLIST extras.
  const allowlist = resolveAllowlist(
    allowlistFromEnv(process.env.BROWSER_ALLOWLIST),
  );
  // The attached Kernel session. Its sessionId keys the sidecar's per-session
  // browser handle; liveViewUrl is the human-takeover URL (no sidecar hop).
  let session: BrowserSessionInfo | null = null;

  function sessionId(): string {
    return session?.sessionId ?? "default";
  }

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers:
          body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Browser sidecar unreachable at ${base}${path}: ${reason}. ` +
          `Start the browser_agent service (uvicorn) on ${base}.`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `Browser sidecar ${method} ${path} -> ${res.status} ${res.statusText}` +
          (text ? `: ${text.slice(0, 400)}` : ""),
      );
    }
    return (await res.json()) as T;
  }

  return {
    name: "browser",
    mode: "real",

    async attach(info: BrowserSessionInfo): Promise<void> {
      session = info;
      // Hand the sidecar the CDP url so browser-use attaches to (never spawns)
      // the Kernel browser, plus the allowlist so its agent stays bounded.
      await call(
        "POST",
        "/session",
        {
          sessionId: info.sessionId,
          cdpUrl: info.cdpUrl,
          allowedDomains: allowlist,
        },
        DEFAULT_TIMEOUT_MS,
      );
    },

    async open(url: string): Promise<void> {
      // Hard guardrail before the network call: refuse off-allowlist URLs.
      assertAllowed(url, allowlist);
      await call("POST", "/open", { sessionId: sessionId(), url }, DEFAULT_TIMEOUT_MS);
    },

    async observe(): Promise<ObserveResult> {
      const r = await call<Partial<ObserveResult>>(
        "GET",
        `/observe?sessionId=${encodeURIComponent(sessionId())}`,
        undefined,
        DEFAULT_TIMEOUT_MS,
      );
      return {
        url: r.url ?? "",
        title: r.title ?? "",
        elements: Array.isArray(r.elements) ? r.elements : [],
        text: r.text ?? "",
      };
    },

    async click(instruction: string): Promise<void> {
      await call(
        "POST",
        "/click",
        { sessionId: sessionId(), instruction },
        DEFAULT_TIMEOUT_MS,
      );
    },

    async type(text: string): Promise<void> {
      await call(
        "POST",
        "/type",
        { sessionId: sessionId(), text: text ?? "" },
        DEFAULT_TIMEOUT_MS,
      );
    },

    async task(goal: string): Promise<{ summary: string; ok: boolean }> {
      const r = await call<{ summary?: string; ok?: boolean }>(
        "POST",
        "/task",
        { sessionId: sessionId(), goal },
        TASK_TIMEOUT_MS,
      );
      return { summary: r.summary ?? "(no result)", ok: Boolean(r.ok) };
    },

    async screenshot(): Promise<string> {
      const r = await call<{ dataUrl?: string }>(
        "GET",
        `/screenshot?sessionId=${encodeURIComponent(sessionId())}`,
        undefined,
        DEFAULT_TIMEOUT_MS,
      );
      if (!r.dataUrl) {
        throw new Error("Browser sidecar returned no screenshot dataUrl");
      }
      return r.dataUrl;
    },

    async frame(): Promise<string> {
      // Lock-free, low-latency JPEG frame for the always-on screenshot stream.
      // Hits the sidecar's /frame (raw image/jpeg bytes) and wraps them into a
      // data URL the `screenshot` StageEvent / <img> can render directly.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FRAME_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(
          `${base}/frame?sessionId=${encodeURIComponent(
            sessionId(),
          )}&quality=${FRAME_QUALITY}`,
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`sidecar /frame -> ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    },

    async takeoverUrl(): Promise<string> {
      // The human-takeover URL is the Kernel live view from attach() — no hop.
      return session?.liveViewUrl ?? "";
    },

    async stop(): Promise<void> {
      try {
        await call("POST", "/stop", { sessionId: sessionId() }, DEFAULT_TIMEOUT_MS);
      } finally {
        // Detach locally regardless; Kernel owns the browser lifecycle and the
        // sidecar keeps it alive (keep_alive) so the persistent profile is saved
        // only by the Kernel runtime's DELETE, not by us.
        session = null;
      }
    },
  };
}
