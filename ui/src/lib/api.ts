// REST calls and the SSE verdict stream. Every call goes through /api, which is
// proxied to the gateway by nginx (or Vite's dev proxy), so this file never
// needs to know the gateway's in-cluster address.

export interface Verdict {
  layer: string;
  decision: string;
  detail: string;
  score: number | null;
  pack: string;
  profile: string;
  phone_hash: string;
  extra: Record<string, unknown>;
  at: number;
}

export interface ChatResponse {
  reply: string;
  verdicts: Verdict[];
  pending: PendingSummary[];
  blocked_by: string | null;
}

export interface PendingSummary {
  action_id: string | null;
  tool: string;
  requires: string[];
  args: Record<string, unknown>;
}

export interface PendingAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  phone_hash: string;
  member_confirmed: boolean;
  officer_approved: boolean;
  created_at: string;
  expires_at: string;
}

export interface AdminState {
  profile: string;
  pack: string;
  packs: string[];
  switches: Record<string, boolean>;
  provider: string;
  shieldstral_mode: string;
  embed_dim: number;
  admin_token_required: boolean;
  servers: {
    name: string;
    url: string;
    tools: string[];
    pinned_ok: boolean;
    expected_pin: string;
    actual_pin: string;
    error: string;
  }[];
}

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

export function sendChat(phone: string, message: string): Promise<ChatResponse> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  }).then(asJson<ChatResponse>);
}

export function fetchAdminState(): Promise<AdminState> {
  return fetch("/api/admin/state").then(asJson<AdminState>);
}

export function fetchPending(): Promise<{ pending: PendingAction[] }> {
  return fetch("/api/pending").then(asJson<{ pending: PendingAction[] }>);
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

export function setLayers(
  layers: Record<string, boolean>,
  adminToken?: string,
): Promise<{ switches: Record<string, boolean> }> {
  return fetch("/api/admin/layers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
    },
    body: JSON.stringify({ layers }),
  }).then(asJson<{ switches: Record<string, boolean> }>);
}

export function setPack(
  pack: string,
  adminToken?: string,
): Promise<{ pack: string; label: string }> {
  return fetch("/api/admin/pack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
    },
    body: JSON.stringify({ pack }),
  }).then(asJson<{ pack: string; label: string }>);
}

export function resetSession(adminToken?: string): Promise<{ status: string }> {
  return fetch("/api/admin/reset", {
    method: "POST",
    headers: adminToken ? { "X-Admin-Token": adminToken } : {},
  }).then(asJson<{ status: string }>);
}

/** Subscribes to the verdict stream. Returns an unsubscribe function. */
export function subscribeVerdicts(onVerdict: (v: Verdict) => void): () => void {
  const es = new EventSource("/api/events");
  es.onmessage = (ev) => {
    try {
      onVerdict(JSON.parse(ev.data) as Verdict);
    } catch {
      // keepalive comments and malformed frames are silently ignored
    }
  };
  return () => es.close();
}
