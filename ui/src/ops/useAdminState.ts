// Fetches /api/admin/state and keeps it fresh: a slow poll, plus an immediate
// refetch whenever a verdict implies the state changed (mcp_pin re-checks pins;
// admin verdicts follow a layer/pack change). Ops-only.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAdminState } from "../lib/ops";
import type { AdminState, Verdict } from "../lib/types";

export function useAdminState(latestVerdict: Verdict | null) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastLayer = useRef<string>("");

  const refresh = useCallback(() => {
    fetchAdminState()
      .then((s) => {
        setState(s);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!latestVerdict) return;
    if (latestVerdict.layer === "mcp_pin" || latestVerdict.layer === "admin") {
      // avoid hammering on bursts of the same layer
      if (lastLayer.current !== `${latestVerdict.layer}:${latestVerdict.at}`) {
        lastLayer.current = `${latestVerdict.layer}:${latestVerdict.at}`;
        refresh();
      }
    }
  }, [latestVerdict, refresh]);

  return { state, error, refresh };
}
