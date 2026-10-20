export function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wider text-cherry">About</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink">
        A cooperative assistant that earns its trust
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-muted">
        Kahawa Guard is the digital front desk of the Kirinyaga coffee cooperative. It answers the
        everyday questions members used to queue at the office for — and it does so in a way the
        cooperative can stand behind.
      </p>

      <div className="mt-12 space-y-10">
        <section>
          <h2 className="text-xl font-semibold text-ink">Why it exists</h2>
          <p className="mt-3 leading-relaxed text-muted">
            Members are spread across smartphones, feature phones and basic handsets, and across three
            languages. A single office line could never keep up. The assistant meets members where they
            already are, at any hour, and gives the same grounded answer every time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">What makes it safe</h2>
          <p className="mt-3 leading-relaxed text-muted">
            An AI that can read records and trigger actions is only useful if it can be trusted. Kahawa
            Guard is built around a simple rule: the assistant may <em>inform</em> freely, but anything
            that moves money or touches a member's account needs a real person to approve it. Advice is
            checked against the cooperative's licensed register before it is given, so a member is never
            pointed at an unlicensed dealer or an unsafe dose.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Who it serves</h2>
          <p className="mt-3 leading-relaxed text-muted">
            Growers, cooperative officers and extension staff. Members get answers; officers keep
            oversight. The same platform adapts to other cooperatives and to health and education
            programmes, because the guardrails travel with it.
          </p>
        </section>
      </div>

      <div className="mt-12 rounded-2xl border border-line bg-surface p-6 shadow-card">
        <p className="text-ink">
          <span className="font-semibold">For operators:</span> the oversight console lives at{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-sm text-cherry">/ops</code>.
        </p>
      </div>
    </div>
  );
}
