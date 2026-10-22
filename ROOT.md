# Kahawa Guard — the whole system, in one read

The single orientation document. Read this top to bottom and the repo should make
sense: what it is, the model it runs on, the gateway pipeline, every guard, the
packs, the MCP tool servers, the n8n side-effect workflows, the data, the two
profiles, the platform (Cilium/Tetragon/Kyverno/Vault), the scenes, the UI, and
where to go next for depth.

> **What it is in one sentence.** Kahawa Guard is a deliberately attackable AI
> assistant for a fictional Kenyan coffee cooperative, wired to real tools that
> move money and send SMS, plus the layered defence that stops the attacks — the
> same code run two ways: **naked** (defences off, the attacks land) and
> **hardened** (defences on, the attacks are refused, dropped, or killed in the
> kernel, live on screen).

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [The model(s) we run](#2-the-models-we-run)
3. [The request path, end to end](#3-the-request-path-end-to-end)
4. [The gateway pipeline — the nine steps](#4-the-gateway-pipeline--the-nine-steps)
5. [The guards, one by one](#5-the-guards-one-by-one)
6. [The packs — policy as data](#6-the-packs--policy-as-data)
7. [The MCP tool servers](#7-the-mcp-tool-servers)
8. [The n8n side-effect workflows](#8-the-n8n-side-effect-workflows)
9. [The data layer](#9-the-data-layer)
10. [The two profiles](#10-the-two-profiles)
11. [The platform layers (Cilium / Tetragon / Kyverno / Vault)](#11-the-platform-layers)
12. [The scenes](#12-the-scenes)
13. [The UI](#13-the-ui)
14. [Namespaces & trust zones](#14-namespaces--trust-zones)
15. [Everyday commands](#15-everyday-commands)
16. [Repo layout](#16-repo-layout)
17. [The honest caveats](#17-the-honest-caveats)
18. [Where to go next (doc map)](#18-where-to-go-next-doc-map)

## 1. The big picture

A member texts an SMS-style assistant ("what's my payment?", "is this dealer
licensed?", "register my plot"). Behind it sits a **gateway** (FastAPI) — the only
component allowed to talk to the model, the tools and the database. The gateway
runs a guard pipeline, calls the model, lets the model propose **tool calls**,
and decides in code which of those may actually run. Real side effects (changing
a payout account, sending SMS) happen through **n8n** workflows exposed as MCP
tools.

The entire thing is an attack/defence teaching rig. Every scene is a real,
reproducible break that lands in **naked** and is stopped in **hardened**. The
repeating lesson:

> **The component closest to an attack is the one you cannot trust to stop it.**
> The model will follow a planted instruction; a vulnerable file server
> mis-validates its own paths; a prompt rule is only a request. So each control
> sits at the **lowest layer that can actually enforce** the decision — code over
> model, kernel over code, admission over kernel.

Six defence layers, top to bottom:

```text
app pipeline   L1/L2 guards, provenance, L3 registry, L4 tool gate, pinning   (the gateway)
network        Cilium  — default-deny, L7 egress/ingress, deny-metadata       (kernel)
runtime        Tetragon — kill shells / FS-escape / metadata, watch SA token  (kernel/eBPF)
admission      Kyverno — allowed registries, no :latest, require limits       (API server)
secrets        Vault + External Secrets (hardened) vs plain env (naked)
identity       per-phone session + budgets
```

## 2. The model(s) we run

The gateway is model-pluggable (`gateway/app/llm/`): **Mistral API** by default,
or a local **Ollama** model. Defaults (`gateway/app/config.py`, chart values):

| Role | Mistral (default) | Ollama (local) | Notes |
| --- | --- | --- | --- |
| Chat | `ministral-8b-2512` | `mistral-small3.2` | 8B; chosen for the free tier's 625k TPM / 3.13 RPS (vs `mistral-small`'s 20k TPM → 429s). `max_tokens=800`. |
| Embeddings | `mistral-embed` (1024-dim) | `nomic-embed-text` (768-dim) | must match the `vector(n)` column in `data/schema.sql`; `EMBED_DIM` is substituted at DB init. |
| L1 moderation (standalone) | `mistral-moderation-latest` | — (none on local) | the `/v1/moderations` call that blocks input. |
| L1 inline guardrail | `moderation_llm_v2` | — | declared on the chat request. |
| L2 expert guard | `shieldstral` (vLLM) | same | scores yes/no from token logprobs; **`cached` mode by default** (replays), `live` with `SHIELDSTRAL_URL`. |

Key consequence: a small chat model in lower-resource languages (Swahili, Gikuyu)
is weak on domain vocabulary — hence the prompt's "keep numbers/units/key terms in
English" rule (`prompts/coffee.md`, `Docs/LANGUAGE-AND-HARDEN-PLAN.md`). And on a
**local** model there is **no L1** at all, so L2 carries the whole input defence.

## 3. The request path, end to end

```text
member ─▶ UI (/api proxied by nginx) ─▶ gateway
                                          │
                                          ├─ identify        who is this phone, budget check
                                          ├─ L1 input guard   Mistral moderation on the message
                                          ├─ L2 expert guard  Shieldstral questions on the input
                                          ├─ retrieve         pgvector + provenance (trusted vs not)
                                          ├─ model            chat call; tool schemas from PINNED servers
                                          ├─ L4 tool gate     allow / cap / park / refuse each tool call
                                          ├─ L2 expert guard  Shieldstral questions on the draft reply
                                          ├─ L3 registry      dealer / product / dose / plot checks (code)
                                          └─ audit            every verdict to Postgres + SSE feed
                                          │
          MCP tools ◀─────────────────────┤  kahawa-tools (honest), n8n (side effects), farm-weather (rogue)
          Postgres / Redis ◀──────────────┘
```

Each step publishes a **verdict** to an event bus; the UI's verdict feed is that
stream, which is how the room watches a layer allow / flag / park / refuse live.

## 4. The gateway pipeline — the nine steps

`gateway/app/main.py`, `/api/chat`. Each step is a module in
`gateway/app/pipeline/` and is gated by a switch in the admin panel.

| # | Step | Module | What it does |
| --- | --- | --- | --- |
| 1 | identify | `identify.py` | SHA256-hash the phone (never a dialable number reaches model/audit), load session, check budget |
| 2 | L1 input guard | `input_guard.py` | Mistral moderation on the message; block ≥0.5 on jailbreak/pii/etc. **Fails open** on API error |
| 3 | L2 expert guard (in) | `expert_guard.py` | Shieldstral scores the pack's input questions |
| 4 | retrieve | `retrieve.py` | pgvector search; label chunks trusted/untrusted by uploader role |
| 5 | model | `model.py` | chat call; tool schemas only from allowlisted + pinned servers; agent tool-loop up to `max_tool_rounds` |
| 6 | L4 tool gate | `tool_gate.py` | for each proposed tool call: allow / cap / park(confirm) / refuse |
| 7 | L2 expert guard (out) | `expert_guard.py` | scores the pack's output questions on the draft reply |
| 8 | L3 registry | `registry.py` | code checks against live tables; one constrained retry then safe template |
| 9 | audit | `audit.py` | write every verdict to `audit_events`; stream to the panel |

Supporting modules: `mcp/client.py` (MCP client + which tools to offer),
`mcp/pinning.py` (tool-list hash compare), `packs/loader.py` (packs + the six
switches), `llm/` (Mistral/Ollama providers), `events.py` (the verdict bus),
`db.py`, `config.py`, `redteam.py` (scores the attack set).

## 5. The guards, one by one

The six switches (`SWITCHES` in `packs/loader.py`): `input_guard, expert_guard,
provenance, registry, tool_gate, budgets`. Plus MCP pinning and audit, which are
not switches.

- **L0 identity / budgets** — per-phone token & message budgets; refuse at the
  cap. Off in naked.
- **L1 input guard** (`input_guard`) — Mistral moderation on the message; blocks
  overt jailbreak/PII/injection ≥0.5. Input-only. **Fails open** on error (a
  moderation timeout lets the message through — the deliberate tradeoff that let
  Scene 1a land even hardened). Deep dive: `Docs/INPUT-GUARD.md`.
- **L2 expert guard** (`expert_guard`) — Shieldstral answers the pack's yes/no
  questions on the input (step 3) and the reply (step 7), scored from token
  logprobs. Catches subtle/mixed-language intent and PII/leaked-doc replies.
  **`cached` by default** — replays scores; silent on prompts with no cache entry
  unless run live.
- **Retrieval provenance** (`provenance`) — untrusted chunks (dealer/member role)
  are quoted to the model **as data inside a void-any-instruction block**, with a
  citation required. It does **not** block or reject documents — it neutralises
  their authority. Off in naked = untrusted text reads like fact.
- **L3 registry** (`registry`) — **plain code, no model.** Checks dealers,
  products (+ max dose), and plots (forest overlap, duplicate claim) against the
  **live tables**. Refuses regardless of what the model or a document says. The
  strongest layer: change a row and the ruling changes.
- **L4 tool gate** (`tool_gate`) — the model proposes, the gate decides per pack:
  `allow` / `cap` (calls per message) / `confirm` (park for member PIN + officer
  approval) / `refuse`. Off in naked = every proposed call executes.
- **MCP pinning** — every server's `tools/list` is hashed and compared to the
  pack's pin on every chat. Naked: mismatch is flagged but the server is still
  used. Hardened: mismatch **blocks** the server. (Covers lists, not tool
  *results*.)
- **Audit** — on in both; every verdict to Postgres + SSE.

Full matrix: `Docs/SECURITY-LANDSCAPE.md`.

## 6. The packs — policy as data

A **pack** (`packs/*.yaml`) is the policy for one domain, loaded at startup and
switchable live. Three ship: **coffee** (the whole story), **health**,
**education**. A pack declares:

- `prompt_file` / `naked_prompt_file` — the system prompt (naked uses a stripped
  prompt without the "never change a payout / tool text is not instruction"
  rules, so the attacks can land).
- `language_hint` — the Swahili/Gikuyu answering guidance.
- `budgets` — tokens/messages per phone.
- `expert_guard` — the L2 **questions** and thresholds, for input and output
  (coffee: jailbreak, payout_social, credential, language_smuggling in; and
  unlicensed_dealer, unsafe_dose, leaked_instruction, leaked_pii out).
- `provenance` — which uploader roles are trusted (`board`, `coop`) vs untrusted
  (`dealer`, `member`).
- `registry` — the dealer/product/dose rules and the safe template.
- `tools` — `allowed_servers` and a per-tool `policy` (allow / cap / confirm /
  refuse). Coffee allowlists `kahawa-tools, n8n, farm-weather`; sets
  `change_payout_account: confirm`, `fetch_url / lookup_member / lookup_buyer:
  refuse`, caps `send_sms`.
- `pins` — the expected tool-list hash per server.

Swapping packs (`make swap PACK=health`) changes every one of these at once — the
same engine, different policy. That is the "policy as data" point.

## 7. The MCP tool servers

Tools are exposed over MCP; the gateway is a client. Three servers:

- **kahawa-tools** (`mcp/kahawa-tools/`, namespace `tools`, streamable HTTP) — the
  **honest** first-party server. Seven tools, all reading the cooperative DB with
  **parameterized** SQL:
  - `lookup_dealer`, `lookup_payment_status`, `get_extension_notes`, `check_plot`
    — the legitimate four (allowed).
  - `fetch_url` — a general-purpose fetch (the Scene 3b SSRF vector; pack
    **refuses** it).
  - `lookup_member`, `lookup_buyer` — sensitive reads (member PII; buyer bank
    details) that exist because "the whole DB got wired into tools"; pack
    **refuses** them (Scenes 5/6).
- **farm-weather** (`mcp/farm-weather/`, namespace `attacker`) — the **rogue**
  server. One tool, `get_forecast`, whose description hides an instruction to call
  `change_payout_account` with the attacker's `ACC-99999`. Has a `RUG_PULL` mode
  that changes the description after the pin is taken (Scene 3).
- **records-fs** (`mcp/records-fs/`, namespace `tools`, stdio) — **vulnerable by
  design.** `read_record` confines reads to `/srv/records` with a bare string
  prefix check, reproducing the EscapeRoute CVEs (53109/53110). Scene 3c; the real
  boundary is Tetragon, underneath it.

How tools reach the model: `mcp/client.py` offers schemas only from allowlisted,
pinned, reachable servers. When the **tool gate is on**, pack-`refuse` tools are
not even described to the model; when it's **off (naked)**, every reachable tool
is offered so the attacks can land.

## 8. The n8n side-effect workflows

Real side effects live in **n8n** (`n8n/workflows/`), exposed to the gateway as an
MCP server via one **MCP Server Trigger** (`kahawa_mcp.json`, path `/mcp/kahawa`)
with three Workflow Tool nodes:

- `change_payout_account` — a real `UPDATE members.payout_account_ref` (the Scene
  3 money move). Pack policy: `confirm` (parked for member PIN + officer
  approval).
- `send_sms` — sends via Africa's Talking REST (no dedicated n8n node; an HTTP
  Request node with a Header-Auth credential set once in n8n's UI). Capped.
- `send_parent_report` — education-pack tool; refused by coffee.

`n8n/seed.sh` imports and activates the workflows on every pod start (n8n state is
an `emptyDir`). In naked, n8n's Code and Execute-Command nodes are enabled and the
MCP trigger is unauthenticated; in hardened those nodes are removed and the
trigger requires a bearer token matching the one the gateway reads from Vault.
Background: `Docs/SCENE3-ATTACK.md`, README's Africa's Talking setup section.

## 9. The data layer

Postgres (**PostGIS + pgvector**) + Redis, namespace `data`. Everything is
invented/synthetic.

- **Schema** (`data/schema.sql`): `members` (+ PII columns), `plots` (geometry),
  `forest_2020` (the hand-drawn protected-forest fixture), `dealers`, `products`,
  `payments`, operational tables (`deliveries`, `advances`, `grading`, `sacco`),
  the corporate layer (`buyers`, `contracts`), `documents` + `chunks`
  (embeddings), `pending_actions` (parked tool calls), `audit_events`.
- **Seed** (`scripts/seedgen.py` → `data/seed/*`): a **deterministic** generator
  (`--seed 42`) producing ~**300 members**, ~550 payments, thousands of
  deliveries, 8 buyers, etc. — realistic shape, obviously-synthetic values (fake
  ID prefix `99…`, reserved phone ranges, `.example` emails). The **attack
  fixtures are pinned verbatim and asserted** at the end of a run (KG-0003 in the
  forest, KG-0001↔KG-0004 overlap, KG-0005 clean, DL-0045 revoked, Rapid Grow
  Booster unregistered), so a reseed never breaks a scene.
- **How it loads:** `scripts/_seed.py` emits SQL from the CSVs/GeoJSON;
  `scripts/reset.sh` TRUNCATEs + reloads + re-uploads the trusted notes.
- **Two change paths (important):** **rows → `make reset`**; **schema → `make
  deploy` + Postgres restart, then `make reset`** (the init hook only runs on an
  empty `emptyDir`). Full detail: `Docs/HOW-TO-SEED.md`.
- **The presenter's cheat-sheet** of who's who in the seed (which member is the
  forest plot, which buyer leaks, etc.): `Docs/PRESENTER-ATTACK-MAP.md`.

## 10. The two profiles

Same code, same images; the difference is which controls are on.

| | Naked | Hardened |
| --- | --- | --- |
| Guard switches | off | on |
| System prompt | `coffee.naked.md` (rules stripped) | `coffee.md` (full) |
| MCP pins | reported (flag) | enforced (block) |
| Tools offered to model | all reachable | pack-refused ones hidden |
| Secrets | plain env Secret | Vault + External Secrets |
| Admin API | open | `X-Admin-Token` required |
| Pod security | root, SA token mounted, RW rootfs | non-root, no token, RO rootfs, restricted ns |
| Network | open | Cilium default-deny + explicit allows |
| Runtime | none | Tetragon kills/observes |
| Admission | none | Kyverno enforce |
| n8n | Code/Exec nodes on, no MCP auth | nodes removed, bearer token |
| Point | the attacks land | the attacks are stopped |

Two levels of switching: **guard switches live** (no redeploy, covers Scenes
1–3), or the **full profile** via `make harden` / `make naked`. Which to use per
scene and every command: `Docs/SWITCHING-PROFILES.md` and `Docs/HOW-TO-HARDEN.md`.

## 11. The platform layers

Installed by `make platform` (Cilium, Tetragon, Kyverno, Vault + External
Secrets). Policies applied by `make harden`. All **hardened-only**.

- **Cilium** (`deploy/policies/cilium/`) — `default-deny` across all six
  namespaces; `gateway-egress` (gateway reaches only DNS, tools L7 `/mcp`, n8n,
  Postgres, Redis); `tools-ingress-l7`; `n8n-egress`; `deny-cloud-metadata`
  (clusterwide egress deny to 169.254.169.254); per-provider model-egress rule.
- **Tetragon** (`deploy/policies/tetragon/`) — `confine-records-fs` (Sigkill the
  3c escape on the real kernel open), `block-shells-in-tool-pods`,
  `kill-metadata-connect`, `watch-sa-token-reads` (observe). Deep dive +
  how-to-run: `Docs/TETRAGON-LAB.md`.
- **Kyverno** (`deploy/policies/kyverno/`) — `allowed-registries`,
  `disallow-latest`, `require-limits`. The "could this have shipped?" backstop
  (`make prove-admission`).
- **Vault + External Secrets** — hold the Mistral key and the n8n/admin tokens in
  hardened (`make vault-seed`).

## 12. The scenes

Driven by `scenes/*.sh` (POST to the gateway, print reply + verdicts). Full
narration and per-scene setup: `Docs/SCENES.md`; targets at risk and tells:
`Docs/PRESENTER-ATTACK-MAP.md`.

| Scene | Attack | Naked | Hardened |
| --- | --- | --- | --- |
| 1 | mixed-language jailbreak | model obeys / confabulates | L1 + L2 block |
| 2 | poisoned retrieval (fake circular) | recommends revoked dealer + unregistered product | provenance + **L3 registry** refuse |
| 3 | rogue tool → redirected payout | `change_payout_account` fires; row → ACC-99999 | **L4 tool gate** parks it; pin catches rug pull |
| 3b | SSRF → cloud metadata | fake creds returned | Cilium drop + Tetragon kill |
| 3c | file-server sandbox escape | prefix + symlink leak the secret | Tetragon kills on the real open (exit 137) |
| 4 | laundered plot (EUDR) | overlap ignored | **L3 registry** / `check_plot` flags it |
| 5 | member PII leak (injected doc) | `lookup_member` leaks KG-0002's record | tool gate refuses + L2 `leaked_pii` |
| 6 | buyer bank leak (injected doc) | `lookup_buyer` leaks BUY-0001's account | tool gate refuses + L2 |
| 7 | SQL injection | — does **not** land | parameterized queries (always on, not a toggle) |

## 13. The UI

`ui/` — React + Vite single page, served by unprivileged nginx proxying `/api` to
the gateway. Three surfaces:

- **member/** — the phone chat (WhatsApp/SMS/USSD channels), including the
  document-attach control that is the indirect-injection vector for Scenes 2/5/6.
- **ops/** — the operator console: the live verdict feed, layer switches, pending
  (parked) actions, spend meter, server/pin state.
- **present/** — the presenter view and attack launcher for driving scenes on
  stage.

The verdict feed is the `/api/events` SSE stream. API contract & gaps:
`ui/NOTES.md`.

## 14. Namespaces & trust zones

| Namespace | Workloads | Trust |
| --- | --- | --- |
| `gateway` | the FastAPI gateway | the only thing allowed to reach model+tools+DB |
| `kahawa-ui` | nginx + React SPA | serves UI, proxies `/api` |
| `tools` | kahawa-tools (honest), records-fs (vulnerable) | semi-trusted; L7-restricted ingress |
| `n8n` | n8n (real side effects) | side-effect tier; bearer-gated in hardened |
| `data` | Postgres, Redis | data tier; reachable only from gateway/n8n |
| `attacker` | farm-weather (rogue), fake-imds (metadata) | hostile by design; unreachable in hardened |

## 15. Everyday commands

```bash
# bring-up
cp .env.example .env            # add your Mistral key, or LLM_PROVIDER=ollama
make up                         # kind + platform + images + naked deploy
make ui                         # chat + ops console on :8080
make forward                    # port-forward UI/gateway/tools/n8n

# run the story
make reset                      # reseed + clear verdicts (before EVERY scene)
make scene1 … scene7            # the scenes
./scripts/admin.sh layers tool_gate=on   # flip a single guard live
make harden / make naked        # full profile switch (then make reset)

# MCP & ops
make mcp-forward ; make mcp-check ; make mcp-pin
make events / events-all / events-3c     # Tetragon stream (hardened)
make hubble                     # Cilium flow UI
make redteam                    # score the attack set
make down                       # throw the cluster away
```

`make help` lists everything.

## 16. Repo layout

```text
gateway/app/     the brain: main.py pipeline, pipeline/ (one file per guard),
                 llm/ (mistral|ollama), mcp/ (client + pinning), packs/loader.py
packs/           coffee | health | education — policy as data
prompts/         system prompts (coffee + coffee.naked, health, education)
mcp/             kahawa-tools (honest 7) | farm-weather (rogue) | records-fs (vulnerable) | tests
n8n/             kahawa_mcp + change_payout / send_sms / send_parent_report + seed.sh
attacker/        fake-imds (cloud-metadata stand-in, Scene 3b target)
data/            schema.sql, postgres image, seed/ (synthetic CSVs + GeoJSON + planted docs)
scripts/         seedgen.py, _seed.py, reset.sh, admin.sh, mcp-pin.sh, port-forwards.sh
deploy/          kind config, platform/ install values, helm/ chart, policies/ (cilium|tetragon|kyverno)
scenes/          scene1..7, 3b, 3c, _common.sh
ui/              React SPA: member/ ops/ present/
redteam/         the Gikuyu/Swahili/English attack set
Docs/            all the deep-dive docs (see §18)
Makefile versions.mk README.md ROOT.md
```

## 17. The honest caveats

Say these plainly — they are what make the rest credible (collected from live
runs; full list in `Docs/SECURITY-LANDSCAPE.md §10` and `Docs/PROVE-IT.md`):

- **The chat model, tools, DB, registry, tool gate, Cilium and Tetragon are all
  live.** The L2 expert guard is **`cached` by default** (replays scores; the UI
  labels it). L1 is always live.
- **L1 fails open** — a moderation timeout lets the message through (why Scene 1a
  can land even hardened). A deliberate availability tradeoff.
- Attacks that depend on the model biting are **probabilistic** (~7/10 for the
  payout) — fire 2–3 times.
- **MCP pins cover tool *lists*, not tool *results*** — a pinned server can still
  return a poisoned payload.
- **Scene 3b** targets `fake-imds`, not `169.254.169.254`, so the *named* metadata
  policies don't fire as written — default-deny drops it; point `fetch_url` at the
  metadata IP for the named policies.
- **Hardened hasn't been brought up fully end-to-end** — known blockers: Kyverno
  `allowed-registries` rejects n8n's image; the Cilium allows omit Postgres/Redis
  ingress and kahawa-tools egress; `RUNBOOK` still omits the n8n token/Vault seed.
- **Postgres is an `emptyDir`** — any restart wipes rows; always `make reset`.

## 18. Where to go next (doc map)

| You want… | Read |
| --- | --- |
| This overview | **ROOT.md** (you are here) |
| Folder-by-folder architecture + attack/defence matrix | `Docs/ARCHITECTURE.md` |
| What each scene does, step by step | `Docs/SCENES.md` |
| The presenter cheat-sheet (targets, tells, proofs) | `Docs/PRESENTER-ATTACK-MAP.md` |
| The full defence surface, naked vs hardened, per layer | `Docs/SECURITY-LANDSCAPE.md` |
| The input guard (L1) in depth | `Docs/INPUT-GUARD.md` |
| The runtime layer (Tetragon) lab | `Docs/TETRAGON-LAB.md` |
| Switching profiles | `Docs/SWITCHING-PROFILES.md`, `Docs/HOW-TO-HARDEN.md` |
| Seeding / changing the database | `Docs/HOW-TO-SEED.md`, `Docs/SEED-PLAN.md` |
| Prove nothing is faked | `Docs/PROVE-IT.md` |
| Scene 3 (the payout) in depth | `Docs/SCENE3-ATTACK.md` |
| Raw build, by hand (Linux / Mac) | `Docs/RUNBOOK.md`, `Docs/RUNBOOK-MAC.md` |
| Cluster networking failures & fixes | `Docs/NETWORKING-POSTMORTEM.md` |
| Language/model quality reasoning | `Docs/LANGUAGE-AND-HARDEN-PLAN.md` |
| The running fix/progress log | `Docs/PROGRESS.md` |
| Quick start & layout | `README.md` |
