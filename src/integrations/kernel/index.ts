// ─────────────────────────────────────────────────────────────────────────
// Organ 3: Kernel browser runtime (REAL only).
//
// Owns real cloud-browser infrastructure: starting sessions on Kernel
// (onkernel / kernel.sh) with a persistent profile, exposing a live view the
// teaching UI embeds in an iframe, capturing screenshots, and tearing down.
//
// There is no mock. `createBrowserRuntime(env)` always returns the live
// Kernel-backed runtime. Construction never performs I/O and never throws —
// a missing/invalid KERNEL_API_KEY only surfaces when a live call is made.
//
// Server-only module. Never import from a client component.
// ─────────────────────────────────────────────────────────────────────────

import type {
  BrowserRuntime,
  BrowserSessionInfo,
  Env,
  Mode,
} from "@/types/contracts";
import { cdpScreenshot } from "./cdp";

const ADAPTER_NAME = "kernel";
const MODE: Mode = "real";

// ── Shared in-process session store ────────────────────────────────────────
// Keyed by our returned sessionId. Lets liveViewUrl/screenshot/recordingUrl/
// stopSession resolve a session without re-hitting the network.

interface SessionState {
  info: BrowserSessionInfo;
  /** Kernel-issued HTTP base url for the session. */
  baseUrl?: string;
}

const store = new Map<string, SessionState>();

// ── REAL runtime (Kernel / onkernel) ───────────────────────────────────────

interface KernelProfile {
  id?: string;
  name?: string;
}

interface KernelCreateResponse {
  session_id: string;
  cdp_ws_url: string;
  webdriver_ws_url?: string;
  browser_live_view_url?: string;
  base_url?: string;
  profile?: KernelProfile;
}

function createRealRuntime(env: Env): BrowserRuntime {
  const apiKey = env.kernel.apiKey;
  const baseUrl = env.kernel.baseUrl.replace(/\/+$/, "");
  // The persistent profile the user wants reused on every session. ChatGPT
  // login (and any other state) is saved back into it on stopSession.
  const persistentProfile = env.kernel.profileName;
  // Latched true the first time Kernel rejects a profile as plan-gated, so every
  // SUBSEQUENT session skips the doomed persistent attempt and goes straight to a
  // profileless browser — removing the wasted 403 round-trip (and its latency).
  let profilesDisabled = false;
  // Log the shape of the first create response so a missing browser_live_view_url
  // (which would make the takeover iframe silently fall back to base_url → black)
  // is visible once, without spamming or leaking the actual URLs/tokens.
  let loggedCreateShape = false;

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey ?? ""}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async function readError(res: Response): Promise<string> {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return `Kernel ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 500)}` : ""}`;
  }

  /**
   * POST /browsers. When `profileName` is set we bind a persistent profile
   * (save_changes) so ChatGPT login survives sessions; when null we create a
   * profileless (ephemeral) browser, which is what the Kernel free plan allows.
   */
  async function createBrowser(profileName: string | null): Promise<Response> {
    const body: Record<string, unknown> = {
      // Live view requires a non-headless browser.
      headless: false,
      stealth: true,
      timeout_seconds: 3600,
    };
    if (profileName) {
      body.profile = { name: profileName, save_changes: true };
    }
    return fetch(`${baseUrl}/browsers`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  }

  // A named persistent profile requires a Kernel paid plan (Hobbyist+); on the
  // free/unpaid plan the create fails with this signature and we degrade to profileless.
  const PLAN_GATED = /insufficient_plan|profiles? require|paid plan|payment method/i;

  return {
    name: ADAPTER_NAME,
    mode: MODE,

    async startSession(profileId: string): Promise<BrowserSessionInfo> {
      // Bind to the persistent profile. The orchestrator passes a sentinel
      // ("default") when it has no explicit profile in mind — in that case we
      // use the configured persistent profile so the SAME ChatGPT login is
      // reused every session. A real, explicit profileId still overrides.
      const requestedProfile =
        profileId && profileId !== "default" ? profileId : persistentProfile;

      // Prefer a persistent profile; if the plan can't grant one, fall back to a
      // profileless browser so the REAL cloud browser (cdp + live view) still
      // comes up. Only login persistence is lost until the plan is upgraded.
      // Once we've learned profiles are plan-gated, skip the attempt entirely.
      let boundProfile: string | null = profilesDisabled ? null : requestedProfile;
      let res = await createBrowser(boundProfile);
      if (!res.ok && boundProfile !== null) {
        const firstErr = await readError(res);
        if (PLAN_GATED.test(firstErr)) {
          if (!profilesDisabled) {
            profilesDisabled = true;
            console.warn(
              `[kernel] persistent profiles are plan-gated (${firstErr}); ` +
                "using profileless browsers for the rest of this run (upgrade Kernel to persist login).",
            );
          }
          boundProfile = null;
          res = await createBrowser(null);
          if (!res.ok) throw new Error(await readError(res));
        } else {
          throw new Error(firstErr);
        }
      } else if (!res.ok) {
        throw new Error(await readError(res));
      }

      const data = (await res.json()) as KernelCreateResponse;
      if (!loggedCreateShape) {
        loggedCreateShape = true;
        console.info("[kernel] browser create response shape:", {
          session_id: Boolean(data.session_id),
          cdp_ws_url: Boolean(data.cdp_ws_url),
          browser_live_view_url: Boolean(data.browser_live_view_url),
          base_url: Boolean(data.base_url),
        });
        if (!data.browser_live_view_url) {
          console.warn(
            "[kernel] create response had no browser_live_view_url — the takeover " +
              "iframe will fall back to base_url and may render black. The " +
              "always-on screenshot stream remains the primary browser surface.",
          );
        }
      }
      const liveView = data.browser_live_view_url ?? data.base_url ?? "";
      const info: BrowserSessionInfo = {
        sessionId: data.session_id,
        cdpUrl: data.cdp_ws_url,
        liveViewUrl: liveView,
        // Kernel does not echo a profile object back; fall through to the name
        // we requested (or "profileless" when we degraded so no profile bound).
        profileId:
          data.profile?.id ?? data.profile?.name ?? boundProfile ?? "profileless",
      };
      store.set(info.sessionId, { info, baseUrl: data.base_url });
      return info;
    },

    async liveViewUrl(sessionId: string): Promise<string> {
      const state = store.get(sessionId);
      if (!state) {
        throw new Error(
          `Kernel: unknown session "${sessionId}" — call startSession first`,
        );
      }
      return state.info.liveViewUrl;
    },

    async screenshot(sessionId: string): Promise<string> {
      const state = store.get(sessionId);
      if (!state) {
        throw new Error(
          `Kernel: unknown session "${sessionId}" — call startSession first`,
        );
      }
      try {
        return await cdpScreenshot(state.info.cdpUrl);
      } catch (err) {
        // A failed snapshot must never break a live lesson — degrade to the
        // embeddable live-view URL the UI can keep showing.
        console.warn(
          `[kernel] CDP screenshot failed for ${sessionId}, falling back to live view: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return state.info.liveViewUrl;
      }
    },

    async recordingUrl(sessionId: string): Promise<string | null> {
      // Best-effort: recordings only exist if a replay was started for this
      // session. Probe the replays listing and return the newest download URL,
      // otherwise null. Any failure is non-fatal.
      try {
        const res = await fetch(
          `${baseUrl}/browsers/${encodeURIComponent(sessionId)}/replays`,
          { headers: authHeaders() },
        );
        if (!res.ok) return null;
        const body: unknown = await res.json();
        const list = Array.isArray(body)
          ? body
          : ((body as { replays?: unknown[] })?.replays ?? []);
        for (let i = list.length - 1; i >= 0; i--) {
          const item = list[i] as Record<string, unknown> | undefined;
          const url =
            (item?.download_url as string | undefined) ??
            (item?.url as string | undefined) ??
            (item?.replay_view_url as string | undefined);
          if (typeof url === "string" && url.length > 0) return url;
        }
        return null;
      } catch {
        return null;
      }
    },

    async stopSession(sessionId: string): Promise<void> {
      // DELETE is the ONLY thing that persists a save_changes profile back —
      // a CDP/ws disconnect does not. Best-effort; Kernel also reaps idle ones.
      try {
        await fetch(`${baseUrl}/browsers/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
      } catch {
        /* best-effort teardown */
      } finally {
        store.delete(sessionId);
      }
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Construct the Kernel browser runtime. Always live — there is no mock mode.
 * Never performs I/O or throws at construction; a missing/invalid
 * KERNEL_API_KEY only fails when a live call (startSession/etc.) is made.
 */
export function createBrowserRuntime(env: Env): BrowserRuntime {
  return createRealRuntime(env);
}
