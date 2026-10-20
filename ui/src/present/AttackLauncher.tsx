// Live "hacks": each button plays the real scene out IN the WhatsApp phone —
// the question appears, the reply comes back, and the verdict feed reacts. For
// the fake circular the dealer document is uploaded first and shown as a
// received attachment, so it is visible, not hidden. Buttons + free typing: the
// phone still takes anything you type.

import { useState } from "react";
import { ATTACKS } from "../lib/demo";
import type { Attack } from "../lib/demo";
import { cx } from "../ui/primitives";

export function AttackLauncher({
  guardsOn = false,
  onAttack,
}: {
  guardsOn?: boolean;
  onAttack: (a: Attack) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (a: Attack) => {
    if (busy) return;
    setBusy(a.id);
    setDone(null);
    try {
      await onAttack(a);
      setDone(a.id);
      setTimeout(() => setDone((d) => (d === a.id ? null : d)), 2500);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-danger/12 text-danger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Launch an attack</p>
          <p className="text-xs text-muted">Plays out in the WhatsApp phone. Watch the verdict feed react.</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {ATTACKS.map((a) => (
          <button
            key={a.id}
            onClick={() => run(a)}
            disabled={busy !== null}
            className={cx(
              "group flex flex-col rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
              done === a.id ? "border-leaf bg-leaf/10" : "border-line bg-surface hover:border-danger/50 hover:bg-danger/5",
            )}
          >
            <span className="flex items-center justify-between">
              <span className="font-medium text-ink">{a.label}</span>
              {busy === a.id ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-danger" />
              ) : done === a.id ? (
                <span className="text-xs font-medium text-leaf">sent ✓</span>
              ) : null}
            </span>
            <span className="mt-1 text-xs leading-snug text-muted">{a.blurb}</span>
            <span className="mt-2 text-[11px] font-medium text-cherry">stopped by {a.stoppedBy}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {guardsOn ? (
          <>
            Guards are <b className="text-leaf">on</b> — fire one and watch the moat catch it in the feed.
          </>
        ) : (
          <>
            Guards are <b className="text-amber">off</b> — these land. Flip <b>Guards</b> on above and fire
            again to watch each one get caught.
          </>
        )}
      </p>
    </div>
  );
}
