// Operator sign-in gate. IMPORTANT: in the naked profile the gateway's
// telemetry endpoints are unauthenticated (ui/NOTES.md §6.1), so this gate is a
// UI boundary, not a security one. We say so plainly rather than imply safety
// we do not have. In the hardened profile the operator token is required by the
// gateway for mutating actions, and it is carried from VITE_ADMIN_TOKEN.

import { useState } from "react";
import type { ReactNode } from "react";
import { Logo } from "../ui/Logo";
import { Button, Card } from "../ui/primitives";

const KEY = "kahawa-ops-authed";
const hardened = Boolean((import.meta.env.VITE_ADMIN_TOKEN as string | undefined) ?? "");

function isAuthed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function OpsGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(isAuthed);
  const [pass, setPass] = useState("");

  if (authed) return <>{children}</>;

  const enter = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setAuthed(true);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-4">
      <Card raised className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">Operators</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Oversight console</h1>
        <p className="mt-2 text-sm text-muted">
          Sign in to view guard telemetry and controls for the cooperative assistant.
        </p>

        <form onSubmit={enter} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Operator passphrase</span>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoFocus
              placeholder="Enter to continue"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink focus:outline-none"
            />
          </label>
          <Button type="submit" className="w-full">
            Enter console
          </Button>
        </form>

        {!hardened && (
          <p className="mt-5 rounded-xl bg-amber/10 px-3 py-2 text-xs leading-relaxed text-amber ring-1 ring-inset ring-amber/25">
            Demo cluster (naked profile): the gateway's telemetry endpoints are open, so this sign-in
            gates the interface only — it is not yet a security boundary. See NOTES §6.1 for the
            backend change that would make it one.
          </p>
        )}
      </Card>
    </div>
  );
}
