import { Link } from "react-router-dom";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-3xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="relative rounded-2xl border border-line bg-surface p-6 shadow-card">
      <span className="absolute -top-3 left-6 flex h-7 w-7 items-center justify-center rounded-full bg-cherry text-sm font-semibold text-white">
        {n}
      </span>
      <h3 className="mt-2 font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Trust({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <svg className="mt-0.5 h-5 w-5 shrink-0 text-leaf" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2l7 3v6c0 4.4-3 8.3-7 9.9C8 19.3 5 15.4 5 11V5l7-3Z" fill="currentColor" opacity="0.18" />
        <path d="M8.5 12l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}

export function Home() {
  return (
    <>
      {/* hero */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-content gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
              <span className="h-2 w-2 rounded-full bg-leaf" /> Kirinyaga Coffee Cooperative
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
              Trusted answers for every member,{" "}
              <span className="text-cherry">on any phone.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Check your payment, find a licensed dealer, get spraying advice and confirm your plot —
              in Kiswahili, Gikuyu or English. Karibu. Every reply comes from the cooperative's own
              records, and the assistant will never move your money on its own.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/present" className="rounded-xl bg-cherry px-5 py-3 font-medium text-white hover:bg-cherry-ink">
                Open the assistant
              </Link>
              <a href="#how" className="rounded-xl border border-line px-5 py-3 font-medium text-ink hover:bg-surface-2">
                How it works
              </a>
            </div>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
              <Stat value="3" label="Channels" />
              <Stat value="24/7" label="Available" />
              <Stat value="3" label="Languages" />
            </div>
          </div>

          {/* hero card — a calm WhatsApp-style snippet, static, no data call */}
          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-cherry/5" />
            <div className="mx-auto max-w-sm rounded-[2rem] border border-line bg-surface p-5 shadow-raised">
              <div className="space-y-2.5">
                <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-cherry px-3.5 py-2 text-[15px] text-white">
                  Habari. Payment status for KG-0001?
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2 text-[15px] text-ink">
                  Hello Njeri. Your 2026 main-crop payment of KSh 316,500 was marked <b>paid</b>. Source:
                  cooperative payment records.
                </div>
                <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-cherry px-3.5 py-2 text-[15px] text-white">
                  Dealer for copper oxychloride?
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2 text-[15px] text-ink">
                  Use a dealer on the licensed register with an active licence. I can check one for you by name.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-20 border-b border-line bg-surface/40">
        <div className="mx-auto max-w-content px-4 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-ink">How it works</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted">
            No app to install, no new number to learn. Reach the cooperative the way you already text.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            <Step n="1" title="Message the co-op" body="On WhatsApp, by SMS to 20880, or dial *384*7# on any handset. Write in the language you prefer." />
            <Step n="2" title="Ask a real question" body="Payments, licensed dealers, registered inputs and doses, or whether your plot is eligible." />
            <Step n="3" title="Get a grounded answer" body="Replies are drawn from the cooperative's records and the licensed register, with the source named." />
          </div>
        </div>
      </section>

      {/* trust */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-content gap-10 px-4 py-16 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink">Built to be trusted with your money</h2>
            <p className="mt-3 max-w-xl text-muted">
              Members asked the hardest question first: can I trust it? The assistant is designed so the
              answer is yes — it stays inside what the cooperative knows, and the actions that matter
              always need a person.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Trust title="Grounded in records" body="Advice comes from the licensed register and extension notes, not guesswork." />
            <Trust title="Never moves money alone" body="A payout change needs your PIN and an officer — in person, not over chat." />
            <Trust title="Your language" body="Kiswahili, Gikuyu and English are all normal here." />
            <Trust title="Your data stays home" body="Member records stay with the cooperative." />
          </div>
        </div>
      </section>
    </>
  );
}
