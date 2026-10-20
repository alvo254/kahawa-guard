// Spend panel. There is no aggregate budget endpoint (ui/NOTES.md §6.4); live
// numbers arrive only in the `identify` verdict's extra, per session. So this
// shows the most recent session's usage against its caps, labelled as such —
// honest, not a cooperative-wide total.

import { useMemo } from "react";
import type { Verdict } from "../lib/types";
import { pct, sessionLabel } from "../lib/format";
import { Card, CardHeader, EmptyState, Meter } from "../ui/primitives";

interface Budget {
  tokens_used: number;
  budget: number;
  messages: number;
  message_cap: number;
  session: string;
}

function latestBudget(verdicts: Verdict[]): Budget | null {
  for (let i = verdicts.length - 1; i >= 0; i--) {
    const v = verdicts[i];
    if (v.layer !== "identify") continue;
    const e = v.extra || {};
    if ("budget" in e && "tokens_used" in e) {
      return {
        tokens_used: Number(e.tokens_used ?? 0),
        budget: Number(e.budget ?? 0),
        messages: Number(e.messages ?? 0),
        message_cap: Number(e.message_cap ?? 0),
        session: v.phone_hash,
      };
    }
  }
  return null;
}

export function SpendPanel({ verdicts }: { verdicts: Verdict[] }) {
  const b = useMemo(() => latestBudget(verdicts), [verdicts]);

  return (
    <Card>
      <CardHeader
        title="Spend"
        sub={b ? `Session #${sessionLabel(b.session)}` : "Per session"}
      />
      <div className="space-y-5 p-5">
        {!b ? (
          <EmptyState title="No session yet" hint="Budget figures appear once a member sends a message." />
        ) : (
          <>
            <Meter
              label="Tokens today"
              caption={`${b.tokens_used.toLocaleString()} / ${b.budget.toLocaleString()}`}
              value={pct(b.tokens_used, b.budget)}
              tone="allow"
            />
            <Meter
              label="Messages this hour"
              caption={`${b.messages} / ${b.message_cap}`}
              value={pct(b.messages, b.message_cap)}
              tone="allow"
            />
            <p className="text-xs text-muted">
              Per-session, from the live stream — the gateway exposes no cooperative-wide total.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
