import { useCallback, useEffect, useState } from "react";
import PhoneChat from "./components/PhoneChat";
import AdminPanel from "./components/AdminPanel";
import { fetchAdminState, subscribeVerdicts } from "./lib/api";
import type { AdminState, ChatResponse, PendingSummary, Verdict } from "./lib/api";

const DEFAULT_PHONE = "+254700000001";
const ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) ?? "";

export default function App() {
  const [adminState, setAdminState] = useState<AdminState | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [pending, setPending] = useState<PendingSummary[]>([]);

  const refreshState = useCallback(() => {
    fetchAdminState().then(setAdminState).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshState();
    const unsubscribe = subscribeVerdicts((v) => {
      setVerdicts((prev) => [...prev.slice(-199), v]);
    });
    return unsubscribe;
  }, [refreshState]);

  function handleChatResponse(resp: ChatResponse) {
    setPending(resp.pending);
  }

  function handlePendingChanged(actionId: string) {
    setPending((prev) => prev.filter((p) => p.action_id !== actionId));
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Kahawa Guard</h1>
        <p>A guarded assistant for a Kenyan coffee cooperative — watch what each layer stops.</p>
      </header>
      <main className="app-main">
        <PhoneChat defaultPhone={DEFAULT_PHONE} onResponse={handleChatResponse} />
        <AdminPanel
          state={adminState}
          verdicts={verdicts}
          pending={pending}
          adminToken={ADMIN_TOKEN}
          onStateChanged={refreshState}
          onPendingChanged={handlePendingChanged}
        />
      </main>
    </div>
  );
}
