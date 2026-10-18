import LayerSwitches from "./LayerSwitches";
import VerdictFeed from "./VerdictFeed";
import SpendMeter from "./SpendMeter";
import PendingActions from "./PendingActions";
import type { AdminState, PendingSummary, Verdict } from "../lib/api";

export default function AdminPanel({
  state,
  verdicts,
  pending,
  adminToken,
  onStateChanged,
  onPendingChanged,
}: {
  state: AdminState | null;
  verdicts: Verdict[];
  pending: PendingSummary[];
  adminToken: string;
  onStateChanged: () => void;
  onPendingChanged: (actionId: string) => void;
}) {
  return (
    <div className="admin-panel">
      <LayerSwitches state={state} adminToken={adminToken} onChanged={onStateChanged} />
      <SpendMeter verdicts={verdicts} />
      <PendingActions pending={pending} onConfirmed={onPendingChanged} />
      <VerdictFeed verdicts={verdicts} />
    </div>
  );
}
