# How to harden — step by step

A standalone runbook for applying the hardened profile and re-testing the scenes,
so you can pick it up cold later. It assumes the cluster is already up in the
naked profile (the normal state). You run the cluster commands; nothing here runs
itself.

Background and the *why* behind each step is in `LANGUAGE-AND-HARDEN-PLAN.md`
§2. This file is just the recipe.

## Table of contents

1. [TL;DR](#1-tldr)
2. [What "hardened" turns on](#2-what-hardened-turns-on)
3. [Prerequisites](#3-prerequisites)
4. [Option A — guards on (fast, no Vault)](#4-option-a--guards-on-fast-no-vault)
5. [Option B — full hardened profile](#5-option-b--full-hardened-profile)
6. [Re-test the scenes (hardened)](#6-re-test-the-scenes-hardened)
7. [Admin access in hardened](#7-admin-access-in-hardened)
8. [Going back to naked](#8-going-back-to-naked)
9. [Troubleshooting](#9-troubleshooting)

## 1. TL;DR

```bash
# Fast: application-layer guards on, no Vault, no policies
./scripts/admin.sh layers input_guard=on expert_guard=on provenance=on registry=on tool_gate=on budgets=on
make reset
# run scenes…

# Full: least-privilege + Cilium + Tetragon + Kyverno
export N8N_MCP_TOKEN=$(openssl rand -hex 16) ADMIN_TOKEN=$(openssl rand -hex 16)
make vault-seed
make harden N8N_MCP_TOKEN=$N8N_MCP_TOKEN ADMIN_TOKEN=$ADMIN_TOKEN
make reset
# run scenes, with `make hubble` + `make events` open
```

Use **Option A** to show the guards catching attacks (covers Scenes 1, 2, 3, 3b,
4 at the application layer). Use **Option B** when you also want the kernel and
admission layers (Cilium drop, Tetragon kill, Kyverno refuse).

## 2. What "hardened" turns on

From `deploy/helm/kahawa-guard/values-hardened.yaml` and `make harden`:

- All six guard switches on (input guard, expert guard, provenance, registry,
  tool gate, budgets).
- Least privilege: no service-account token mounted, read-only root filesystem,
  run-as-non-root, restricted namespaces, resource quotas.
- `adminTokenRequired: true` — admin endpoints need `X-Admin-Token`.
- `secretsFromVault: true` — the gateway reads secrets from Vault, not values.
- n8n: Code and Execute-Command nodes removed; MCP trigger requires a bearer token.
- Policies applied alongside: Kyverno (admission), Cilium (network), Tetragon
  (runtime).

## 3. Prerequisites

- Cluster up, naked profile working (`make up` was run at some point).
- Platform layer installed — Cilium, Tetragon, Kyverno, Vault, External Secrets:
  ```bash
  make platform      # safe to re-run; installs/updates the platform charts
  ```
- `MISTRAL_API_KEY` available in your shell or `.env`.
- `openssl`, `jq`, `kubectl`, `helm` on PATH.

## 4. Option A — guards on (fast, no Vault)

Stay on the naked deployment and just switch the guards on. This exercises the
whole application layer with no Vault and no policy changes.

```bash
./scripts/admin.sh layers input_guard=on expert_guard=on provenance=on registry=on tool_gate=on budgets=on
make reset                         # clean data (gateway forwarded on :8000)
```

Then run the scenes (see §6). To go back to "attacks land", turn them off:

```bash
./scripts/admin.sh layers input_guard=off expert_guard=off provenance=off registry=off tool_gate=off budgets=off
```

Note: the **expert guard is in `cached` mode** by default — it replays scores, it
does not score live. For a live L2 set `SHIELDSTRAL_MODE=live` with
`SHIELDSTRAL_URL` + key and redeploy. L1 (Mistral moderation) is always live.

## 5. Option B — full hardened profile

Two things must be in place first or `make harden` fails: the n8n MCP token must
be supplied (the chart requires it in hardened), and Vault must hold the secrets
(the gateway reads them from Vault, not values).

```bash
# 1. pick ONE n8n token + ONE admin token, and keep them in your shell
export N8N_MCP_TOKEN=$(openssl rand -hex 16)
export ADMIN_TOKEN=$(openssl rand -hex 16)

# 2. seed Vault with the Mistral key + these tokens, and create the vault-token secret
make vault-seed

# 3. apply admission + deploy hardened + network + runtime policies
make harden N8N_MCP_TOKEN=$N8N_MCP_TOKEN ADMIN_TOKEN=$ADMIN_TOKEN

# 4. reseed the data
make reset
```

`make vault-seed` puts `mistral_api_key`, `n8n_mcp_token`, `admin_token` into
Vault at `secret/kahawa` (dev root token `root`) and creates the `vault-token`
secret in the gateway namespace. **Use the same `$N8N_MCP_TOKEN` in both
`vault-seed` and `harden`** — the gateway reads it from Vault, the n8n seed reads
it from values, and n8n's MCP trigger returns 403 if they differ.

Verify the pods came up:

```bash
kubectl get pods -A -l app.kubernetes.io/part-of=kahawa-guard
kubectl -n gateway logs deploy/gateway | tail       # should say profile=hardened
```

## 6. Re-test the scenes (hardened)

Open two tabs first for the kernel-layer scenes:

```bash
make hubble      # Cilium flows (drops show here)
make events      # Tetragon runtime events (kills show here)
```

Then:

```bash
make scene1          # jailbreak: L1/L2 block
make scene2          # fake circular: provenance quotes untrusted, L3 registry refuses
make scene4          # laundered plot: KG-0003 ineligible, KG-0005 clean
make scene3b         # SSRF: Cilium drops the packet, Tetragon kills the process
make prove-admission # Kyverno refuses the bad pod spec
make scene3c         # file-server escape: Tetragon kills on the real open
```

Two expected behaviours that are **not** bugs in hardened:

- **Scene 3 (rogue payout)**: Cilium default-deny blocks the gateway from the
  `attacker` namespace, so **farm-weather is unreachable** and `scene3.sh` stops
  at its "farm-weather not connected" check. That is the hardened story — the
  network drops the stranger before the model sees the tool. Show the tool-gate
  *park* from Option A instead, and narrate the network drop with `make hubble`.
- **Scene 3c**: apply the policy between the naked and hardened runs to show the
  difference:
  ```bash
  kubectl apply -f deploy/policies/tetragon/confine-records-fs.yaml
  make scene3c     # calls 2 and 3 now "(process was killed)"
  ```

## 7. Admin access in hardened

`adminTokenRequired` is true, so toggles and pack switches need the token:

```bash
./scripts/admin.sh layers tool_gate=on --token "$ADMIN_TOKEN"
# for the UI / operator console, build it with the token:
VITE_ADMIN_TOKEN="$ADMIN_TOKEN" npm --prefix ui run build
```

Read-only endpoints (`/api/admin/state`, `/api/events`) stay open — that is the
telemetry-auth gap flagged in `ui/NOTES.md` §6.1, a backend change, not done.

## 8. Going back to naked

How you reverse depends on which level of "hardened" you turned on.

### If you used the fast path (guard switches)

Flip the switches back off on the running deployment, then reseed:

```bash
./scripts/admin.sh layers input_guard=off expert_guard=off provenance=off registry=off tool_gate=off budgets=off
make reset
```

### If you ran the full profile (`make harden`)

```bash
make naked
make reset
```

`make naked` removes the Kyverno/Cilium/Tetragon policies and redeploys the naked
profile; `make reset` reseeds the data (Postgres is an `emptyDir`, so a redeploy
can wipe rows) and clears the verdict buffer.

### If you only applied a single policy for a scene

For Scene 3c you applied the Tetragon policy directly, so remove it directly:

```bash
kubectl delete -f deploy/policies/tetragon/confine-records-fs.yaml
```

**Short version:** `make naked` → `make reset` is the full-profile reversal, and
flipping the `admin.sh layers` switches off is the fast-path reversal. Always run
`make reset` after, either way.

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `helm … n8n.mcpToken is required` | hardened needs the token | pass `N8N_MCP_TOKEN=…` to `make harden` (env or `.env`) |
| Chat fails, `Illegal header value b'Bearer '` | gateway got an empty key from Vault | run `make vault-seed` first; confirm `vault-token` secret exists in `gateway` |
| n8n tools 403 / vanish | gateway token ≠ n8n token | same `$N8N_MCP_TOKEN` in `vault-seed` and `harden` |
| Scene 3 "farm-weather not connected" | Cilium blocks attacker ns | expected in hardened — see §6 |
| Admin calls 401 | `adminTokenRequired` on | pass `--token "$ADMIN_TOKEN"` |
| `retrieve: N untrusted` leftovers | old uploaded test docs | `make reset` before the run |
| Scene 3c no response on every call | stdio handshake / proto | try `PROTO=2025-06-18 make scene3c`; manual check in the scene's step 0 note |
| Pods `ErrImageNeverPull` | image not loaded into kind | `make images load` (or `make reload R=<name>`) |
