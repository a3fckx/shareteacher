// ─────────────────────────────────────────────────────────────────────────
// qa/verify-realtime.ts — live realtime verification (no ChatGPT login, no mic).
//
// Replaces the old mock smoke test. It exercises the two live, credential-only
// paths that DON'T need a human in the loop:
//
//   (a) Kernel — create a REAL cloud browser via the Kernel runtime adapter and
//       print its CDP websocket url + embeddable live-view url, then tear it
//       down (DELETE persists the profile).
//   (b) Runway — start a REAL realtime session for the configured avatar
//       (create -> poll READY -> consume) and report whether LiveKit creds
//       (serverUrl / token / roomName) came back, then delete the session.
//
// Neither check needs a ChatGPT login or a microphone. Run with the real env
// loaded into the process first:
//
//   set -a && . ./.env.local && set +a && pnpm verify
//   # or: npx tsx qa/verify-realtime.ts
// ─────────────────────────────────────────────────────────────────────────

import { getEnv } from "@/server/env";
import { createBrowserRuntime } from "@/integrations/kernel";
import { createCharacterAgent, decodeJoinToken } from "@/integrations/runway";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── (a) Kernel browser ───────────────────────────────────────────────────────

async function verifyKernel(): Promise<boolean> {
  const env = getEnv();
  console.log("\n[verify] (a) Kernel browser (cdp + live view)");
  if (!env.kernel.apiKey) {
    console.error("  FAIL — KERNEL_API_KEY is not set");
    return false;
  }

  const runtime = createBrowserRuntime(env);
  let sessionId: string | null = null;
  try {
    const info = await runtime.startSession(env.kernel.profileName);
    sessionId = info.sessionId;
    console.log(`  session_id = ${info.sessionId}`);
    console.log(`  cdp        = ${info.cdpUrl}`);
    console.log(`  liveView   = ${info.liveViewUrl}`);
    console.log(`  profile    = ${info.profileId}`);
    const ok = Boolean(info.cdpUrl && info.liveViewUrl);
    console.log(
      `  ${ok ? "OK" : "FAIL"} — Kernel ${
        ok ? "returned cdp + live view" : "missing cdp/liveView"
      }`,
    );
    return ok;
  } catch (err) {
    const m = errMsg(err);
    console.error(`  FAIL — ${m}`);
    if (/insufficient_plan|paid plan|Profiles require/i.test(m)) {
      console.error(
        "  note: a NAMED PERSISTENT profile (KERNEL_PROFILE_NAME) requires a " +
          "Kernel paid plan (Hobbyist+). Profileless browsers work on the free plan.",
      );
    }
    return false;
  } finally {
    // DELETE frees the browser and persists a save_changes profile back.
    if (sessionId) await runtime.stopSession(sessionId).catch(() => {});
  }
}

// ── (b) Runway realtime session ──────────────────────────────────────────────

async function verifyRunway(): Promise<boolean> {
  const env = getEnv();
  console.log("\n[verify] (b) Runway realtime session (LiveKit creds)");
  if (!env.runway.apiKey) {
    console.error("  FAIL — RUNWAY_API_KEY is not set");
    return false;
  }
  if (!env.runway.characterId) {
    console.error("  FAIL — RUNWAY_CHARACTER_ID is not set");
    return false;
  }

  const character = createCharacterAgent(env);
  const sessionId = `verify-${Date.now()}`;
  try {
    // start() runs the full create -> poll READY -> consume chain and packs the
    // returned LiveKit creds into joinToken (encoded RunwayJoinCredentials).
    const session = await character.start({
      sessionId,
      characterId: env.runway.characterId,
      voiceId: env.runway.voiceId,
      personaPrompt: "You are ShareTeacher Guide, a warm patient teacher.",
      knowledgeBase: "",
      tools: [],
    });
    const creds = decodeJoinToken(session.joinToken);
    if (!creds) {
      console.error(
        "  FAIL — realtime session started but no LiveKit creds were decoded",
      );
      return false;
    }
    console.log(`  realtime id = ${session.id}`);
    console.log(`  serverUrl   = ${creds.url}`);
    console.log(`  roomName    = ${creds.roomName}`);
    console.log(
      `  token       = ${creds.token.slice(0, 16)}… (${creds.token.length} chars)`,
    );
    const ok = Boolean(creds.url && creds.token && creds.roomName);
    console.log(
      `  ${ok ? "OK" : "FAIL"} — LiveKit creds ${ok ? "returned" : "incomplete"}`,
    );
    return ok;
  } catch (err) {
    console.error(`  FAIL — ${errMsg(err)}`);
    return false;
  } finally {
    // DELETE /v1/realtime_sessions/{id} — clean up the session we created.
    await character.stop(sessionId).catch(() => {});
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    "ShareTeacher — realtime verification (no ChatGPT login, no mic required)",
  );

  // Run sequentially so the two services' logs don't interleave.
  const kernelOk = await verifyKernel();
  const runwayOk = await verifyRunway();

  console.log("\n[verify] results:");
  console.log(`  Kernel browser   = ${kernelOk ? "OK" : "FAIL"}`);
  console.log(`  Runway realtime  = ${runwayOk ? "OK" : "FAIL"}`);

  if (kernelOk && runwayOk) {
    console.log("PASS");
    process.exit(0);
  }
  console.error("FAIL");
  process.exit(1);
}

main().catch((err) => {
  console.error("FAIL — verify threw:", errMsg(err));
  process.exit(1);
});
