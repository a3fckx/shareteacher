// POST /api/session/[id]/meeting — join a live meeting and stream the teaching
// screen into it via the Recall bot.
//
// Body: { meetingUrl: string }

import { NextResponse, type NextRequest } from "next/server";
import { getOrchestrator } from "@/server/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { meetingUrl?: unknown };
  const meetingUrl =
    typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
  if (!meetingUrl) {
    return NextResponse.json(
      { error: "meetingUrl is required" },
      { status: 400 },
    );
  }
  try {
    const result = await getOrchestrator().joinMeeting(id, meetingUrl);
    return NextResponse.json(result);
  } catch (err) {
    // Bad / disallowed meeting URLs (anti-SSRF validation) are client errors.
    return NextResponse.json({ error: errMsg(err) }, { status: 400 });
  }
}
