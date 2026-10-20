# Kahawa Guard UI — API contract and build notes

Step 1 output: the real gateway contract as read from the code, the current ui
wiring to preserve, the stack/deploy decision, and — most importantly — the
**gaps** where the brief assumes behaviour the backend does not currently
provide. Nothing here is invented; every endpoint and field is cited to source.
Gaps are flagged, not stubbed.

## 1. Routes the gateway exposes

All under the FastAPI app in `gateway/app/main.py`. Everything is proxied through
`/api` by nginx (`ui/nginx.conf`) → `gateway.gateway.svc.cluster.local:8000`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/chat` | none | The assistant. Body `{phone, message, grower_code?}` → `ChatResponse`. |
| GET | `/api/events` | none | **SSE** verdict stream (`text/event-stream`). |
| POST | `/api/upload` | none | Upload a document (multipart: `role`, `title`, `trust?`, `file`/`text`). |
| GET | `/api/pending` | none | Parked actions awaiting confirmation. |
| POST | `/api/confirm` | none | Member PIN / officer approval for a parked action. |
| GET | `/api/admin/state` | none | Profile, pack, switches, provider, MCP server health. |
| POST | `/api/admin/layers` | token* | Toggle the six guard switches. |
| POST | `/api/admin/pack` | token* | Switch active pack. |
| POST | `/api/admin/reset` | token* | Reset budgets, parked actions, verdict feed. |
| POST | `/api/admin/mcp-refresh` | token* | Re-list + re-pin MCP servers. |
| GET | `/api/audit` | none | Last N audit events (`?limit=`). |
| GET | `/healthz` | none | `{status, profile, pack}`. |

\* **token only when `admin_token_required` is true**, and it is **false in the
naked profile** (`config.py:77`). Header is `X-Admin-Token`. See gap §6.1.

## 2. Transport and verdict schema

`/api/events` is **Server-Sent Events**, not a websocket
(`main.py:242`, `StreamingResponse(..., media_type="text/event-stream")`). On
connect it replays the last 20 verdicts, then streams live, with a `: keepalive`
comment every 15s. Consume with `EventSource` (the current ui already does, in
`ui/src/lib/api.ts` `subscribeVerdicts`).

Each frame is one `Verdict` (`gateway/app/events.py`), `data:` + JSON:

```ts
interface Verdict {
  layer: string;        // see §3
  decision: string;     // allow | block | park | refuse | flag | info
  detail: string;       // human sentence, already written for display
  score: number | null; // L2 expert-guard score when present
  pack: string;         // coffee | education | health
  profile: string;      // naked | hardened
  phone_hash: string;   // session id surrogate — NEVER show on member surface
  extra: Record<string, unknown>;  // see §3 for per-layer contents
  at: number;           // epoch seconds (float)
}
```

`ChatResponse` (`main.py:90`), what the member send returns:

```ts
interface ChatResponse {
  reply: string;
  verdicts: Verdict[];          // the verdicts this message produced
  pending: PendingSummary[];    // {action_id, tool, requires[], args}
  blocked_by: string | null;    // see §3
}
```

**Member surface uses only `reply`** (and, if we choose, `pending` to prompt a
confirmation). It must never read `verdicts`, `blocked_by`, or `phone_hash`.

## 3. Layers, decisions, and what `extra` carries

Layer strings actually emitted (grounded in live feed output and the pipeline):
`identify`, `budget`, `input_guard`, `expert_guard_in`, `expert_guard_out`,
`retrieve`, `mcp_pin`, `model`, `tool_gate`, `registry`, `registry_retry`,
`upload`, `admin`.

`blocked_by` values seen: `input_guard`, `expert_guard_in`, `expert_guard_out`,
`registry`, `model_unavailable`, `budget`, or `null`.

Useful `extra` payloads for the console (from the pipeline source):

- `identify` → `{tokens_used, budget, messages, message_cap}` — **the only live
  budget numbers available** (see gap §6.4).
- `model` → `{tools_offered[], tools_proposed[], usage{…}}`.
- `mcp_pin` → `{server, expected, actual, tools[]}`.
- `tool_gate` → `{args, action_id?, expires_minutes?}`.
- `retrieve` → `{citations[]}`.
- `registry_retry` → `{problems[]}`.

## 4. Admin state model

`GET /api/admin/state` (`main.py:387`):

```ts
interface AdminState {
  profile: string;              // "naked" | "hardened"        (deploy-time, §6.3)
  pack: string;                 // active pack
  packs: string[];              // ["coffee","education","health"]
  switches: Record<string,bool>;// the six below
  provider: string;             // "mistral" | "ollama"        (deploy-time, §6.3)
  shieldstral_mode: string;     // "live" | "cached"           (deploy-time, §6.3)
  embed_dim: number;
  admin_token_required: boolean;
  servers: {                    // MCP health
    name: string; url: string; tools: string[];
    pinned_ok: boolean; expected_pin: string;
    actual_pin: string; error: string;         // error !== "" ⇒ unreachable
  }[];
}
```

The six switches (`packs/loader.py:21` `SWITCHES`), these are the real toggle
keys: `input_guard`, `expert_guard`, `provenance`, `registry`, `tool_gate`,
`budgets`.

> **Correction to the brief.** The brief lists profiles as "naked, mistral,
> cached". In the code those are three *separate* fields: `profile`
> (naked|hardened), `provider` (mistral|ollama), `shieldstral_mode`
> (live|cached). The current panel shows all three as distinct badges.

MCP pin truth table for the health panel: `error !== ""` → **unreachable**;
`pinned_ok` → **pin ok**; else `expected_pin` set → **PIN MISMATCH**; else
**NOT PINNED**. (Mirror the fix already in the current `LayerSwitches.tsx`.)

## 5. Current wiring to preserve

- **Serving:** multi-stage Docker (`node:22` build → `nginx-unprivileged:1.27`
  on **:8080**, non-root). `ui/Dockerfile`.
- **Proxy:** nginx proxies `/api/` to the in-cluster gateway with
  `proxy_buffering off` (required for SSE). `ui/nginx.conf`, staged into the
  chart by `make stage` → `files/nginx.conf`, mounted via ConfigMap
  `kahawa-ui-nginx`.
- **Service:** `kahawa-ui` in ns `kahawa-ui`, port 8080, **NodePort 30080**.
- **Dev:** Vite proxies `/api` → `http://localhost:8000` (`vite.config.ts`), so
  `make forward` (gateway on :8000) is the dev backend.
- The browser only ever talks to one origin. **Keep this.** Both surfaces and
  presenter mode must live behind the same single `/api` proxy and Service, or
  the deploy story breaks.

## 6. Gaps — things the brief needs that the backend does NOT provide

These are flagged per the brief ("if something is missing, flag it rather than
stubbing it"). Each needs a decision, and the ones marked **backend** would be a
server change I will not make without asking.

### 6.1 No auth on telemetry endpoints **(backend)**

The brief: operator console behind a login gate; telemetry is sensitive. But
`/api/admin/state`, `/api/events`, `/api/pending`, `/api/audit` are **completely
unauthenticated**, and even the mutating admin endpoints are open in the naked
profile (`admin_token_required=false`). A login gate in the frontend would be
**cosmetic**: anyone who can reach the UI can hit `/api/events` directly through
the same proxy and see every verdict.

To genuinely protect telemetry we need one of:
- (a) gateway requires a token on the telemetry GETs too, and we gate the proxy;
- (b) a separate nginx location / Service for `/ops` + telemetry, token-checked;
- (c) accept that on-cluster it is demo-open, and the "login" is presentation.

I recommend (a)/(b) for a real product, but both are **backend/deploy changes**.
Which do you want? Until then I will build the console behind a frontend gate and
**clearly mark in NOTES that it is not a real security boundary yet.**

### 6.2 No channel concept **(backend if server-side behaviour wanted)**

The gateway has **no notion of WhatsApp / SMS / USSD**. `/api/chat` is
`{phone, message, grower_code?}` and nothing else (`grep` for channel/whatsapp/
ussd in `gateway/app` = nothing). So:
- Rendering the three channels is **pure frontend presentation** over one
  endpoint — fine, and I can make each convincing and distinct.
- But there is **no server-side USSD session state, no SMS keyword parsing, no
  160-char enforcement, no delivery receipts**. The reply is one blob of text
  each time.
- Honest consequence: USSD "numbered menus" and SMS "keyword routing" would be
  **frontend-simulated**. That risks the "no fake data" rule.

Decision needed: (a) frontend-only channel *styling* over the real single reply
(honest: same answer, three authentic shells), or (b) add a real `channel` field
to `/api/chat` and channel-aware behaviour server-side (**backend change**).
I recommend (a) and will label it as presentation, not protocol.

### 6.3 Profile / provider / mode are deploy-time, not runtime **(backend)**

There is **no endpoint to switch `profile`, `provider`, or `shieldstral_mode`.**
Only `layers` and `pack` have POST handlers. These three come from Helm values at
deploy (`make deploy PROFILE=… PROVIDER=…`). So the console can **display** them
honestly, and the real live controls are the **six layer toggles** and the
**pack switch**. A live "profile switch" button would need a backend endpoint.
Recommend: show profile/provider/mode as read-only status; make layers + pack the
interactive controls. Confirm.

### 6.4 No aggregate spend endpoint

Live spend numbers exist only inside the `identify` verdict's `extra`
(`tokens_used, budget, messages, message_cap`), per phone, as each message flows.
There is **no global "/api/budget" or cross-session total**. So the spend meters
can honestly show **the current/most-recent session's** usage vs its cap, updated
from the stream — not a cooperative-wide total. I will label the meter as
per-session. (The pack's configured caps are also in `packs/*.yaml`.)

### 6.5 Model / 429 state is observable only on a chat attempt

There is no model health probe. Rate-limit or unreachable shows up as a `model`
verdict with `decision:"refuse"` and `detail` containing e.g. `429` or
`ReadTimeout` / `unreachable` (and `blocked_by:"model_unavailable"` on the chat).
So the console's "model reachability" tile reflects the **last model verdict
seen**, not a continuous healthcheck. Honest and real; just not a live ping.

## 7. Proposed approach (for your approval — not yet built)

- **Stack:** keep React 18 + Vite + TS (repo already uses it). **Add Tailwind**
  for the design system velocity and token-based theming the brief wants;
  justified by the two-surface scope. Own component library, documented.
- **One app, three route trees, one Service/proxy** (preserves §5 wiring):
  - Member (public): `/`, `/about`, `/services`, `/assistant` (the 3 channels).
  - Operator (gated): `/ops` — feed, spend, controls, health.
  - Presenter: `/present` — member channel + feed side by side, one live session.
- **Telemetry isolation:** the member bundle never imports the verdict/admin
  client at all (separate entry/module boundary), so there is no path from the
  member surface to guard internals even in the shipped JS. Pending your §6.1
  decision on real backend auth.
- **Theme:** coffee palette as CSS tokens on `:root`, full light/dark, AA
  contrast, reduced-motion, keyboard nav. Green only for allow/success, red for
  block. Two accents max.
- **States:** every data view handles loading / empty / disconnected (SSE
  reconnect) / rate-limited.
- **Deploy:** unchanged Dockerfile shape, same nginx proxy, same NodePort. If a
  gated `/ops` needs its own proxy location, I will add it to `nginx.conf` only.

## 8. Open questions before Step 2

1. **§6.1 auth:** real backend token on telemetry (a/b), or frontend gate marked
   as not-yet-a-boundary (c)? If (a)/(b), I need the go-ahead for a backend change.
2. **§6.2 channels:** frontend presentation over the real reply (a), or a real
   `channel` field + server behaviour (b, backend)?
3. **§6.3 controls:** profile/provider/mode read-only, layers + pack live —
   agreed?
4. **§6.4 spend:** per-session meter labelled as such — acceptable?
5. **Tailwind** addition — agreed, or keep CSS-only like the current ui?

## 9. Step 2 — what was built (decisions taken)

Built end to end per the "do everything you recommend" instruction. Decisions:
§6.1 → **frontend gate, clearly labelled not-a-security-boundary** in naked (no
backend change made); §6.2 → **authentic channel shells over the one real reply**
(presentation, not simulated protocol); §6.3 → **profile/provider/mode read-only,
layers + pack live**; §6.4 → **per-session spend meter, labelled**; Tailwind
**added**. No backend or gateway contract was touched.

Structure (`ui/src/`): `lib/` (types, member, ops, useEventStream, theme,
format) · `ui/` (owned primitives, Logo, ThemeToggle) · `member/` (layout, Home,
About, Services, Assistant + `channels/` WhatsApp·Sms·Ussd) · `ops/` (gate,
console, VerdictFeed, SpendPanel, Controls, HealthPanel, PendingPanel) ·
`present/` (Presenter).

Routes, one Service/proxy: `/ /services /about` (member, public) · `/ops`
(gated) · `/present`. Ops and presenter are `React.lazy`, so telemetry ships in
separate chunks. **Verified:** the member bundle contains no
`api/events`/`api/admin/*`/`api/audit` strings; they appear only in the ops
chunk.

Build: `npm run build` → `tsc -b && vite build` passes (62 modules). Deploy
wiring unchanged (Dockerfile, nginx `/api` proxy with `proxy_buffering off`,
ConfigMap, NodePort 30080). `VITE_ADMIN_TOKEN` optional build arg; empty in
naked. Still open and unchanged from §6: real telemetry auth (§6.1), channel
backend (§6.2), runtime profile/provider switch (§6.3) — all backend, all
awaiting your go-ahead.
