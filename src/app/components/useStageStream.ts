"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { StageEvent } from "@/types/contracts";
import {
  initialClassroomState,
  reduceStage,
  type ClassroomState,
} from "./stage-state";

type Action =
  | { kind: "event"; event: StageEvent }
  | { kind: "clearCheckpoint" };

function stageReducer(state: ClassroomState, action: Action): ClassroomState {
  if (action.kind === "clearCheckpoint") return { ...state, checkpoint: null };
  return reduceStage(state, action.event);
}

export interface StageStream {
  state: ClassroomState;
  connected: boolean;
  speaking: boolean;
  error: string | null;
  clearCheckpoint: () => void;
}

const SPEAKING_HOLD_MS = 2600;

/**
 * Subscribe to the server-sent classroom event stream for a session and fold
 * it into a render-ready ClassroomState. Returns a stable, never-blank model:
 * before the first event arrives every panel shows its own fallback.
 */
export function useStageStream(sessionId: string | null): StageStream {
  const [state, dispatch] = useReducer(stageReducer, initialClassroomState);
  const [connected, setConnected] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("No session id in the URL.");
      return;
    }
    setError(null);

    let closed = false;
    const es = new EventSource(
      `/api/session/${encodeURIComponent(sessionId)}/events`,
    );

    es.onopen = () => {
      if (closed) return;
      setConnected(true);
      setError(null);
    };

    es.onerror = () => {
      if (closed) return;
      setConnected(false);
    };

    es.onmessage = (msg: MessageEvent<string>) => {
      if (closed) return;
      let event: StageEvent;
      try {
        event = JSON.parse(msg.data) as StageEvent;
      } catch {
        return;
      }
      dispatch({ kind: "event", event });

      if (event.type === "transcript" && event.speaker === "teacher") {
        setSpeaking(true);
        if (speakTimer.current) clearTimeout(speakTimer.current);
        speakTimer.current = setTimeout(
          () => setSpeaking(false),
          SPEAKING_HOLD_MS,
        );
      }
    };

    return () => {
      closed = true;
      es.close();
      if (speakTimer.current) clearTimeout(speakTimer.current);
      setConnected(false);
    };
  }, [sessionId]);

  const clearCheckpoint = useCallback(
    () => dispatch({ kind: "clearCheckpoint" }),
    [],
  );

  return { state, connected, speaking, error, clearCheckpoint };
}
