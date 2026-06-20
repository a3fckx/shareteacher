// POST /api/session/[id]/stop — stop the loop and tear the session down.

import { NextResponse, type NextRequest } from "next/server";
import { getOrchestrator } from "@/server/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await getOrchestrator().stop(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}
