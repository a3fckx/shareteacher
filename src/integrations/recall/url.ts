// ─────────────────────────────────────────────────────────────────────────
// Recall meeting-URL validation (anti-SSRF).
//
// The bot is told to "join" whatever URL we pass to Recall. We must never let
// that be an arbitrary/internal/IP host. Only known Google Meet / Zoom / Teams
// meeting hostnames over https are allowed; everything else is rejected.
// ─────────────────────────────────────────────────────────────────────────

import type { MeetingPlatform } from "@/types/contracts";

export class MeetingUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingUrlError";
  }
}

/** Allowed apex domains per platform. Subdomains match on a dot boundary. */
const PLATFORM_DOMAINS: Record<MeetingPlatform, readonly string[]> = {
  google_meet: ["meet.google.com"],
  zoom: ["zoom.us", "zoomgov.com"],
  teams: ["teams.microsoft.com", "teams.live.com", "teams.microsoft.us"],
};

/** Exact host or a true subdomain of `domain` (blocks `evil-zoom.us`). */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export interface ValidatedMeetingUrl {
  /** Normalised URL string safe to hand to Recall. */
  url: string;
  platform: MeetingPlatform;
  host: string;
}

/**
 * Validate that `raw` is a real https Google Meet / Zoom / Teams meeting URL.
 *
 * Anti-SSRF: only the known meeting hostnames pass. IP literals, localhost,
 * internal hosts, non-https schemes, custom ports, and embedded credentials
 * are all rejected with a {@link MeetingUrlError}.
 */
export function validateMeetingUrl(raw: string): ValidatedMeetingUrl {
  const input = (raw ?? "").trim();
  if (!input) throw new MeetingUrlError("meetingUrl is empty");

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new MeetingUrlError(`meetingUrl is not a valid URL: ${input}`);
  }

  if (parsed.protocol !== "https:") {
    throw new MeetingUrlError(
      `meetingUrl must be https, got "${parsed.protocol}"`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new MeetingUrlError("meetingUrl must not contain credentials");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new MeetingUrlError(
      `meetingUrl must not use a custom port ("${parsed.port}")`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  for (const platform of Object.keys(PLATFORM_DOMAINS) as MeetingPlatform[]) {
    if (PLATFORM_DOMAINS[platform].some((d) => hostMatches(host, d))) {
      return { url: parsed.toString(), platform, host };
    }
  }

  throw new MeetingUrlError(
    `meetingUrl host "${host}" is not an allowed meeting platform ` +
      "(Google Meet, Zoom, Teams)",
  );
}
