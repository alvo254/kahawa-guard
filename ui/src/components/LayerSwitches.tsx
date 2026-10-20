import { useState } from "react";
import { setLayers, setPack } from "../lib/api";
import type { AdminState } from "../lib/api";

const LAYER_LABELS: Record<string, string> = {
  input_guard: "L1 — Mistral input guard",
  expert_guard: "L2 — Shieldstral expert check",
  provenance: "Retrieval provenance",
  registry: "L3 — Dealer/product registry",
  tool_gate: "L4 — Tool gate & budgets",
  budgets: "Token & message budgets",
};

export default function LayerSwitches({
  state,
  adminToken,
  onChanged,
}: {
  state: AdminState | null;
  adminToken: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(layer: string, value: boolean) {
    setBusy(layer);
    try {
      await setLayers({ [layer]: value }, adminToken);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function switchPack(pack: string) {
    setBusy("__pack__");
    try {
      await setPack(pack, adminToken);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (!state) return <div className="panel-loading">Loading admin state…</div>;

  return (
    <div className="layer-switches">
      <div className="profile-row">
        <span className={`profile-badge profile-${state.profile}`}>{state.profile}</span>
        <span className="provider-badge">{state.provider}</span>
        {state.shieldstral_mode === "cached" && (
          <span className="cached-badge" title="Shieldstral scores are replayed, not live">
            cached scores
          </span>
        )}
      </div>

      <div className="pack-row">
        <label>Pack</label>
        <select
          value={state.pack}
          disabled={busy === "__pack__"}
          onChange={(e) => switchPack(e.target.value)}
        >
          {state.packs.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {Object.entries(LAYER_LABELS).map(([key, label]) => (
        <label key={key} className="layer-row">
          <input
            type="checkbox"
            checked={!!state.switches[key]}
            disabled={busy === key}
            onChange={(e) => toggle(key, e.target.checked)}
          />
          {label}
        </label>
      ))}

      <div className="mcp-pins">
        {state.servers.map((s) => (
          <div key={s.name} className={`pin-row ${s.pinned_ok ? "pin-ok" : "pin-bad"}`}>
            <span>{s.name}</span>
            <span>
              {s.error
                ? "unreachable"
                : s.pinned_ok
                  ? "pin ok"
                  : s.expected_pin
                    ? "PIN MISMATCH"
                    : "NOT PINNED"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
