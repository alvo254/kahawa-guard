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

/** Upload a document into the assistant's knowledge (multipart, open endpoint).
 *  `role` decides trust: coop/board = trusted, dealer/member = untrusted. This is
 *  how a member attaches a file in chat — and how an injected document gets in. */
export function uploadDocument(doc: { role: string; title: string; text: string }): Promise<{
  document_id: number;
  trust: string;
  chunks: number;
}> {
  const form = new FormData();
  form.append("role", doc.role);
  form.append("title", doc.title);
  form.append("text", doc.text);
  return fetch("/api/upload", { method: "POST", body: form }).then(
    asJson<{ document_id: number; trust: string; chunks: number }>,
  );
}

/** Upload a real file chosen from the member's device. The gateway extracts
 *  text from .txt / .md / .pdf, chunks and embeds it. `role` decides trust. */
export function uploadFile(
  file: File,
  role: string,
  title?: string,
): Promise<{ document_id: number; title: string; trust: string; chunks: number }> {
  const form = new FormData();
  form.append("role", role);
  form.append("title", title || file.name);
  form.append("file", file);
  return fetch("/api/upload", { method: "POST", body: form }).then(
    asJson<{ document_id: number; title: string; trust: string; chunks: number }>,
  );
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
