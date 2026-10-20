// SSE verdict stream with explicit connection state and automatic reconnect.
// EventSource reconnects on its own, but we surface the status so the console
// can show "live / reconnecting / disconnected" honestly (ui/NOTES.md §7).
//
// Ops-only: imported by the console and presenter, never by the member surface.

import { useEffect, useRef, useState } from "react";
import type { Verdict } from "./types";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "error";

export function useVerdictStream(max = 400) {
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const seen = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events");
      es.onopen = () => setStatus("live");
      es.onmessage = (ev) => {
        try {
          const v = JSON.parse(ev.data) as Verdict;
          seen.current += 1;
          setLastAt(Date.now());
          setVerdicts((prev) => {
            const next = prev.length >= max ? prev.slice(prev.length - max + 1) : prev;
            return [...next, v];
          });
        } catch {
          // keepalive comments / malformed frames are ignored
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; reflect that rather than going silent.
        setStatus(es && es.readyState === EventSource.CLOSED ? "reconnecting" : "reconnecting");
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [max]);

  const clear = () => setVerdicts([]);
  return { verdicts, status, lastAt, total: seen.current, clear };
}
