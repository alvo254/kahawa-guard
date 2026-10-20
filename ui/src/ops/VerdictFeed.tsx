// Live verdict feed: one row per layer decision, colour-coded by outcome, with
// session, detail and time. Every row comes straight from /api/events.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Verdict, Tone } from "../lib/types";
import { decisionTone } from "../lib/types";
import { sessionLabel, timeOfDay } from "../lib/format";
import { Badge, Card, CardHeader, EmptyState, StatusDot, cx, toneText } from "../ui/primitives";
import type { StreamStatus } from "../lib/useEventStream";

const LAYER_NAME: Record<string, string> = {
  identify: "Identify",
  budget: "Budget",
  input_guard: "L1 input guard",
  expert_guard_in: "L2 expert (in)",
  expert_guard_out: "L2 expert (out)",
  retrieve: "Retrieval",
  mcp_pin: "MCP pin",
  model: "Model",
  tool_gate: "L4 tool gate",
  registry: "L3 registry",
  registry_retry: "L3 retry",
  upload: "Upload",
  admin: "Admin",
};

const FILTERS: { id: "all" | Tone; label: string }[] = [
  { id: "all", label: "All" },
  { id: "block", label: "Blocked" },
  { id: "park", label: "Parked" },
  { id: "flag", label: "Flagged" },
  { id: "allow", label: "Allowed" },
];

function StatusPill({ status }: { status: StreamStatus }) {
  const tone: Tone = status === "live" ? "allow" : status === "error" ? "block" : "park";
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting" : status === "reconnecting" ? "Reconnecting" : "Error";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <StatusDot tone={tone} pulse={status === "live"} />
      {label}
    </span>
  );
}

export function VerdictFeed({
  verdicts,
  status,
  onClear,
}: {
  verdicts: Verdict[];
  status: StreamStatus;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState<"all" | Tone>("all");
  const [stick, setStick] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => (filter === "all" ? verdicts : verdicts.filter((v) => decisionTone(v.decision) === filter)),
    [verdicts, filter],
  );

  useEffect(() => {
    if (stick) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [rows, stick]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Verdict feed"
        sub="Every guard decision, as it happens"
        right={<StatusPill status={status} />}
      />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cx(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              filter === f.id ? "bg-cherry text-white" : "text-muted hover:bg-surface-2",
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={stick} onChange={(e) => setStick(e.target.checked)} className="accent-cherry" />
            Follow
          </label>
          <button onClick={onClear} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2">
            Clear
          </button>
        </span>
      </div>

      <div
        ref={scrollRef}
        className="scroll-slim min-h-0 flex-1 divide-y divide-line overflow-y-auto"
        onWheel={() => {
          const el = scrollRef.current;
          if (!el) return;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setStick(atBottom);
        }}
      >
        {rows.length === 0 ? (
          <EmptyState
            title={status === "live" ? "Waiting for activity" : "Connecting to the stream"}
            hint="Send a message from the member site or presenter view and the decisions will appear here."
          />
        ) : (
          rows.map((v, i) => {
            const tone = decisionTone(v.decision);
            return (
              <div key={`${v.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5 animate-fade-in">
                <div className="mt-1.5">
                  <StatusDot tone={tone} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{LAYER_NAME[v.layer] ?? v.layer}</span>
                    <span className={cx("text-xs font-semibold uppercase tracking-wide", toneText(tone))}>
                      {v.decision}
                    </span>
                    {typeof v.score === "number" && (
                      <Badge tone={tone}>score {v.score.toFixed(2)}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 break-words text-sm text-muted">{v.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[11px] text-muted">{timeOfDay(v.at)}</p>
                  {v.phone_hash && <p className="font-mono text-[11px] text-slate">#{sessionLabel(v.phone_hash)}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
