// GET /api/session/[id]/events — Server-Sent-Events stream of StageEvents.
//
// Subscribes to the in-memory SSE hub for this session. Buffered events are
// replayed on connect so a late subscriber catches up to the live tail.

import type { NextRequest } from "next/server";
import { subscribe } from "@/server/sse";
// Touch the orchestrator so the singleton (and its organs) exist before the UI
// starts streaming, even if the events route is hit first.
import { getOrchestrator } from "@/server/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  getOrchestrator();
  const stream = subscribe(id);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
