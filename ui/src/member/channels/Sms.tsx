// SMS channel — feature-phone members. Keyword-driven, 160-char framing, plain
// monochrome bubbles, no rich styling. Same real reply underneath; a long reply
// is shown with its SMS segment count, the way a real gateway would split it.

import { useEffect, useRef, useState } from "react";
import { useAssistant } from "../useAssistant";
import { clockNow } from "../../lib/format";

const SEG = 160;
const segments = (s: string) => Math.max(1, Math.ceil(s.length / SEG));

const DEFAULT_FRAME =
  "mx-auto flex h-[600px] w-full max-w-[20rem] flex-col overflow-hidden rounded-[1.5rem] border-[6px] border-ink/80 bg-[#1b1d1a] shadow-raised";

export function Sms({ phone, frame }: { phone: string; frame?: string }) {
  const { messages, busy, send } = useAssistant(phone);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const left = SEG - (draft.length % SEG || 0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = draft;
    setDraft("");
    void send(t);
  };

  return (
    <div className={frame ?? DEFAULT_FRAME}>
      {/* feature-phone status bar */}
      <div className="flex items-center justify-between bg-[#11130f] px-3 py-1.5 font-mono text-[11px] text-[#9fd39f]">
        <span>Safari-Tel</span>
        <span>Messages</span>
        <span>{clockNow()}</span>
      </div>

      <div className="scroll-slim flex-1 space-y-2 overflow-y-auto bg-[#c9d6c2] px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-md border border-[#7f8f78] bg-[#e7eee2] px-3 py-2 font-mono text-[12px] text-[#2c3a28]">
            SMS the cooperative on 20880. Try:
            <br />
            PAY KG-0001 · DEALER copper · HELP
          </div>
        )}
        {messages.map((m) => {
          const mine = m.from === "member";
          return (
            <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  mine
                    ? "max-w-[85%] rounded-md border border-[#6f8168] bg-[#dfe8d8] px-2.5 py-1.5 font-mono text-[12.5px] text-[#20301c]"
                    : "max-w-[85%] rounded-md border border-[#8a96d0] bg-[#eef0fb] px-2.5 py-1.5 font-mono text-[12.5px] text-[#1e2340]"
                }
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className="mt-1 text-[9px] text-black/45">
                  {mine ? "sent" : "20880"} · {segments(m.text)} SMS
                </p>
              </div>
            </div>
          );
        })}
        {busy && <p className="font-mono text-[11px] text-[#2c3a28]">…sending / awaiting reply…</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="bg-[#11130f] px-2.5 py-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type SMS (e.g. PAY KG-0001)"
          aria-label="SMS message"
          maxLength={320}
          className="w-full rounded bg-[#20241d] px-2.5 py-2 font-mono text-[12.5px] text-[#d6e4cf] placeholder:text-[#6f7d68] focus:outline-none"
        />
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#8aa083]">
          <span>
            {draft.length}/{SEG} · {left} left
          </span>
          <button type="submit" disabled={busy || !draft.trim()} className="rounded bg-[#2e7d4e] px-3 py-1 text-[#eafff0] disabled:opacity-50">
            SEND
          </button>
        </div>
      </form>
    </div>
  );
}
