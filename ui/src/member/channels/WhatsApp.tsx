// WhatsApp channel — smartphone members. Threaded chat, delivery ticks, typing
// indicator. The reply text is exactly what the gateway returned.
//
// Split in two: WhatsAppView is presentational (takes a conversation), WhatsApp
// is the self-contained wrapper used on the member site. Presenter drives
// WhatsAppView with its own lifted conversation so the attack launcher can play
// attacks out IN the phone.

import { useEffect, useRef, useState } from "react";
import { useAssistant } from "../useAssistant";
import type { AssistantController, Delivery } from "../useAssistant";
import { uploadFile } from "../../lib/member";
import { UPLOAD_ROLES } from "../docs";

const QUICK = [
  "Habari, what is my payment status? I am KG-0001.",
  "Which dealer is licensed for copper oxychloride?",
  "Dawa gani ya ugonjwa wa matunda ya kahawa, kiasi gani kwa lita 20?",
];

const DEFAULT_FRAME =
  "mx-auto flex h-[640px] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] border-[6px] border-ink/80 bg-[#0b141a] shadow-raised";

function Ticks({ d }: { d?: Delivery }) {
  if (d === "sending") return <span className="text-[10px] text-white/70">🕓</span>;
  if (d === "failed") return <span className="text-[10px] text-white/80">!</span>;
  const double = d === "delivered";
  return (
    <span className={double ? "text-sky-200" : "text-white/70"} aria-label={double ? "delivered" : "sent"}>
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
        <path d="M1 6l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {double && <path d="M6 9l6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </span>
  );
}

function clock() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function WhatsAppView({
  ctl,
  frame,
  asLabel,
  showQuick = true,
}: {
  ctl: AssistantController;
  frame?: string;
  /** small "as KG-0003" pill in the header, for the presenter */
  asLabel?: string;
  showQuick?: boolean;
}) {
  const { messages, busy, send, attach } = ctl;
  const [draft, setDraft] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [role, setRole] = useState<string>("dealer");
  const [picked, setPicked] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Upload a real file the member chose from their device, under the selected
  // trust role. This is the indirect-injection vector: whatever instruction the
  // file contains enters the assistant's knowledge.
  const uploadChosen = async () => {
    if (!picked) return;
    setUploading(true);
    setErr(null);
    try {
      const res = await uploadFile(picked, role, picked.name);
      attach({ title: res.title || picked.name, role, trust: res.trust });
      setPicked(null);
      if (fileRef.current) fileRef.current.value = "";
      setShowAttach(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = draft;
    setDraft("");
    void send(t);
  };

  return (
    <div className={frame ?? DEFAULT_FRAME}>
      {/* header */}
      <div className="flex items-center gap-3 bg-whatsapp px-4 py-3 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 font-semibold">KG</div>
        <div className="flex-1 leading-tight">
          <p className="font-semibold">Kahawa Co-op</p>
          <p className="text-xs text-white/80">online</p>
        </div>
        {asLabel && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">as {asLabel}</span>}
      </div>

      {/* thread */}
      <div
        className="scroll-slim flex-1 space-y-2 overflow-y-auto px-3 py-4"
        style={{ backgroundColor: "#0b141a", backgroundImage: "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 0)", backgroundSize: "18px 18px" }}
      >
        {messages.length === 0 && (
          <p className="mx-auto mt-6 max-w-[80%] rounded-lg bg-amber/15 px-3 py-2 text-center text-xs text-amber">
            Messages are answered by the cooperative assistant. Ask about payments, dealers, inputs or your
            plot — and mention your grower code, e.g. KG-0001.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.from === "member";
          const system = m.from === "system";
          if (m.doc) {
            const untrusted = m.doc.trust !== "trusted";
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[82%] rounded-lg rounded-tr-sm bg-[#005c4b] p-2 animate-fade-in">
                  <div className="flex items-center gap-2 rounded-md bg-black/20 px-2.5 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-white/15 text-white">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M7 3h7l5 5v13H7z" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-white">{m.doc.title}</p>
                      <p className="text-[11px] text-white/70">
                        uploaded as {m.doc.role} ·{" "}
                        <span className={untrusted ? "text-amber-200" : "text-emerald-200"}>{m.doc.trust}</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-0.5 flex justify-end text-[10px] text-white/60">{clock()}</div>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  system
                    ? "max-w-[85%] rounded-lg bg-amber/20 px-3 py-2 text-xs text-amber"
                    : mine
                      ? "max-w-[80%] rounded-lg rounded-tr-sm bg-[#005c4b] px-3 py-1.5 text-[15px] text-white animate-fade-in"
                      : "max-w-[80%] rounded-lg rounded-tl-sm bg-[#202c33] px-3 py-1.5 text-[15px] text-white animate-fade-in"
                }
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                {!system && (
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-white/60">
                    <span>{clock()}</span>
                    {mine && <Ticks d={m.delivery} />}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-lg rounded-tl-sm bg-[#202c33] px-3 py-2">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white/70" />
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white/70" style={{ animationDelay: "0.2s" }} />
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white/70" style={{ animationDelay: "0.4s" }} />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* quick replies */}
      {showQuick && messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 bg-[#0b141a] px-3 pb-2">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => void send(q)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/80 hover:bg-white/10"
            >
              {q.length > 34 ? `${q.slice(0, 33)}…` : q}
            </button>
          ))}
        </div>
      )}

      {/* attach panel — pick a real file from your device */}
      {showAttach && (
        <div className="space-y-3 border-t border-white/10 bg-[#0b141a] px-3 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/50">Attach a document</p>

          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
            onChange={(e) => {
              setPicked(e.target.files?.[0] ?? null);
              setErr(null);
            }}
            className="hidden"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[13px] text-white hover:bg-white/10"
            >
              Choose file
            </button>
            <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">
              {picked ? picked.name : "No file chosen — .txt, .md or .pdf"}
            </span>
          </div>

          <label className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-white/70">Upload as</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-white/15 bg-[#141f27] px-2 py-1.5 text-[13px] text-white focus:outline-none"
            >
              {UPLOAD_ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label} ({r.trust})
                </option>
              ))}
            </select>
          </label>

          {err && <p className="text-[11px] text-danger">{err}</p>}

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40">
              Dealer/Member = untrusted. Guards off: its instructions are obeyed. Guards on: quoted as data
              and refused.
            </span>
            <button
              type="button"
              onClick={() => void uploadChosen()}
              disabled={!picked || uploading}
              className="shrink-0 rounded-lg bg-whatsapp px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Attach"}
            </button>
          </div>
        </div>
      )}

      {/* composer */}
      <form onSubmit={submit} className="flex items-center gap-2 bg-[#1f2c33] px-3 py-2">
        <button
          type="button"
          onClick={() => setShowAttach((s) => !s)}
          aria-label="Attach document"
          aria-expanded={showAttach}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          aria-label="Message"
          className="flex-1 rounded-full bg-[#2a3942] px-4 py-2 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-whatsapp text-white disabled:opacity-50"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

/** Self-contained WhatsApp (member site): owns its own conversation. */
export function WhatsApp({ phone, frame }: { phone: string; frame?: string }) {
  const ctl = useAssistant(phone);
  return <WhatsAppView ctl={ctl} frame={frame} />;
}
