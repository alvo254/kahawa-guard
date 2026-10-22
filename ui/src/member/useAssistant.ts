// Member-side conversation state. One source of truth for all three channels:
// each renders the SAME real reply from POST /api/chat differently. The member
// only ever sees `reply` (and a confirmation prompt if the gateway parked an
// action). No verdicts, no layer names, no session id. See ui/NOTES.md §6.2.

import { useCallback, useRef, useState } from "react";
import { sendChat } from "../lib/member";

export type Sender = "member" | "assistant" | "system";
export type Delivery = "sending" | "sent" | "delivered" | "failed";

export interface Msg {
  id: string;
  from: Sender;
  text: string;
  at: number;
  delivery?: Delivery;
  /** present when the gateway parked an action the member can confirm */
  pendingActionId?: string | null;
  /** present when this bubble is an attached document */
  doc?: { title: string; role: string; trust: string };
}

let seq = 0;
const mkId = () => `m${Date.now()}-${seq++}`;

export function useAssistant(phone: string) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const inflight = useRef(false);

  const reset = useCallback(() => {
    setMessages([]);
    setRateLimited(false);
  }, []);

  // A system line in the thread — used to show e.g. an uploaded document.
  const note = useCallback((text: string) => {
    setMessages((m) => [...m, { id: mkId(), from: "system", text, at: Date.now() / 1000 }]);
  }, []);

  // An attached-document bubble (outgoing), shown before the triggering question.
  const attach = useCallback((doc: { title: string; role: string; trust: string }) => {
    setMessages((m) => [
      ...m,
      { id: mkId(), from: "member", text: doc.title, at: Date.now() / 1000, delivery: "delivered", doc },
    ]);
  }, []);

  const send = useCallback(
    async (text: string, phoneOverride?: string): Promise<string> => {
      const trimmed = text.trim();
      if (!trimmed || inflight.current) return "";
      inflight.current = true;
      setBusy(true);
      setRateLimited(false);

      const outId = mkId();
      setMessages((m) => [
        ...m,
        { id: outId, from: "member", text: trimmed, at: Date.now() / 1000, delivery: "sending" },
      ]);

      try {
        const resp = await sendChat(phoneOverride ?? phone, trimmed);
        setMessages((m) =>
          m.map((x) => (x.id === outId ? { ...x, delivery: "delivered" as Delivery } : x)),
        );
        const parked = resp.pending.find((p) => p.action_id);
        const reply = resp.reply || "…";
        setMessages((m) => [
          ...m,
          {
            id: mkId(),
            from: "assistant",
            text: reply,
            at: Date.now() / 1000,
            pendingActionId: parked?.action_id ?? null,
          },
        ]);
        return reply;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 429 is the one upstream state worth naming gently to a member.
        const limited = /\b429\b/.test(msg);
        setRateLimited(limited);
        setMessages((m) =>
          m.map((x) => (x.id === outId ? { ...x, delivery: "failed" as Delivery } : x)),
        );
        const fallback = limited
          ? "The service is busy right now. Please try again in a moment."
          : "Sorry, that message could not be delivered. Please try again.";
        setMessages((m) => [...m, { id: mkId(), from: "system", text: fallback, at: Date.now() / 1000 }]);
        return fallback;
      } finally {
        inflight.current = false;
        setBusy(false);
      }
    },
    [phone],
  );

  return { messages, busy, rateLimited, send, reset, note, attach };
}

export type AssistantController = ReturnType<typeof useAssistant>;
