// POST /api/session/[id]/avatar — connect the live Runway GWM-1 avatar for a
// teaching session and hand the browser the LiveKit credentials it needs.
//
// Runs the verified server-side realtime chain (real-only, no mock):
//   1. POST /v1/realtime_sessions             (create — avatar + persona)
//   2. GET  /v1/realtime_sessions/{id}         (poll until READY -> sessionKey)
//   3. POST /v1/realtime_sessions/{id}/consume (sessionKey -> LiveKit creds)
//
// The response is reshaped into the SDK's SessionCredentials contract
// (`@runwayml/avatars-react`): `url` -> `serverUrl`, plus the Runway realtime
// session id as `sessionId`. The client's <AvatarSession> consumes it directly.
//
// Credentials are cached per ShareTeacher sessionId (with an in-flight promise
// so concurrent/StrictMode double calls reuse one Runway session and never burn
// extra credits). DELETE tears the Runway session down and clears the cache.
//
// Server-only: reads RUNWAY_API_KEY from env and never exposes it to the client.

import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/server/env";
import { RunwayHttp } from "@/integrations/runway/http";
import { RUNWAY_TOOLS } from "@/lib/avatar-tools";
import { createLessonEngine } from "@/lessons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches the SDK's SessionCredentials (sessionId/serverUrl/token/roomName). */
interface AvatarCredentials {
  sessionId: string;
  serverUrl: string;
  token: string;
  roomName: string;
}

interface CacheEntry {
  at: number;
  promise: Promise<AvatarCredentials>;
}

// Survive Next dev hot-reload by stashing the cache on globalThis.
const CACHE_KEY = "__shareteacher_avatar_connect__";
type GlobalWithCache = typeof globalThis & {
  [CACHE_KEY]?: Map<string, CacheEntry>;
};
const g = globalThis as GlobalWithCache;
const cache: Map<string, CacheEntry> = g[CACHE_KEY] ?? new Map();
g[CACHE_KEY] = cache;

/** LiveKit tokens are long-lived; recycle a cached session for up to 25 min. */
const CACHE_TTL_MS = 25 * 60 * 1000;

const DEFAULT_PERSONA = [
  "You are ShareTeacher, a warm, focused AI teacher running a live class.",
  "You teach ONE workflow at a time by narrating and guiding a real shared browser.",
  "Stay on the current lesson step, answer questions briefly, and never give generic",
  "chatbot advice or jump ahead — keep the learner moving through the workflow.",
  "Speak in short, encouraging sentences and tie each action back to a reusable principle.",
].join(" ");

// Tells the live agent which tools it has and which on-screen targets the page
// actions can address. Kept in sync with src/lib/avatar-tools.ts.
const TOOLS_GUIDE = [
  "You have VISUAL tools to make teaching vivid — use them naturally and often while you teach, never as a script.",
  "Stage tools (whole panels, addressed by id): share_screen(focus) — focus='foreground' brings the live teaching browser full-screen for the class, focus='restore' returns to the normal layout;",
  "take_control(mode) — call take_control(mode:'full') to take the class FULLY into the live browser (edge-to-edge exact view, your floating avatar stays on top) when you want to demonstrate hands-on; call take_control(mode:'exit') to return to the normal screen.",
  "highlight(target[,duration]) draws attention to a panel; scroll_to(target) scrolls a panel into view; click(target) clicks an element.",
  "Valid panel targets: teaching-browser, lesson-steps, prompt, output, transcript.",
  "Live-browser tools (point INSIDE the browser): there are NO element ids inside the live browser, so estimate positions as x/y/w/h fractions from 0..1 of what you SEE on the browser screen.",
  "zoom(x,y,w,h[,scale,duration]) magnifies a region so the class can read fine detail — use it whenever you show a button, field, menu, or result up close; pass reset=true to zoom back out.",
  "spotlight(x,y,w,h[,label]) dims everything except one region to force the class's eyes to one spot.",
  "arrow(x,y[,from,label]) flies an arrow to a point — use it for 'click this' or 'notice this'.",
  "circle(x,y,w,h[,shape,color,label]) rings a field or result; color can be accent/good/warn/bad.",
  "caption(text[,position]) shows a large lower-third for a key term, takeaway, or the exact text to type.",
  "clear_overlay() removes every overlay and zoom at once — call it when you move on.",
  "Rhythm: zoom or spotlight the area you are talking about, point with an arrow or circle, drop a caption for the key word, then clear_overlay before the next idea. Keep overlays brief; they also auto-clear.",
].join(" ");

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolve the avatar persona + opening line from the lesson (best-effort). */
function resolvePersona(lessonId?: string): {
  personality: string;
  startScript: string;
} {
  // Realtime LIVE agent: a genuine two-way conversational teacher, NOT a scripted
  // recital. It greets on connect and teaches interactively, reacting in real time.
  const LIVE = [
    "You are LIVE on a real-time video call — be present, warm, and responsive.",
    "Greet the room the moment you connect, then teach interactively: react to what",
    "is on the shared screen, think out loud, and answer questions the instant they",
    "come up. Keep your turns short and natural so people can jump in any time.",
  ].join(" ");

  if (lessonId) {
    try {
      const lesson = createLessonEngine().get(lessonId);
      if (lesson) {
        return {
          personality: `${lesson.personaPrompt || DEFAULT_PERSONA} ${LIVE}`,
          startScript:
            `You're live now. Greet the room and tell them you'll work through "${lesson.title}" ` +
            "together, then start teaching it and invite them to interrupt with questions any time.",
        };
      }
    } catch {
      // Pure lesson engine should never throw, but degrade to the default.
    }
  }
  return {
    personality: `${DEFAULT_PERSONA} ${LIVE}`,
    startScript:
      "You're live now. Greet the room, say you'll walk them through today's AI workflow " +
      "together, and invite them to interrupt with questions any time.",
  };
}

async function connectAvatar(
  lessonId: string | undefined,
): Promise<AvatarCredentials> {
  const env = getEnv();
  const avatarId = env.runway.characterId;
  if (!avatarId) {
    throw new Error("RUNWAY_CHARACTER_ID is not configured");
  }
  const http = new RunwayHttp(env);
  const { personality, startScript } = resolvePersona(lessonId);

  const created = await http.createRealtimeSession({
    avatarId,
    personality: `${personality} ${TOOLS_GUIDE}`,
    startScript,
    tools: RUNWAY_TOOLS,
  });
  const { sessionKey } = await http.pollUntilReady(created.id);
  const creds = await http.consume(created.id, sessionKey);

  return {
    sessionId: created.id, // Runway realtime session id == LiveKit context.
    serverUrl: creds.url, // SDK wants `serverUrl`, http.ts returns `url`.
    token: creds.token,
    roomName: creds.roomName,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "session id is required" }, { status: 400 });
  }

  if (!getEnv().runway.apiKey) {
    return NextResponse.json(
      { error: "RUNWAY_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { lessonId?: unknown };
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : undefined;

  // Reuse a live-and-fresh cached connection; otherwise create one and cache the
  // in-flight promise so concurrent calls share a single Runway session.
  const existing = cache.get(id);
  if (existing && Date.now() - existing.at < CACHE_TTL_MS) {
    try {
      return NextResponse.json(await existing.promise);
    } catch {
      cache.delete(id); // resolved-then-failed: fall through to a fresh attempt.
    }
  }

  const promise = connectAvatar(lessonId);
  cache.set(id, { at: Date.now(), promise });
  // Drop the cache entry if creation fails so the next click can retry.
  promise.catch(() => {
    if (cache.get(id)?.promise === promise) cache.delete(id);
  });

  try {
    return NextResponse.json(await promise);
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 502 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entry = cache.get(id);
  cache.delete(id);
  if (entry) {
    try {
      const creds = await entry.promise;
      await new RunwayHttp(getEnv()).stopSession(creds.sessionId);
    } catch {
      // Best-effort teardown; the Runway session also expires on its own.
    }
  }
  return NextResponse.json({ ok: true });
}
