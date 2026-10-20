// Live controls. The six layer toggles and the pack switch call the gateway for
// real (POST /api/admin/layers, /api/admin/pack). Profile / provider /
// Shieldstral mode are deploy-time and shown read-only (ui/NOTES.md §6.3).

import { useState } from "react";
import { setLayers, setPack, resetSession } from "../lib/ops";
import type { AdminState } from "../lib/types";
import { LAYER_KEYS, LAYER_LABELS } from "../lib/types";
import { Button, Card, CardHeader, Toggle } from "../ui/primitives";

export function Controls({ state, onChanged }: { state: AdminState | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!state) {
    return (
      <Card>
        <CardHeader title="Controls" />
        <div className="p-5 text-sm text-muted">Loading state…</div>
      </Card>
    );
  }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Controls" sub="Changes take effect on the gateway immediately" />
      <div className="space-y-5 p-5">
        {/* pack */}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">Active pack</span>
          <select
            value={state.pack}
            disabled={busy === "pack"}
            onChange={(e) => run("pack", () => setPack(e.target.value))}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink focus:outline-none"
          >
            {state.packs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {/* layer switches */}
        <div className="space-y-1">
          <span className="text-sm font-medium text-ink">Guard layers</span>
          <div className="divide-y divide-line rounded-xl border border-line">
            {LAYER_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between px-3 py-2.5">
                <label htmlFor={`sw-${key}`} className="text-sm text-ink">
                  {LAYER_LABELS[key]}
                </label>
                <Toggle
                  id={`sw-${key}`}
                  label={LAYER_LABELS[key]}
                  checked={Boolean(state.switches[key])}
                  disabled={busy === key}
                  onChange={(v) => run(key, () => setLayers({ [key]: v }))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={busy === "reset"}
            onClick={() => run("reset", () => resetSession())}
          >
            Reset session state
          </Button>
          {err && <span className="text-xs text-danger">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
