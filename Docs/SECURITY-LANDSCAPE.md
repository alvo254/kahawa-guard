# Security Landscape — naked vs hardened, layer by layer

The whole defence surface of Kahawa Guard in one place: every layer from the
application pipeline down to the kernel and admission control, what each one
protects against, and **exactly what is on in naked vs hardened.** Written
against the live code and policy, including the honest gaps.

> **The two profiles are the same code and the same images.** The difference is
> which controls are switched on. *Naked* = controls off, the attacks land.
> *Hardened* = controls on + Kubernetes network/runtime/admission policy, the
> attacks are stopped. Set with `make deploy PROFILE=naked|hardened`; `make
> harden` also applies the Cilium/Tetragon/Kyverno policy.

> **The repeating principle:** the component closest to an attack is the one you
> cannot trust to stop it (the model will follow a planted instruction; a
> vulnerable server mis-validates its own paths; a prompt rule is only a
> request). So each control sits at the **lowest layer that can actually
> enforce** the decision.

## Table of contents

1. [The layer stack at a glance](#1-the-layer-stack-at-a-glance)
2. [The master matrix (naked vs hardened)](#2-the-master-matrix-naked-vs-hardened)
3. [Application layer](#3-application-layer)
   1. [L0 · Identity, session & budgets](#31-l0--identity-session--budgets)
   2. [L1 · Input guard (Mistral moderation)](#32-l1--input-guard-mistral-moderation)
   3. [L2 · Expert guard (Shieldstral)](#33-l2--expert-guard-shieldstral)
   4. [Retrieval provenance](#34-retrieval-provenance)
   5. [L3 · Registry (dealers/products/plots)](#35-l3--registry-dealersproductsplots)
   6. [L4 · Tool gate](#36-l4--tool-gate)
   7. [MCP tool-list pinning](#37-mcp-tool-list-pinning)
   8. [Audit](#38-audit)
4. [Platform layer](#4-platform-layer)
   1. [Secrets management (env vs Vault)](#41-secrets-management-env-vs-vault)
   2. [Admin API authentication](#42-admin-api-authentication)
   3. [Pod security (identity, filesystem, SA token)](#43-pod-security-identity-filesystem-sa-token)
   4. [n8n node & auth posture](#44-n8n-node--auth-posture)
5. [Network layer (Cilium)](#5-network-layer-cilium)
6. [Runtime layer (Tetragon)](#6-runtime-layer-tetragon)
7. [Admission layer (Kyverno)](#7-admission-layer-kyverno)
8. [Attack → layer-that-stops-it](#8-attack--layer-that-stops-it)
9. [Namespaces & trust zones](#9-namespaces--trust-zones)
10. [Known gaps & honest caveats](#10-known-gaps--honest-caveats)

## 1. The layer stack at a glance

A request, and the layers it passes on the way down to real effect:

```text
                         NAKED                         HARDENED
member message
  │
  ├─ L0 identify/budget   session only, budget OFF      session + per-phone budget
  ├─ L1 input guard       OFF                           Mistral moderation (fail-open)
  ├─ L2 expert guard      OFF                           Shieldstral scoring (cached/live)
  ├─ retrieval provenance OFF (untrusted unmarked)      untrusted quoted as data
  ├─ model call           tools = ALL offered           refused tools not offered
  ├─ L4 tool gate         OFF (every call executes)     allow/cap/park/refuse
  ├─ MCP pinning          reported only (flag)          enforced (block on mismatch)
  ├─ L3 registry          OFF                           dealer/product/dose/plot checks
  └─ audit                on                            on
          │
   ── Kubernetes ────────────────────────────────────────────────────────────
  secrets                 plain env Secret              Vault + External Secrets (files)
  admin API               open                          X-Admin-Token required
  pod security            root ok, SA token mounted     non-root, RO-rootfs, no SA token
  network (Cilium)        open                          default-deny + explicit allows
  runtime (Tetragon)      none                          kprobes kill/observe
  admission (Kyverno)     none                          registries / no :latest / limits
  n8n                     Code+Exec nodes, no MCP auth   nodes removed, MCP bearer token
```

## 2. The master matrix (naked vs hardened)

| # | Layer | Protects against | Naked | Hardened |
| --- | --- | --- | --- | --- |
| L0 | Identity / budget | abuse, cost/volume floods | session only, **budget off** | per-phone token+message budget, refuse at cap |
| L1 | Input guard | overt jailbreak / PII / injection in the *message* | **off** | Mistral moderation ≥0.5 blocks (fail-open) |
| L2 | Expert guard | subtle, domain/mixed-language intent (in & out) | **off** | Shieldstral yes/no per pack question |
| — | Provenance | retrieved docs treated as instructions | **off** (untrusted unmarked) | untrusted quoted as data, citation required |
| L3 | Registry | bad dealer/product/dose, laundered plot | **off** | live table checks, retry-then-safe-template |
| L4 | Tool gate | unauthorised/overused tool calls, payout theft | **off** (all execute) | allow / cap / park / refuse per pack |
| — | MCP pinning | rug-pulled or rogue tool lists | reported, **not enforced** | **block** server on hash mismatch |
| — | Audit | no forensics | on | on |
| — | Secrets | key theft from env/exec | plain env Secret | Vault + ESO, mounted files |
| — | Admin API | anyone toggling guards / swapping packs | **open** | `X-Admin-Token` required |
| — | Pod security | container breakout, token theft | root, RW rootfs, **SA token mounted** | non-root, RO rootfs, **no SA token**, restricted ns |
| — | Network | lateral movement, SSRF, egress | **open** | Cilium default-deny + explicit allows |
| — | Runtime | shells, FS escape, metadata, token read | **none** | Tetragon kprobes (kill/observe) |
| — | Admission | bad image, `:latest`, no limits | **none** | Kyverno enforce |
| — | n8n | code execution, unauth MCP side effects | Code+Exec nodes on, **no MCP auth** | nodes removed, **bearer token** required |

## 3. Application layer

The gateway (FastAPI) is the only workload allowed to talk to the model, the
tools and the database, which is why every app-layer control lives inside it.
Each is a switch in the admin panel (`SWITCHES` in `packs/loader.py`):
`input_guard, expert_guard, provenance, registry, tool_gate, budgets`.

### 3.1 L0 · Identity, session & budgets

- **Protects against:** anonymous abuse and cost/volume floods (a single phone
  driving unlimited tokens or messages).
- **How:** `pipeline/identify.py` hashes the phone (one-way SHA256, never a
  dialable number reaches the model or the audit log) and tracks per-phone
  token/message counts. Budgets from the pack (`budgets.tokens_per_phone_per_day`,
  `messages_per_phone_per_hour`, `on_exceeded: refuse`).
- **Naked:** identity still runs (you need a session), but the **`budgets`
  switch is off** — no cap is enforced.
- **Hardened:** `budgets` on — over-budget requests return the budget refusal
  before the model is called.

### 3.2 L1 · Input guard (Mistral moderation)

- **Protects against:** overt, well-known hostile input in the member's
  message — jailbreak, prompt-injection, PII solicitation, self-harm, violence.
- **How:** step 2 calls `/v1/moderations` (`mistral-moderation-latest`); blocks
  when any of `prompt_injection, jailbreak, pii, selfharm, violence` scores ≥0.5.
  A second, inline guardrail (`moderation_llm_v2`) is also declared on the chat
  call. **Input-only** — never sees the reply. Full detail in `INPUT-GUARD.md`.
- **Naked:** off.
- **Hardened:** on — e.g. Scene 1b/1c block with `pii 1.00` / `jailbreaking 1.00`.
- **Caveat:** **fails open** — if the moderation API errors/times out, the
  message is allowed through (so a flaky API never bricks the demo). That is why
  Scene 1a's overt override can still land even hardened. See `INPUT-GUARD.md §7`.

### 3.3 L2 · Expert guard (Shieldstral)

- **Protects against:** the *subtle* intent L1's categories miss — a
  mixed-language smuggle, social-engineering a payout, and (on the way out) a
  reply that leans on an untrusted document or leaks PII.
- **How:** steps 3 (input) and 7 (output). Shieldstral answers the pack's yes/no
  questions, scored from token log-probabilities; a score ≥ the question's
  threshold blocks. Coffee pack questions: `jailbreak, payout_social, credential,
  language_smuggling` (in) and `unlicensed_dealer, unsafe_dose,
  leaked_instruction, leaked_pii` (out).
- **Naked:** off.
- **Hardened:** on — but runs in **`SHIELDSTRAL_MODE=cached` by default**: it
  *replays* scores keyed on exact prompt text, so it only scores prompts in
  `shieldstral_cache.json`. On un-cached prompts it shows `no scores` and
  contributes nothing. Set `SHIELDSTRAL_MODE=live` (+ `SHIELDSTRAL_URL`) for live
  judgement. The UI labels cached scores as cached.
- **Caveat:** on the local Ollama provider there is **no L1**, so L2 carries the
  entire input-side defence.

### 3.4 Retrieval provenance

- **Protects against:** indirect prompt injection — a retrieved document's text
  being obeyed as an instruction (Scene 2's fake circular).
- **How:** `pipeline/retrieve.py` labels chunks by the uploader's role
  (`trusted_roles: [board, coop]` vs untrusted `[dealer, member]`). With
  provenance on, untrusted chunks are passed to the model **inside a quoted block
  that says any instruction within is void**, and a citation is required.
- **Naked:** off — untrusted text is unmarked and reads like a cooperative
  record (the `retrieve` verdict says *"provenance switch OFF, untrusted text
  unmarked"*).
- **Hardened:** on — the forgery's words still reach the model, but labelled as
  an unverified claim, not an order.

### 3.5 L3 · Registry (dealers/products/plots)

- **Protects against:** acting on a bad recommendation regardless of what the
  model or a document says — an unlicensed dealer, an unregistered product, an
  over-max dose, a forest-overlapping or duplicate plot.
- **How:** `pipeline/registry.py` — **plain code, no model.** Reads the live
  `dealers`, `products`, `plots`/`forest_2020` tables. On failure: one
  constrained retry, then a safe template. This is what refuses Scene 2 and flags
  Scene 4 *regardless of the model*.
- **Naked:** off.
- **Hardened:** on — `blocked_by: registry`, safe template returned.
- **Why it's strong:** it does not depend on the model behaving; change a row in
  Postgres and the ruling changes (`PROVE-IT.md §C`).

### 3.6 L4 · Tool gate

- **Protects against:** the model being talked into an action it should not take
  — redirecting a payout, over-calling SMS, invoking a refused tool.
- **How:** `pipeline/tool_gate.py` — the model *proposes*, the gate *decides*,
  per pack: `allow` / `cap` (calls per message) / `confirm` (park for member PIN
  + officer approval) / `refuse`. `change_payout_account` is `confirm`; `fetch_url`,
  `lookup_member`, `lookup_buyer` are `refuse`.
- **Naked:** off — **every proposed call simply executes** (Scene 3: the payout
  fires; the leak tools run).
- **Hardened:** on — the payout is **parked**, caps bound SMS, refused tools are
  never even offered to the model.
- **Note (the bug that was fixed):** refused tools are now offered to the model
  *in naked only* so the attacks can reach them; when the gate is on they are
  hidden again (`mcp/client.py` `tool_schemas`).

### 3.7 MCP tool-list pinning

- **Protects against:** a rug pull (a pinned server changing a tool's description
  after the pin) and a rogue/altered tool list.
- **How:** `mcp/pinning.py` hashes each server's sorted `tools/list` and compares
  to the pack's pin, re-checked on every chat.
- **Naked:** mismatch is **reported** (flag) but the server is still used.
- **Hardened:** mismatch **blocks** the server — its tools are not offered.
- **Scope caveat:** the pin covers `tools/list`, not tool *results*. A server
  that passed its pin can still return a malicious payload (exactly Scene 3's
  `advisory`/result-note vector).

### 3.8 Audit

- **Protects against:** having no forensic record.
- **How:** every verdict from every layer is written to `audit_events` in
  Postgres, and streamed to the panel over SSE.
- **Naked & hardened:** on in both. (One known reporting quirk: `/api/chat` can
  return `verdicts: []` once the ring buffer fills; the live SSE feed and the DB
  are unaffected — `PROVE-IT.md §2`.)

## 4. Platform layer

### 4.1 Secrets management (env vs Vault)

- **Protects against:** reading the Mistral key / tokens straight out of the pod
  environment (anything that can exec in or read `/proc`).
- **Naked:** a plain Kubernetes `Secret` rendered from values, injected as **env
  vars** (`secretsFromVault: false`). Convenient, and readable by anything in the
  pod.
- **Hardened:** `secretsFromVault: true` — an **ExternalSecret** pulls
  `mistral_api_key`, `n8n_mcp_token`, `admin_token`, `shieldstral_api_key` from
  **Vault** at `secret/kahawa` and mounts them as files read at startup. Seed with
  `make vault-seed` (dev root token `root`). See `HOW-TO-HARDEN.md §5`.

### 4.2 Admin API authentication

- **Protects against:** anyone flipping guard switches, swapping packs, or
  resetting state via `/api/admin/*`.
- **How:** `require_admin` dependency checks `X-Admin-Token` against the
  `admin_token` when `adminTokenRequired` is true.
- **Naked:** **open** — no token (this is itself a thing the demo shows being
  closed).
- **Hardened:** required — `./scripts/admin.sh … --token "$ADMIN_TOKEN"`, and the
  UI built with `VITE_ADMIN_TOKEN`.
- **Caveat:** read-only telemetry (`/api/admin/state`, `/api/events`) stays open
  in both — the gap flagged in `ui/NOTES.md §6.1`.

### 4.3 Pod security (identity, filesystem, SA token)

- **Protects against:** container breakout, tampering with the running image, and
  service-account-token theft to talk to the API server.
- **Naked:** `runAsNonRoot: false`, `readOnlyRootFilesystem: false`,
  `automountServiceAccountToken: true` — root allowed, writable rootfs, the SA
  token is mounted and readable.
- **Hardened:** `runAsNonRoot: true`, `readOnlyRootFilesystem: true` (tmp is an
  emptyDir), `automountServiceAccountToken: false`, namespaces labelled Pod
  Security `restricted`, resource quotas on.

### 4.4 n8n node & auth posture

- **Protects against:** arbitrary code execution inside n8n and unauthenticated
  triggering of real side effects (SMS, payout change).
- **Naked:** `nodesExclude: ""` — the **Code and Execute-Command nodes are
  enabled**; the MCP Server Trigger and webhooks are **unauthenticated**
  (`requireMcpToken: false`).
- **Hardened:** `nodesExclude` removes `executeCommand` and `code`; the MCP
  trigger **requires a bearer token** that must match the one the gateway reads
  from Vault (mismatch → 403, tools vanish). See `HOW-TO-HARDEN.md §5`.

## 5. Network layer (Cilium)

Kind runs without kube-proxy; Cilium is the CNI and the policy engine, with
Hubble for flow visibility. **All policy below is hardened-only** — naked has no
network policy at all, so every pod can reach every pod (and the internet).

| Policy | File | Protects against | Effect |
| --- | --- | --- | --- |
| `default-deny-kahawa` | `cilium/default-deny.yaml` | lateral movement | clusterwide deny (ingress+egress) across `kahawa-ui, gateway, tools, n8n, data, attacker`; everything else must be allowed back explicitly |
| `gateway-egress` | `cilium/gateway-egress.yaml` | an agent pivoting sideways | gateway may reach only DNS, kahawa-tools (L7: `GET/POST/DELETE /mcp`), n8n:5678, Postgres:5432, Redis:6379 |
| `tools-ingress-l7` | `cilium/tools-ingress-l7.yaml` | anything but the gateway calling tools | kahawa-tools accepts only `GET/POST/DELETE /mcp` from the gateway |
| `n8n-egress` | `cilium/n8n-egress.yaml` | n8n reaching anything it shouldn't | n8n may reach DNS, Postgres, and Africa's Talking FQDNs (443) only; ingress only from the gateway |
| `deny-cloud-metadata` | `cilium/deny-metadata.yaml` | SSRF to cloud metadata | clusterwide egress **deny** to `169.254.169.254/32` from every endpoint |
| `gateway-egress-model-*` | `cilium/providers/{mistral,ollama}.yaml` | exfil to arbitrary hosts | gateway may reach only `api.mistral.ai:443` (or the Ollama host) for the model |

- **Naked:** none of this — open egress is why Scene 3b's SSRF leaks.
- **Hardened:** the agent cannot reach the `attacker` namespace at all unless a
  rule permits it (which is why farm-weather becomes unreachable in full
  hardened — see `HOW-TO-HARDEN.md §6`), and the SSRF packet never leaves.

## 6. Runtime layer (Tetragon)

eBPF in the datapath; the gateway is not consulted and cannot fake these.
**Hardened-only** — applied by `make harden`.

| Policy | File | Protects against | Action |
| --- | --- | --- | --- |
| `block-shells` | `tetragon/block-shells.yaml` | a compromised tool image spawning a shell | **Sigkill** any shell exec in a tool-tier pod (kahawa-tools, farm-weather, records-fs, n8n) |
| `confine-records-fs` | `tetragon/confine-records-fs.yaml` | the records-fs sandbox escape (Scene 3c) | **Sigkill** on a real `security_file_open` that resolves under `/srv/records-evil/` — judges the kernel open, not the path string the buggy server validated (the symlink's "allowed" string still resolves into the forbidden dir and is killed) |
| `kill-metadata-connect` | `tetragon/kill-metadata-connect.yaml` | SSRF to metadata (Scene 3b) | **Sigkill** the process that `tcp_connect`s to `169.254.169.254` (Cilium already dropped the packet; this makes the process *gone*) |
| `watch-sa-token` | `tetragon/watch-sa-token.yaml` | service-account-token theft | **observe-only** — records a read of the mounted SA token as evidence |

- **Naked:** none — a shell, a path escape, a metadata connect all proceed.
- **Hardened:** killed (or recorded) in the kernel, shown live via `make events`.

## 7. Admission layer (Kyverno)

The "this could not have shipped" backstop — it never fires during a scene; it
rejects bad pod specs at admission. **Hardened-only** (`make harden` applies it;
`make prove-admission` shows it).

| Policy | File | Protects against | Rule |
| --- | --- | --- | --- |
| `allowed-registries` | `kyverno/allowed-registries.yaml` | an image from an untrusted registry | only `kahawa/*` or `docker.io/library/*` in `kahawa-ui, gateway, tools, n8n, data` |
| `disallow-latest` | `kyverno/disallow-latest.yaml` | unpinned images | no `:latest` tag |
| `require-limits` | `kyverno/require-limits.yaml` | noisy-neighbour / resource exhaustion | every container must declare resource limits |

- **Naked:** none — the old naked pod spec admits.
- **Hardened:** enforced — `make prove-admission` shows the bad spec rejected.

## 8. Attack → layer-that-stops-it

| Attack (scene) | Lands in naked because… | Stopped in hardened by… |
| --- | --- | --- |
| Mixed-language jailbreak (1) | no input scoring | L1 input guard + L2 expert guard |
| Fake circular (2) | retrieved text trusted | provenance + L2 + **L3 registry** |
| Rogue tool payout (3) | tool gate off | **L4 tool gate** (park) + MCP pin |
| SSRF → metadata (3b) | open egress | Cilium `deny-metadata` + Tetragon `kill-metadata-connect` |
| FS sandbox escape (3c) | server validates its own paths | Tetragon `confine-records-fs` |
| Laundered plot (4) | submitted geometry trusted | **L3 registry** / `check_plot` |
| Member PII leak (5) | tool gate off, injected doc obeyed | L4 tool gate (refuse `lookup_member`) + L2 `leaked_pii` |
| Buyer bank leak (6) | tool gate off, injected doc obeyed | L4 tool gate (refuse `lookup_buyer`) + L2 `leaked_pii` |
| SQL injection (7) | — (does not land) | parameterized queries at the tool boundary (always on) |
| Shell in a tool pod | no runtime policy | Tetragon `block-shells` |
| SA-token read | unobserved | Tetragon `watch-sa-token` (records it) |
| Bad image / `:latest` / no limits | no admission control | Kyverno |

## 9. Namespaces & trust zones

Six workload namespaces, deny-all between them in hardened:

| Namespace | Workloads | Trust |
| --- | --- | --- |
| `gateway` | the FastAPI gateway | the only thing allowed to reach model+tools+DB |
| `kahawa-ui` | nginx + React SPA | serves UI, proxies `/api` |
| `tools` | kahawa-tools (honest), records-fs (vulnerable-by-design) | semi-trusted; L7-restricted ingress |
| `n8n` | n8n (real side effects: SMS, payout) | side-effect tier; bearer-gated in hardened |
| `data` | Postgres (PostGIS+pgvector), Redis | data tier; reachable only from gateway/n8n |
| `attacker` | farm-weather (rogue), fake-imds (metadata) | **hostile by design**; unreachable in hardened |

## 10. Known gaps & honest caveats

Say these plainly — they make the rest credible.

- **L1 fails open.** A moderation timeout lets the message through (Scene 1a).
  Availability-over-security by design; a strict deployment would fail closed.
  (`INPUT-GUARD.md §7`.)
- **L2 is cached by default.** It only scores prompts in
  `shieldstral_cache.json`; reworded scene prompts show `no scores`. Run
  `SHIELDSTRAL_MODE=live` for real L2 judgement.
- **MCP pin covers lists, not results.** A pinned server can still return a
  poisoned payload in a tool result.
- **Scene 3b's hardened story is mis-targeted.** It fetches `fake-imds`, an
  ordinary cluster service, not `169.254.169.254`, so the named
  `deny-cloud-metadata`/`kill-metadata-connect` policies don't fire — default-deny
  drops it instead. Point `fetch_url` at the metadata IP to trigger the named
  policies.
- **Hardened has not been brought up end-to-end.** Three things block a clean
  `make harden` today: Kyverno `allowed-registries` rejects n8n's
  `docker.io/n8nio/n8n` image; the Cilium allows omit ingress to Postgres/Redis
  and all egress from kahawa-tools (DNS included); and `RUNBOOK.md §14` still
  deploys hardened without the required `n8n.mcpToken`/Vault seed. (See the repo
  review.)
- **Tetragon `confine-records-fs`** now deny-lists `/srv/records-evil/` (the
  forbidden dir) rather than allow-listing the runtime, so it never kills the
  server or the legit read and needs no per-image tuning. A positive-containment
  variant is documented in the policy if you want "confine to /srv/records".
- **Read-only telemetry is unauthenticated** even in hardened
  (`/api/admin/state`, `/api/events`) — `ui/NOTES.md §6.1`.
- **Postgres storage is an `emptyDir`.** Any Postgres restart wipes every row;
  `make reset` reseeds. Not a security control, but it bites mid-demo.

---

See also: `ARCHITECTURE.md` (§6–§10 attack/defence), `INPUT-GUARD.md` (L1 in
depth), `SCENES.md` + `PRESENTER-ATTACK-MAP.md` (the attacks), `HOW-TO-HARDEN.md`
(applying the hardened profile), `PROVE-IT.md` (falsifiable checks).
