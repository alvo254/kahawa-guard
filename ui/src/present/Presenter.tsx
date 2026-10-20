// Presenter mode — the masterclass screen. Business stakes (EUDR) and the live
// attack launcher across the top; all three member channels, big and typeable,
// beside the live verdict feed. One live session: fire a hack (or type by hand)
// and the calm member reply and the guard "moat" move together.

import { useState } from "react";
import { Link } from "react-router-dom";
import { WhatsAppView } from "../member/channels/WhatsApp";
import { Sms } from "../member/channels/Sms";
import { Ussd } from "../member/channels/Ussd";
import { useAssistant } from "../member/useAssistant";
import { uploadDocument } from "../lib/demo";
import type { Attack } from "../lib/demo";
import { useVerdictStream } from "../lib/useEventStream";
import { useAdminState } from "../ops/useAdminState";
import { VerdictFeed } from "../ops/VerdictFeed";
import { EudrBanner } from "./EudrBanner";
import { AttackLauncher } from "./AttackLauncher";
import { PresenterControls } from "./PresenterControls";
import { AssistantGuide } from "../member/Guide";
import { LAYER_KEYS } from "../lib/types";
import { Logo } from "../ui/Logo";
import { ThemeToggle } from "../ui/ThemeToggle";

// Device frames sized to fill a column and share one height, three-up.
const WA_FRAME =
  "flex h-[600px] w-full flex-col overflow-hidden rounded-[2rem] border-[6px] border-ink/80 bg-[#0b141a] shadow-raised";
const SMS_FRAME =
  "flex h-[600px] w-full flex-col overflow-hidden rounded-[1.5rem] border-[6px] border-ink/80 bg-[#1b1d1a] shadow-raised";
const USSD_FRAME =
  "flex h-[600px] w-full flex-col items-center justify-start gap-4 rounded-[1.5rem] border-[6px] border-ink/80 bg-[#101216] p-4 shadow-raised";

// The members the audience watches. KG-0003 is Scene 3/4's target.
const WA_PHONE = "+254700000003";
const SMS_PHONE = "+254700000001";
const USSD_PHONE = "+254700000003";

function ChannelCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-muted">{hint}</span>
      </div>
      {children}
    </div>
  );
}

export function Presenter() {
  const { verdicts, status, clear } = useVerdictStream();
  const latest = verdicts.length ? verdicts[verdicts.length - 1] : null;
  const { state, refresh } = useAdminState(latest);
  const guardsOn = state ? LAYER_KEYS.some((k) => state.switches[k]) : false;

  // The WhatsApp phone the room watches is a lifted conversation, so the attack
  // launcher can play a scene out inside it.
  const wa = useAssistant(WA_PHONE);
  const [asMember, setAsMember] = useState<string>("KG-0003");

  const handleAttack = async (a: Attack) => {
    wa.reset();
    const code = a.phone.replace("+2547000000", "KG-000");
    setAsMember(code);
    if (a.upload) {
      await uploadDocument(a.upload);
      wa.note(`📎 Received: “${a.upload.title}” — unverified ${a.upload.role} document`);
    }
    await wa.send(a.message, a.phone);
  };

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link to="/" aria-label="Back to member site" title="Back to member site">
            <Logo />
          </Link>
          <span className="rounded-full bg-cherry/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-cherry">
            Presenter
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/ops" className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
            Console
          </Link>
          <Link to="/" className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
            Member site
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto w-full max-w-[110rem] flex-1 px-5 py-5">
        {/* control strip — run the whole demo from here */}
        <PresenterControls state={state} onChanged={refresh} />

        {/* stakes + live hacks */}
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
          <EudrBanner />
          <AttackLauncher guardsOn={guardsOn} onAttack={handleAttack} />
        </div>

        {/* channels + live verdicts */}
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              What the member sees · type into any channel
            </h2>
            <AssistantGuide defaultOpen={false} />
            <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
              <ChannelCard title="WhatsApp" hint="Smartphone">
                <WhatsAppView ctl={wa} frame={WA_FRAME} asLabel={asMember} />
              </ChannelCard>
              <ChannelCard title="SMS" hint="Feature phone">
                <Sms phone={SMS_PHONE} frame={SMS_FRAME} />
              </ChannelCard>
              <ChannelCard title="USSD" hint="Any phone, *384*7#">
                <Ussd phone={USSD_PHONE} frame={USSD_FRAME} />
              </ChannelCard>
            </div>
          </section>

          <section className="flex min-h-[600px] flex-col">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              What the guards do · live
            </h2>
            <div className="min-h-0 flex-1 xl:sticky xl:top-20 xl:h-[calc(100vh-7rem)]">
              <VerdictFeed verdicts={verdicts} status={status} onClear={clear} />
            </div>
          </section>
        </div>
      </div>

      {status !== "live" && (
        <div className="border-t border-amber/30 bg-amber/10 px-4 py-2 text-center text-xs text-amber">
          Verdict stream {status}. If this does not say “live”, the gateway is not reachable — check the
          tunnel/port-forward, not the UI.
        </div>
      )}
      <p className="pb-4 pt-3 text-center text-xs text-muted">
        Same live session, both sides. The member never sees the verdict feed — that is the operator's view.
        <span className="mx-2 text-line">·</span>
        <span className="font-mono">build {__BUILD_ID__}</span>
      </p>
    </div>
  );
}
