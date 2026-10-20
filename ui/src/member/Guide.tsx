// Point-of-use guidance so a first-time visitor is not lost: what a grower code
// is and which demo ones work, what the assistant can and will not do, and
// example questions to try. Copy-to-clipboard chips let them paste a code or a
// whole example into any channel. Member-safe (no telemetry).

import { useState } from "react";
import { cx } from "../ui/primitives";

// Real seeded members (data/seed/members.csv) — so the demo IDs actually work.
export const DEMO_MEMBERS = [
  { code: "KG-0001", name: "Wanjiku Mwangi" },
  { code: "KG-0002", name: "Kamau Njoroge" },
  { code: "KG-0003", name: "Njeri Kariuki" },
];

export const EXAMPLES: { label: string; text: string }[] = [
  { label: "Check a payment", text: "Has my 2026 crop payment been processed? I am KG-0001." },
  { label: "Find a licensed dealer", text: "Is Kirinyaga Agrovet Ltd a licensed dealer?" },
  { label: "Safe spraying dose", text: "What is the safe dose for coffee berry disease per 20 litres?" },
  { label: "Plot eligibility", text: "Is my registered plot eligible? I am KG-0001." },
  { label: "In Kiswahili / Gikuyu", text: "Dawa gani ya ugonjwa wa matunda ya kahawa, na kiasi gani kwa lita 20?" },
];

function CopyChip({ text, title, mono }: { text: string; title?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — chip still communicates the value */
    }
  };
  return (
    <button
      onClick={copy}
      title={title ?? "Copy"}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors",
        copied ? "border-leaf bg-leaf/10 text-leaf" : "border-line bg-surface text-ink hover:bg-surface-2",
        mono && "font-mono",
      )}
    >
      {copied ? "copied ✓" : text}
      {!copied && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-muted">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  );
}

const CAN = [
  "Check your crop payment status",
  "Find a licensed, active agro-dealer",
  "Give registered inputs and safe doses",
  "Confirm whether a plot is eligible",
];
const WONT = ["Change your payout account", "Ask for or share a PIN", "Point you to an unlicensed dealer"];

export function AssistantGuide({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mx-auto mb-6 max-w-3xl overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cherry/10 text-cherry">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 11v5M12 7.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="font-semibold text-ink">New here? How to use the assistant</span>
        </span>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
          className={cx("text-muted transition-transform", open && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-5 py-5">
          {/* grower code */}
          <div>
            <p className="text-sm font-semibold text-ink">1 · Mention your grower code</p>
            <p className="mt-1 text-sm text-muted">
              It identifies your membership — printed on your cooperative card and on every payment SMS.
              The format is <span className="font-mono text-ink">KG-0000</span>. Just trying the demo?
              Tap a code to copy it, then paste it into a message:
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {DEMO_MEMBERS.map((m) => (
                <CopyChip key={m.code} text={m.code} title={`${m.name} — copy`} mono />
              ))}
            </div>
          </div>

          {/* examples */}
          <div>
            <p className="text-sm font-semibold text-ink">2 · Try asking</p>
            <p className="mt-1 text-sm text-muted">Tap to copy an example, then paste it into any channel.</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <CopyChip key={e.label} text={e.text} title={e.label} />
              ))}
            </div>
          </div>

          {/* can / won't */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-ink">What it can do</p>
              <ul className="mt-2 space-y-1.5">
                {CAN.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">What it will not do</p>
              <ul className="mt-2 space-y-1.5">
                {WONT.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-sm text-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
            It is an AI assistant that understands plain language in Kiswahili, Gikuyu and English. Every
            answer is drawn from the cooperative's records and the licensed register, and it names its
            source. Anything that moves money needs a person to approve it.
          </p>
        </div>
      )}
    </div>
  );
}
