// System health. MCP servers come from /api/admin/state (reachability + the pin
// truth table, NOT PINNED shown honestly). Model reachability is derived from
// the most recent `model` verdict — there is no standalone probe (NOTES §6.5).

import { useMemo, useState } from "react";
import { refreshMcp } from "../lib/ops";
import type { AdminState, McpServer, Tone, Verdict } from "../lib/types";
import { Badge, Button, Card, CardHeader, StatusDot, cx } from "../ui/primitives";

function pinState(s: McpServer): { tone: Tone; label: string } {
  if (s.error) return { tone: "block", label: "unreachable" };
  if (s.pinned_ok) return { tone: "allow", label: "pin ok" };
  if (s.expected_pin) return { tone: "block", label: "PIN MISMATCH" };
  return { tone: "park", label: "NOT PINNED" };
}

function modelHealth(verdicts: Verdict[]): { tone: Tone; label: string; detail: string } {
  for (let i = verdicts.length - 1; i >= 0; i--) {
    const v = verdicts[i];
    if (v.layer !== "model") continue;
    if (v.decision === "refuse") {
      const limited = /\b429\b/.test(v.detail) || /rate.?limit/i.test(v.detail);
      return limited
        ? { tone: "park", label: "rate limited", detail: v.detail }
        : { tone: "block", label: "unreachable", detail: v.detail };
    }
    return { tone: "allow", label: "responding", detail: v.detail };
  }
  return { tone: "info", label: "idle", detail: "No model call yet this session." };
}

export function HealthPanel({ state, verdicts }: { state: AdminState | null; verdicts: Verdict[] }) {
  const [busy, setBusy] = useState(false);
  const model = useMemo(() => modelHealth(verdicts), [verdicts]);

  return (
    <Card>
      <CardHeader
        title="System health"
        right={
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await refreshMcp();
              } catch {
                /* surfaced via state refresh */
              } finally {
                setBusy(false);
              }
            }}
          >
            Re-check
          </Button>
        }
      />
      <div className="divide-y divide-line">
        {/* model */}
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <StatusDot tone={model.tone} pulse={model.tone === "allow"} />
            <span className="text-sm font-medium text-ink">Model</span>
            <span className="text-xs text-muted">{state?.provider ?? "—"}</span>
          </div>
          <Badge tone={model.tone}>{model.label}</Badge>
        </div>

        {/* MCP servers */}
        {(state?.servers ?? []).map((s) => {
          const ps = pinState(s);
          return (
            <div key={s.name} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone={s.error ? "block" : "allow"} />
                  <span className="text-sm font-medium text-ink">{s.name}</span>
                  <span className="text-xs text-muted">{s.tools.length} tools</span>
                </div>
                <Badge tone={ps.tone}>{ps.label}</Badge>
              </div>
              {s.error && <p className={cx("mt-1 pl-5 text-xs text-danger")}>{s.error}</p>}
            </div>
          );
        })}

        {!state && <div className="px-5 py-4 text-sm text-muted">Loading…</div>}
      </div>
    </Card>
  );
}
