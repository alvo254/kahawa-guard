// USSD channel — any phone. A *384# style session: numbered menu, one screen at
// a time, explicit open/close, NOT a stored thread. The menu numbers are input
// presets; whatever is sent goes to the real gateway and its reply fills the
// screen. The session framing is presentation (the gateway has no USSD concept,
// ui/NOTES.md §6.2); the question-and-answer is real.

import { useState } from "react";
import { sendChat } from "../../lib/member";
import { Spinner } from "../../ui/primitives";

const CODE = "*384*7#";

const MENU: { n: string; label: string; prompt: string }[] = [
  { n: "1", label: "Payment status", prompt: "What is my latest payment status? I am KG-0001." },
  { n: "2", label: "Find a licensed dealer", prompt: "Which dealer is licensed for copper oxychloride?" },
  { n: "3", label: "Spraying advice", prompt: "Dawa gani ya ugonjwa wa matunda ya kahawa, na kiasi gani kwa lita 20?" },
  { n: "4", label: "My registered plot", prompt: "Is my registered plot eligible? I am KG-0001." },
];

type Screen = "idle" | "menu" | "await" | "result";

const DEFAULT_FRAME =
  "mx-auto flex h-[560px] w-full max-w-[18rem] flex-col items-center justify-start gap-4 rounded-[1.5rem] border-[6px] border-ink/80 bg-[#101216] p-4 shadow-raised";

export function Ussd({ phone, frame }: { phone: string; frame?: string }) {
  const [screen, setScreen] = useState<Screen>("idle");
  const [body, setBody] = useState("");
  const [input, setInput] = useState("");

  const dial = () => {
    setScreen("menu");
    setBody(
      `CON Kahawa Co-op\nReply with a number:\n${MENU.map((m) => `${m.n}. ${m.label}`).join("\n")}\n0. Exit`,
    );
  };

  const end = () => {
    setScreen("idle");
    setBody("");
    setInput("");
  };

  const choose = async (value: string) => {
    const v = value.trim();
    setInput("");
    if (v === "0") {
      setScreen("result");
      setBody("END Asante. Session closed.");
      return;
    }
    const item = MENU.find((m) => m.n === v);
    const prompt = item ? item.prompt : v; // typed text is sent as-is
    setScreen("await");
    try {
      const resp = await sendChat(phone, prompt);
      // USSD replies are short; present as an END screen (session closes).
      setBody(`END ${resp.reply || "No response."}`);
    } catch (err) {
      const msg = err instanceof Error && /\b429\b/.test(err.message) ? "Service busy, try later." : "Service unavailable.";
      setBody(`END ${msg}`);
    }
    setScreen("result");
  };

  return (
    <div className={frame ?? DEFAULT_FRAME}>
      <p className="font-mono text-xs text-[#7fd1ff]">Dial {CODE}</p>

      {screen === "idle" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="rounded-lg border border-[#2a3340] bg-[#161a20] px-5 py-6 text-center font-mono text-sm text-[#c7d2e0]">
            USSD works on any phone,
            <br /> no internet needed.
          </div>
          <button onClick={dial} className="rounded-xl bg-cherry px-5 py-2.5 font-medium text-white hover:bg-cherry-ink">
            Dial {CODE}
          </button>
        </div>
      ) : (
        <div className="flex w-full flex-1 flex-col">
          {/* USSD modal */}
          <div className="flex-1 rounded-lg border border-[#2a3340] bg-[#0c0e12] p-4 font-mono text-[13px] leading-relaxed text-[#d7e2f0]">
            {screen === "await" ? (
              <Spinner label="Dialling…" />
            ) : (
              <pre className="whitespace-pre-wrap break-words">{body}</pre>
            )}
          </div>

          {/* input row — only while the session expects a reply (CON) */}
          {screen === "menu" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void choose(input);
              }}
              className="mt-3 flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                inputMode="numeric"
                aria-label="USSD reply"
                placeholder="Reply"
                className="flex-1 rounded-lg bg-[#1a1f27] px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:outline-none"
              />
              <button type="submit" className="rounded-lg bg-[#2e7d4e] px-3 py-2 text-sm text-white">
                Send
              </button>
              <button type="button" onClick={end} className="rounded-lg border border-[#2a3340] px-3 py-2 text-sm text-[#c7d2e0]">
                Cancel
              </button>
            </form>
          )}

          {screen === "result" && (
            <button onClick={dial} className="mt-3 rounded-xl border border-[#2a3340] px-4 py-2 font-mono text-sm text-[#c7d2e0] hover:bg-white/5">
              Dial again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
