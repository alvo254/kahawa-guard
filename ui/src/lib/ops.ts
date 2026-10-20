// OPERATOR CONSOLE API — telemetry and controls. Imported ONLY by the ops and
// presenter route trees, which are lazy-loaded, so this code lands in a separate
// chunk that the member surface never requests. Treat everything here as
// sensitive (ui/NOTES.md §6.1).

import type { AdminState, PendingAction } from "./types";

// Set at build time for the hardened profile; empty in naked (admin is open).
const ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) ?? "";

function adminHeaders(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(ADMIN_TOKEN ? { "X-Admin-Token": ADMIN_TOKEN } : {}),
  };
}

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

export function fetchAdminState(): Promise<AdminState> {
  return fetch("/api/admin/state").then(asJson<AdminState>);
}

export function fetchPending(): Promise<{ pending: PendingAction[] }> {
  return fetch("/api/pending").then(asJson<{ pending: PendingAction[] }>);
}

export function setLayers(
  layers: Record<string, boolean>,
): Promise<{ switches: Record<string, boolean> }> {
  return fetch("/api/admin/layers", {
    method: "POST",
    headers: adminHeaders(true),
    body: JSON.stringify({ layers }),
  }).then(asJson<{ switches: Record<string, boolean> }>);
}

export function setPack(pack: string): Promise<{ pack: string; label: string }> {
  return fetch("/api/admin/pack", {
    method: "POST",
    headers: adminHeaders(true),
    body: JSON.stringify({ pack }),
  }).then(asJson<{ pack: string; label: string }>);
}

export function resetSession(): Promise<{ status: string }> {
  return fetch("/api/admin/reset", { method: "POST", headers: adminHeaders() }).then(asJson<{ status: string }>);
}

export function refreshMcp(): Promise<unknown> {
  return fetch("/api/admin/mcp-refresh", { method: "POST", headers: adminHeaders() }).then(asJson);
}

export function confirmAction(
  actionId: string,
  opts: { memberPin?: string; officerToken?: string },
): Promise<{ status: string; tool?: string; still_needed?: string[] }> {
  return fetch("/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action_id: actionId,
      member_pin: opts.memberPin || null,
      officer_token: opts.officerToken || null,
    }),
  }).then(asJson<{ status: string; tool?: string; still_needed?: string[] }>);
}
