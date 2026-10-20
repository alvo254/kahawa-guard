import { Link } from "react-router-dom";

const SERVICES = [
  {
    title: "Payment status",
    body: "Check whether a crop payment has been processed, and for how much — straight from the cooperative's payment records.",
    example: "PAY KG-0001",
  },
  {
    title: "Licensed dealers",
    body: "Find an agro-dealer the cooperative lists as licensed and active, so inputs come from a trusted source.",
    example: "DEALER copper oxychloride",
  },
  {
    title: "Spraying & input advice",
    body: "Registered products and safe doses for common coffee problems, from the cooperative's extension notes.",
    example: "Ugonjwa wa matunda, lita 20?",
  },
  {
    title: "Plot eligibility",
    body: "Confirm a registered plot and whether it overlaps protected forest before it is accepted.",
    example: "Is my plot eligible? KG-0001",
  },
];

function Icon() {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cherry/10 text-cherry">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Services() {
  return (
    <div className="mx-auto max-w-content px-4 py-16">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wider text-cherry">Services</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink">What members can ask</h1>
        <p className="mt-4 text-lg text-muted">
          Four everyday things, answered in your language, on whatever phone you have. Each example
          below is a real message you can send.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {SERVICES.map((s) => (
          <div key={s.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            <Icon />
            <h2 className="mt-4 text-lg font-semibold text-ink">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            <p className="mt-4 inline-block rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm text-ink">
              “{s.example}”
            </p>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl border border-line bg-surface p-8 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink">Ready to try it?</h2>
          <p className="mt-1 text-muted">Open the assistant and ask one of these now.</p>
        </div>
        <Link to="/present" className="rounded-xl bg-cherry px-5 py-3 font-medium text-white hover:bg-cherry-ink">
          Open the assistant
        </Link>
      </div>
    </div>
  );
}
