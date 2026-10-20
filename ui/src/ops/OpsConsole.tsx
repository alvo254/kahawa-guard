// Operator console. One live verdict stream drives the feed, spend, health and
// pending panels; controls write back to the gateway. Desktop-first, dense grid.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useVerdictStream } from "../lib/useEventStream";
import { useAdminState } from "./useAdminState";
import { VerdictFeed } from "./VerdictFeed";
import { SpendPanel } from "./SpendPanel";
import { Controls } from "./Controls";
import { HealthPanel } from "./HealthPanel";
import { PendingPanel } from "./PendingPanel";
import { Logo } from "../ui/Logo";
import { ThemeToggle } from "../ui/ThemeToggle";
import { cx } from "../ui/primitives";

function ReadonlyBadge({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </span>
  );
}

export function OpsConsole() {
  const { verdicts, status, clear } = useVerdictStream();
  const latest = verdicts.length ? verdicts[verdicts.length - 1] : null;
  const { state, refresh } = useAdminState(latest);

  // Re-poll pending whenever the tool gate parks (or releases) something.
  const [pendingPoke, setPendingPoke] = useState(0);
  useEffect(() => {
    if (latest && latest.layer === "tool_gate") setPendingPoke((n) => n + 1);
  }, [latest]);

  const profile = state?.profile ?? "…";
  const hardened = profile === "hardened";

  const badges = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cx(
            "rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
            hardened ? "bg-leaf/15 text-leaf" : "bg-amber/15 text-amber",
          )}
        >
          {profile}
        </span>
        {state && <ReadonlyBadge k="provider" v={state.provider} />}
        {state && <ReadonlyBadge k="shieldstral" v={state.shieldstral_mode} />}
        {state && <ReadonlyBadge k="pack" v={state.pack} />}
      </div>
    ),
    [state, hardened, profile],
  );

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-4">
            <Link to="/" aria-label="Back to member site" title="Back to member site">
              <Logo />
            </Link>
            <span className="hidden text-sm text-muted sm:inline">Oversight console</span>
          </div>
          <div className="hidden lg:block">{badges}</div>
          <div className="flex items-center gap-2">
            <Link
              to="/present"
              className="hidden rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 sm:inline-flex"
            >
              Presenter
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="mx-auto max-w-[90rem] px-4 pb-3 lg:hidden">{badges}</div>
      </header>

      <main className="mx-auto grid w-full max-w-[90rem] flex-1 gap-5 px-4 py-5 lg:grid-cols-[1.4fr_1fr]">
        {/* left: the feed, full height */}
        <div className="min-h-[70vh] lg:min-h-0">
          <VerdictFeed verdicts={verdicts} status={status} onClear={clear} />
        </div>

        {/* right: stacked panels */}
        <div className="flex flex-col gap-5">
          <HealthPanel state={state} verdicts={verdicts} />
          <SpendPanel verdicts={verdicts} />
          <Controls state={state} onChanged={refresh} />
          <PendingPanel pokeAt={pendingPoke} />
        </div>
      </main>

      {!hardened && state && (
        <div className="border-t border-amber/30 bg-amber/10 px-4 py-2 text-center text-xs text-amber">
          Naked profile · telemetry endpoints are unauthenticated on this cluster (NOTES §6.1).
        </div>
      )}
    </div>
  );
}
