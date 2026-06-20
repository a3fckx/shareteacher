// POST /api/session/[id]/takeover — hand the shared browser to a human and
// return the live-view takeover URL.

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
    const url = await getOrchestrator().takeover(id);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 });
  }
}
