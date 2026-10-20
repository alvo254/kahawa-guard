// In-presenter control strip so the whole demo runs from one screen: see the
// profile, flip all guard layers on/off at once (or the key ones), and reset the
// session between runs — all real gateway calls (lib/ops). This is why you no
// longer have to jump to /ops mid-talk.

import { useMemo, useState } from "react";
import { setLayers, resetSession } from "../lib/ops";
import type { AdminState } from "../lib/types";
import { LAYER_KEYS, LAYER_LABELS } from "../lib/types";
import { Toggle, cx } from "../ui/primitives";

export function PresenterControls({
  state,
  onChanged,
}: {
  state: AdminState | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const onCount = useMemo(
    () => (state ? LAYER_KEYS.filter((k) => state.switches[k]).length : 0),
    [state],
  );
  const allOn = onCount === LAYER_KEYS.length;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const setAll = (on: boolean) =>
    run(() => setLayers(Object.fromEntries(LAYER_KEYS.map((k) => [k, on]))));

  const profile = state?.profile ?? "…";
  const hardened = profile === "hardened";

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        {/* profile */}
        <span
          className={cx(
            "rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
            hardened ? "bg-leaf/15 text-leaf" : "bg-amber/15 text-amber",
          )}
        >
          {profile}
        </span>

        {/* master guards toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">Guards</span>
          <Toggle
            id="pres-guards-all"
            label="All guard layers"
            checked={allOn}
            disabled={busy || !state}
            onChange={(v) => setAll(v)}
          />
          <span className="text-xs tabular-nums text-muted">{onCount}/{LAYER_KEYS.length} on</span>
        </div>

        <span className="hidden text-sm text-muted sm:inline">
          {allOn ? "attacks are stopped" : onCount === 0 ? "attacks will land" : "partial"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
          >
            {open ? "Hide layers" : "Per-layer"}
          </button>
          <button
            onClick={() => run(() => resetSession())}
            disabled={busy}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            Reset session
          </button>
        </div>
      </div>

      {open && state && (
        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {LAYER_KEYS.map((k) => (
            <div key={k} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
              <span className="text-xs text-ink">{LAYER_LABELS[k]}</span>
              <Toggle
                id={`pres-${k}`}
                label={LAYER_LABELS[k]}
                checked={Boolean(state.switches[k])}
                disabled={busy}
                onChange={(v) => run(() => setLayers({ [k]: v }))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
