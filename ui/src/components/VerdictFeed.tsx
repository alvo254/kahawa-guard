import type { Verdict } from "../lib/api";

const DECISION_CLASS: Record<string, string> = {
  allow: "v-allow",
  block: "v-block",
  refuse: "v-block",
  park: "v-park",
  capped: "v-park",
  flag: "v-flag",
  info: "v-info",
};

export default function VerdictFeed({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <div className="verdict-feed">
      <h3>Verdicts</h3>
      <div className="verdict-list">
        {verdicts.length === 0 && <div className="panel-loading">No verdicts yet.</div>}
        {verdicts
          .slice()
          .reverse()
          .map((v, i) => (
            <div key={i} className={`verdict-row ${DECISION_CLASS[v.decision] || "v-info"}`}>
              <div className="verdict-top">
                <span className="verdict-layer">{v.layer}</span>
                <span className="verdict-decision">{v.decision}</span>
                {v.score != null && <span className="verdict-score">{v.score.toFixed(2)}</span>}
              </div>
              <div className="verdict-detail">{v.detail}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
