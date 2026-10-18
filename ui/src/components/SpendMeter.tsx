import type { Verdict } from "../lib/api";

/** Reads the identify verdict's extra fields to show tokens used vs. budget.
 * No separate endpoint: the identify layer already publishes this every message. */
export default function SpendMeter({ verdicts }: { verdicts: Verdict[] }) {
  const last = verdicts.filter((v) => v.layer === "identify").at(-1);
  const used = Number(last?.extra?.tokens_used ?? 0);
  const budget = Number(last?.extra?.budget ?? 0) || 1;
  const messages = Number(last?.extra?.messages ?? 0);
  const cap = Number(last?.extra?.message_cap ?? 0) || 1;
  const pct = Math.min(100, Math.round((used / budget) * 100));

  return (
    <div className="spend-meter">
      <h3>Spend</h3>
      <div className="meter-label">
        {used.toLocaleString()} / {budget.toLocaleString()} tokens today
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${pct >= 100 ? "meter-full" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-label">
        {messages} / {cap} messages this hour
      </div>
    </div>
  );
}
