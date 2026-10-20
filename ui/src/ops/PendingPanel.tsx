// Parked actions awaiting confirmation (e.g. a payout change caught by the tool
// gate). Real data from /api/pending; confirmation posts to /api/confirm. This
// is the operator side of the two-party control that stops Scene 3.

import { useCallback, useEffect, useState } from "react";
import { fetchPending, confirmAction } from "../lib/ops";
import type { PendingAction } from "../lib/types";
import { Badge, Button, Card, CardHeader, EmptyState, cx } from "../ui/primitives";
import { sessionLabel } from "../lib/format";

export function PendingPanel({ pokeAt }: { pokeAt: number }) {
  const [rows, setRows] = useState<PendingAction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetchPending()
      .then((r) => setRows(r.pending))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load, pokeAt]);

  const act = async (id: string, opts: { memberPin?: string; officerToken?: string }, key: string) => {
    setBusy(`${id}:${key}`);
    try {
      const r = await confirmAction(id, opts);
      setNote((n) => ({
        ...n,
        [id]:
          r.status === "released"
            ? "released ✓"
            : r.still_needed?.length
              ? `still needs: ${r.still_needed.join(", ")}`
              : r.status,
      }));
      load();
    } catch (e) {
      setNote((n) => ({ ...n, [id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Parked actions" sub="Two-party approval before anything moves" right={<Badge tone={rows.length ? "park" : "info"}>{rows.length}</Badge>} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing parked" hint="Actions the tool gate holds for confirmation show up here." />
      ) : (
        <div className="divide-y divide-line">
          {rows.map((p) => (
            <div key={p.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium text-ink">{p.tool}</span>
                <span className="font-mono text-xs text-slate">#{sessionLabel(p.phone_hash)}</span>
              </div>
              <pre className="scroll-slim mt-2 overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink">
                {JSON.stringify(p.args, null, 0)}
              </pre>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={cx(p.member_confirmed ? "text-leaf" : "text-muted")}>
                  {p.member_confirmed ? "● member PIN" : "○ member PIN"}
                </span>
                <span className={cx(p.officer_approved ? "text-leaf" : "text-muted")}>
                  {p.officer_approved ? "● officer" : "○ officer"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `${p.id}:pin`}
                  onClick={() => act(p.id, { memberPin: "1234" }, "pin")}
                >
                  Confirm member PIN
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `${p.id}:officer`}
                  onClick={() => act(p.id, { officerToken: "officer-ok" }, "officer")}
                >
                  Officer approve
                </Button>
                {note[p.id] && <span className="self-center text-xs text-muted">{note[p.id]}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
