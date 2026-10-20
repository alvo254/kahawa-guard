// MEMBER SURFACE API — the only gateway call a member ever makes.
//
// This module deliberately exposes nothing but chat and confirmation. The
// member bundle must never import ./ops, so there is no path from the public
// surface to the verdict stream, admin state, or audit log — not even in the
// shipped JavaScript. See ui/NOTES.md §6.1 / §7.

import type { ChatResponse } from "./types";

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

/** Send one message as a member. The caller uses only `reply` and `pending`. */
export function sendChat(phone: string, message: string): Promise<ChatResponse> {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  }).then(asJson<ChatResponse>);
}

/** A parked action (e.g. a payout change) can be confirmed with a member PIN. */
export function confirmAction(
  actionId: string,
  memberPin: string,
): Promise<{ status: string; tool?: string; still_needed?: string[] }> {
  return fetch("/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action_id: actionId, member_pin: memberPin }),
  }).then(asJson<{ status: string; tool?: string; still_needed?: string[] }>);
}
