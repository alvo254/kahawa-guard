import { useState } from "react";
import { confirmAction } from "../lib/api";
import type { PendingSummary } from "../lib/api";

export default function PendingActions({
  pending,
  onConfirmed,
}: {
  pending: PendingSummary[];
  onConfirmed: (actionId: string) => void;
}) {
  const [pins, setPins] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function confirm(actionId: string, requires: string[]) {
    setBusy(actionId);
    setResult(null);
    try {
      const needsMember = requires.some((r) => r.includes("pin"));
      const needsOfficer = requires.includes("officer_approval");
      const resp = await confirmAction(actionId, {
        memberPin: needsMember ? pins[actionId] || "0000" : undefined,
        officerToken: needsOfficer ? "demo-officer-token" : undefined,
      });
      setResult(`${actionId.slice(0, 8)}: ${resp.status}`);
      if (resp.status === "released") onConfirmed(actionId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pending-actions">
      <h3>Pending actions</h3>
      {pending.length === 0 && <div className="panel-loading">Nothing parked.</div>}
      {pending.map((p) => (
        <div key={p.action_id ?? p.tool} className="pending-row">
          <div className="pending-tool">{p.tool}</div>
          <div className="pending-args">{JSON.stringify(p.args)}</div>
          <div className="pending-requires">needs: {p.requires.join(", ")}</div>
          {p.requires.some((r) => r.includes("pin")) && (
            <input
              className="pin-input"
              placeholder="4-digit PIN"
              maxLength={4}
              value={pins[p.action_id ?? ""] || ""}
              onChange={(e) =>
                setPins((prev) => ({ ...prev, [p.action_id ?? ""]: e.target.value }))
              }
            />
          )}
          <button
            disabled={!p.action_id || busy === p.action_id}
            onClick={() => p.action_id && confirm(p.action_id, p.requires)}
          >
            Confirm
          </button>
        </div>
      ))}
      {result && <div className="pending-result">{result}</div>}
    </div>
  );
}
