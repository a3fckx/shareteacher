// POST /api/session — create a teaching session and kick off the run loop.
//
// Body: { lessonId: string; meetingUrl?: string }
// Returns: { sessionId }  — runSession is fired-and-forgotten so the HTTP
// response returns immediately; the UI then subscribes to /events for the live
// stream.

import { NextResponse, type NextRequest } from "next/server";
import { getOrchestrator } from "@/server/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    lessonId?: unknown;
    meetingUrl?: unknown;
  };
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
  const meetingUrl =
    typeof body.meetingUrl === "string" && body.meetingUrl.trim()
      ? body.meetingUrl.trim()
      : undefined;

  if (!lessonId) {
    return NextResponse.json({ error: "lessonId is required" }, { status: 400 });
  }

  const orch = getOrchestrator();
  try {
    const sessionId = await orch.createSession({ lessonId, meetingUrl });
    // Fire-and-forget: do NOT await the teaching loop.
    void orch.runSession(sessionId).catch((err) => {
      console.error("[api/session] runSession failed:", errMsg(err));
    });
    return NextResponse.json({ sessionId });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 400 });
  }
}
