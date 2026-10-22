# Switching between naked and hardened

How to move the demo between the two profiles — the fast way (flip guard switches
on the running deployment) and the full way (`make harden` / `make naked` with
Cilium, Tetragon, Kyverno and Vault) — plus which one each scene actually needs.

> **The mental model:** there are **two independent levels** of "hardened".
> 1. **App-layer guards** — six switches in the gateway, flipped live over the
>    admin API. No redeploy. This is all Scenes 1, 2 and 3 need.
> 2. **The full profile** — the guards *plus* Kubernetes network/runtime/admission
>    policy and Vault secrets, applied by redeploying the chart. Needed only for
>    the kernel/admission scenes (3b, 3c, prove-admission).
>
> You rarely need level 2. Most of the talk runs on level 1.

> **Golden rule:** after **any** switch, run `make reset`. Postgres storage is an
> `emptyDir`, so a redeploy can wipe every row; `reset` reseeds and clears the
> verdict buffer. Skipping it is the #1 cause of "the DB came back empty".

## Table of contents

1. [TL;DR](#1-tldr)
2. [The two levels explained](#2-the-two-levels-explained)
3. [Level 1 — guard switches (fast path)](#3-level-1--guard-switches-fast-path)
4. [Level 2 — full profile (make harden / make naked)](#4-level-2--full-profile-make-harden--make-naked)
5. [Which level each scene needs](#5-which-level-each-scene-needs)
6. [What each command actually does](#6-what-each-command-actually-does)
7. [Single-layer scenes (neither full profile)](#7-single-layer-scenes-neither-full-profile)
8. [Verifying which profile you are in](#8-verifying-which-profile-you-are-in)
9. [The farm-weather / Scene 3 caveat](#9-the-farm-weather--scene-3-caveat)
10. [Troubleshooting](#10-troubleshooting)
11. [Quick reference card](#11-quick-reference-card)

## 1. TL;DR

```bash
# ── Level 1: guards only (Scenes 1, 2, 3) — no redeploy ──────────────
# hardened
./scripts/admin.sh layers input_guard=on expert_guard=on provenance=on registry=on tool_gate=on budgets=on
make reset
# naked
./scripts/admin.sh layers input_guard=off expert_guard=off provenance=off registry=off tool_gate=off budgets=off
make reset

# ── Level 2: full profile (Scenes 3b, 3c, prove-admission) ───────────
# to hardened (one-time setup first)
export N8N_MCP_TOKEN=$(openssl rand -hex 16) ADMIN_TOKEN=$(openssl rand -hex 16)
make vault-seed
make harden N8N_MCP_TOKEN=$N8N_MCP_TOKEN ADMIN_TOKEN=$ADMIN_TOKEN
make reset
# back to naked
make naked
make reset
```

Your instinct is right: **`make harden` → `make reset`** to go hardened,
**`make naked` → `make reset`** to come back.

## 2. The two levels explained

The profiles differ along two axes, and you can move them independently:

| | Level 1: guard switches | Level 2: full profile |
| --- | --- | --- |
| What changes | the 6 app-layer guards in the gateway | guards **+** Cilium + Tetragon + Kyverno + Vault + pod security |
| How | admin API (`admin.sh layers …`) | redeploy the chart (`make harden` / `make naked`) |
| Redeploy? | **no** — live, instant | **yes** — helm upgrade + policy apply |
| Secrets | plain env Secret (unchanged) | Vault + External Secrets |
| Reaches kernel/admission? | no | yes |
| Covers scenes | 1, 2, 3 (app layer) | 3b, 3c, prove-admission (kernel/admission) |
| Setup needed | none | `make vault-seed`, two tokens |

The guard switches are the same six whether you flip them by hand (Level 1) or
let `make harden`/`make naked` set them via the profile's values (Level 2):
`input_guard, expert_guard, provenance, registry, tool_gate, budgets`.

## 3. Level 1 — guard switches (fast path)

This stays on the **naked deployment** and only turns the application-layer guards
on or off, live, over the admin API. It is the right tool for Scenes 1, 2 and 3,
and it is instant — no pod restarts.

```bash
# ALL guards on (the app-layer "hardened" posture)
./scripts/admin.sh layers input_guard=on expert_guard=on provenance=on registry=on tool_gate=on budgets=on
make reset

# ALL guards off (naked)
./scripts/admin.sh layers input_guard=off expert_guard=off provenance=off registry=off tool_gate=off budgets=off
make reset
```

You can also flip **one layer at a time** — which is often what you want, to show
exactly one control (see §7):

```bash
./scripts/admin.sh layers tool_gate=on         # just the tool gate
./scripts/admin.sh layers registry=on provenance=on   # just the registry + provenance
```

Notes:
- The admin API is **open in the naked deployment** (no token), so no `--token`
  is needed at Level 1. In a full hardened deploy it requires `--token
  "$ADMIN_TOKEN"` (see §4).
- **L2 expert guard runs in `cached` mode by default** — it replays scores and is
  silent on prompts it has no cache entry for. For live L2, set
  `SHIELDSTRAL_MODE=live` and redeploy. (`Docs/INPUT-GUARD.md`, `Docs/SCENES.md`.)

## 4. Level 2 — full profile (make harden / make naked)

This redeploys the chart in the hardened profile and layers on the Kubernetes
policies. Needed for the kernel (Cilium drop, Tetragon kill) and admission
(Kyverno) scenes.

**One-time setup before the first `make harden`:**

```bash
# 1. pick ONE n8n token and ONE admin token; keep them in your shell
export N8N_MCP_TOKEN=$(openssl rand -hex 16)
export ADMIN_TOKEN=$(openssl rand -hex 16)

# 2. seed Vault with the Mistral key + these tokens, and create the vault-token secret
make vault-seed
```

**Go hardened:**

```bash
make harden N8N_MCP_TOKEN=$N8N_MCP_TOKEN ADMIN_TOKEN=$ADMIN_TOKEN
make reset
```

**Back to naked:**

```bash
make naked      # deletes the Kyverno/Cilium/Tetragon policies, redeploys naked
make reset
```

Notes:
- `make harden` **will not render** without the n8n token (the chart calls Helm's
  `required` on it in hardened) and without Vault seeded (the gateway reads
  secrets from Vault, not values) — hence `make vault-seed` first. Use the **same**
  `$N8N_MCP_TOKEN` in both `vault-seed` and `harden`, or n8n's MCP trigger returns
  403 and its tools vanish.
- In hardened the **admin API needs the token**: `./scripts/admin.sh layers … --token "$ADMIN_TOKEN"`,
  and the UI must be built with `VITE_ADMIN_TOKEN`.
- Full detail and the two-option recipe are in `Docs/HOW-TO-HARDEN.md`.

## 5. Which level each scene needs

| Scene | What it demonstrates | Level | How to set up the "stop" side |
| --- | --- | --- | --- |
| 1 jailbreak | L1 input guard, L2 expert guard | 1 | `input_guard=on expert_guard=on` |
| 2 fake circular | provenance + L3 registry | 1 | `provenance=on registry=on` (+ `expert_guard=on`) |
| 3 rogue payout | **L4 tool gate** | 1 | `tool_gate=on` **only** (see §7, §9) |
| 3b SSRF | Cilium drop + Tetragon kill | **2** | `make harden` (or apply the cilium/tetragon metadata policies) |
| 3c FS escape | Tetragon `confine-records-fs` | 2* | apply just `confine-records-fs.yaml` (§7) |
| 4 laundered plot | L3 registry / `check_plot` | 1 | `registry=on` |
| 5 PII leak | L4 tool gate (refuse) + L2 | 1 | `tool_gate=on` (needs the gateway build with the refused-tool fix) |
| 6 buyer leak | L4 tool gate (refuse) + L2 | 1 | `tool_gate=on` (same) |
| 7 DB injection | parameterized queries (always on) | — | neither — the defence is not a toggle |
| prove-admission | Kyverno | **2** | `make harden` (applies the Kyverno policies) |

\* Scene 3c only needs the **one** Tetragon policy applied, not a full `make
harden` (§7).

## 6. What each command actually does

| Command | Effect |
| --- | --- |
| `./scripts/admin.sh layers X=on/off …` | POSTs to `/api/admin/layers`; flips guard switches live in the running gateway. No restart. |
| `make harden N8N_MCP_TOKEN=… ADMIN_TOKEN=…` | `kubectl apply` Kyverno → `make deploy PROFILE=hardened` → `kubectl apply` Cilium (+ provider rule) → `kubectl apply` Tetragon. |
| `make naked` | `kubectl delete` Kyverno/Cilium/Tetragon policies → `make deploy PROFILE=naked`. |
| `make vault-seed` | puts `mistral_api_key`, `n8n_mcp_token`, `admin_token` into Vault at `secret/kahawa`, and creates the `vault-token` secret in the gateway namespace. |
| `make reset` | TRUNCATE + reseed every table (`scripts/reset.sh` + `_seed.py`), re-upload the trusted notes, clear the verdict buffer. |
| `make deploy PROFILE=naked\|hardened` | helm upgrade with the chosen profile's values (used under the hood by harden/naked). |

## 7. Single-layer scenes (neither full profile)

You often don't want *all* guards on — just the one layer a scene is about. An
earlier layer turned on at the same time can **pre-empt** the one you're
demonstrating (e.g. L1 input guard false-positives on a benign member message and
blocks Scene 3 before the tool gate is reached). So:

- **Scene 3 (tool gate):** turn on **only** the gate.
  ```bash
  ./scripts/admin.sh layers input_guard=off expert_guard=off provenance=off registry=off tool_gate=on budgets=off
  make reset
  make scene3
  ```
- **Scene 3c (Tetragon):** don't `make harden` at all — apply the single policy,
  and delete it to go back:
  ```bash
  kubectl apply  -f deploy/policies/tetragon/confine-records-fs.yaml   # hardened for 3c
  kubectl delete -f deploy/policies/tetragon/confine-records-fs.yaml   # naked for 3c
  ```

Rule of thumb: **turn on the layer the scene is about, not everything.** The
per-scene enforcing layer is in `Docs/SCENES.md` and `Docs/SECURITY-LANDSCAPE.md §8`.

## 8. Verifying which profile you are in

```bash
# the live guard switches + profile + whether the admin token is required
./scripts/admin.sh state | jq '{profile, switches, admin_token_required}'

# the deployed profile (and that the pod is up)
kubectl -n gateway logs deploy/gateway | grep -i profile | tail

# which Kubernetes policies are loaded (empty in naked)
kubectl get tracingpolicies
kubectl get ciliumclusterwidenetworkpolicies,ciliumnetworkpolicies -A
kubectl get clusterpolicies           # Kyverno
```

- Level-1 "hardened" shows `profile: naked` (you never redeployed) but all
  switches `true`. That is expected — you turned the guards on without changing
  the deployment.
- Level-2 hardened shows `profile: hardened`, `admin_token_required: true`, and
  the policy lists non-empty.

## 9. The farm-weather / Scene 3 caveat

In the **full hardened profile**, Cilium `default-deny` blocks the gateway from
reaching the `attacker` namespace, so **farm-weather becomes unreachable** and
`scene3.sh` stops at its "farm-weather not connected" check. That is the hardened
*network* story ("the network drops the stranger"), not a bug.

So for Scene 3's **tool-gate park** — the thing you usually want to show — use
**Level 1** on the naked deployment (farm-weather reachable, `tool_gate=on`, the
payout is parked). In full hardened, narrate farm-weather as network-dropped and
show the park from Level 1. (`Docs/HOW-TO-HARDEN.md §6`, `Docs/LANGUAGE-AND-HARDEN-PLAN.md §2.5`.)

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| DB empty after a switch | skipped `make reset` (emptyDir wiped) | run `make reset` |
| `helm … n8n.mcpToken is required` | hardened needs the token | pass `N8N_MCP_TOKEN=…` to `make harden` |
| Chat fails `Illegal header value b'Bearer '` | gateway got an empty key from Vault | run `make vault-seed` first; confirm `vault-token` secret exists |
| n8n tools 403 / vanish | gateway token ≠ n8n token | same `$N8N_MCP_TOKEN` in `vault-seed` and `harden` |
| admin calls 401 | hardened `adminTokenRequired` | pass `--token "$ADMIN_TOKEN"` |
| Scene 3 "farm-weather not connected" | Cilium default-deny in full hardened | expected — show the park from Level 1 (§9) |
| Scene 3 blocked at `input_guard` not the gate | you turned on all guards | turn on `tool_gate` only (§7) |
| guards still off after flipping | typo in a layer name | names are exactly the six in §2; `admin.sh state` to confirm |

## 11. Quick reference card

```bash
# LEVEL 1 — guards, live, no redeploy (Scenes 1,2,3,4,5,6)
ON:   ./scripts/admin.sh layers input_guard=on expert_guard=on provenance=on registry=on tool_gate=on budgets=on && make reset
OFF:  ./scripts/admin.sh layers input_guard=off expert_guard=off provenance=off registry=off tool_gate=off budgets=off && make reset
ONE:  ./scripts/admin.sh layers tool_gate=on                 # just one layer

# LEVEL 2 — full profile (Scenes 3b, 3c, prove-admission)
SETUP:  export N8N_MCP_TOKEN=$(openssl rand -hex 16) ADMIN_TOKEN=$(openssl rand -hex 16); make vault-seed
HARDEN: make harden N8N_MCP_TOKEN=$N8N_MCP_TOKEN ADMIN_TOKEN=$ADMIN_TOKEN && make reset
NAKED:  make naked && make reset

# 3c on its own (no full profile needed)
kubectl apply  -f deploy/policies/tetragon/confine-records-fs.yaml
kubectl delete -f deploy/policies/tetragon/confine-records-fs.yaml

# check where you are
./scripts/admin.sh state | jq '{profile, switches, admin_token_required}'
```

See also: `Docs/HOW-TO-HARDEN.md` (the full hardened recipe), `Docs/SCENES.md`
(per-scene setup), `Docs/SECURITY-LANDSCAPE.md` (what each layer protects),
`Docs/TETRAGON-LAB.md` (the runtime layer), `Docs/HOW-TO-SEED.md` (why reset
matters).
