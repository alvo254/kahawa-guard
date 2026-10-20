// The business stakes, tied to the security moat. The EU Deforestation
// Regulation (EUDR) requires coffee placed on the EU market to be proven
// deforestation-free, with geolocated plot boundaries. That is exactly what the
// laundered-plot and payout attacks threaten — so the guard layers are not just
// safety, they are what keeps the cooperative's EUDR evidence trustworthy.
//
// The date is the CO-OP's own evidence-submission target (a configurable
// constant, labelled as theirs) — not a claim about the legal enforcement date.

const DEADLINE = new Date("2026-12-30T00:00:00Z");

function daysLeft(): number {
  const ms = DEADLINE.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function EudrBanner() {
  const days = daysLeft();
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf/12 text-leaf">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3c4 4 6 7 6 10a6 6 0 1 1-12 0c0-3 2-6 6-10Z" fill="currentColor" opacity="0.2" />
              <path d="M12 21V8M12 12l3-2M12 15l-3-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">EUDR readiness</p>
            <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-muted">
              To sell into the EU, every plot must be proven <b>deforestation-free</b> with geolocated
              boundaries. A laundered plot or a quietly redirected payout breaks that evidence — the
              guard layers are the moat that keeps it audit-ready.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
          <div className="text-center">
            <p className="text-3xl font-semibold tabular-nums text-cherry">{days}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">days to evidence deadline</p>
          </div>
          <div className="h-10 w-px bg-line" />
          <ul className="space-y-0.5 text-xs text-muted">
            <li>· Geolocated plots</li>
            <li>· Deforestation-free proof</li>
            <li>· Auditable decisions</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
