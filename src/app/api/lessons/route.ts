// GET /api/lessons — the lesson catalog ({ id, title, goal }).

import { NextResponse } from "next/server";
import { getOrchestrator } from "@/server/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const lessons = getOrchestrator().listLessons();
  return NextResponse.json({ lessons });
}
