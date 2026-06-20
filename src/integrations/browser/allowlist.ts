// ─────────────────────────────────────────────────────────────────────────
// Domain allowlist for the Browser controller (Organ 4).
//
// The browser controller MUST refuse to navigate or click outside this set so
// an over-autonomous browser cannot wander off during a live class. The same
// matcher is handed to the Python sidecar so its browser-use agent stays inside
// the allowlist by construction.
// ─────────────────────────────────────────────────────────────────────────

/** Default demo allowlist. Covers the Lesson 1 golden path plus future apps. */
export const DEFAULT_ALLOWLIST: readonly string[] = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "youtube.com",
  "youtu.be",
  "google.com",
  "gamma.app",
  "canva.com",
  "perplexity.ai",
  "claude.ai",
];

/** Parse `BROWSER_ALLOWLIST` (comma separated) into normalized domains. */
export function allowlistFromEnv(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Build the effective allowlist: defaults + any env extras (deduped). */
export function resolveAllowlist(extra?: string[]): string[] {
  const set = new Set<string>(DEFAULT_ALLOWLIST.map((d) => d.toLowerCase()));
  for (const d of extra ?? []) set.add(d.toLowerCase());
  return [...set];
}

/**
 * True when `url` is allowed. `about:blank` and empty URLs are always allowed
 * (they never leave the runtime). A URL matches when its host equals a listed
 * domain or is a subdomain of it.
 */
export function isAllowed(url: string, allowlist: readonly string[]): boolean {
  const trimmed = (url ?? "").trim();
  if (!trimmed || trimmed === "about:blank") return true;
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    // A bare host or malformed string — try to salvage the host portion.
    host = trimmed.toLowerCase().replace(/^[a-z]+:\/\//, "").split("/")[0] ?? "";
    if (!host) return false;
  }
  return allowlist.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** Throw a clear, blocking error if the URL is outside the allowlist. */
export function assertAllowed(url: string, allowlist: readonly string[]): void {
  if (!isAllowed(url, allowlist)) {
    throw new Error(
      `Blocked by allowlist: ${url}. Allowed domains: ${allowlist.join(", ")}`,
    );
  }
}
