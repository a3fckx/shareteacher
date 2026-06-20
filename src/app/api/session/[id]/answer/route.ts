// POST /api/session/[id]/answer — supply a human answer to a live checkpoint.
//
// Body: { response: string }

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
  const body = (await req.json().catch(() => ({}))) as { response?: unknown };
  const response = typeof body.response === "string" ? body.response : "";
  if (!response.trim()) {
    return NextResponse.json({ error: "response is required" }, { status: 400 });
  }
  try {
    await getOrchestrator().answer(id, response);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}
