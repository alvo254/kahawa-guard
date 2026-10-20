# Kahawa Guard: Manual Runbook

Every command the `Makefile` runs for you, spelled out one section at a time —
so you can bring the stack up piece by piece, inspect each layer before moving
to the next, and know exactly what to undo if something looks wrong.

**On a Mac?** There's no Linux kernel under macOS, so this document's section
3 onward assumes you're already in one. Read `RUNBOOK-MAC.md` first — it gets
you from a Mac terminal into a real Linux shell (via OrbStack), then hands
back to this document. If you're on native Linux, or you're already inside
that Linux shell, this document applies to you directly from here.

Section 16 maps this whole sequence back onto `make` targets. Once you've run
it by hand once and trust it, use `make up` / `make harden` day to day — this
document is for the first time, for teaching, and for debugging.

Run everything from the repo root unless a command says otherwise.

## Table of contents

1. [Conventions and variables](#1-conventions-and-variables)
2. [Prerequisites](#2-prerequisites)
3. [Bring up the kind cluster](#3-bring-up-the-kind-cluster)
4. [Install Cilium](#4-install-cilium)
5. [Install Tetragon](#5-install-tetragon)
6. [Install Kyverno](#6-install-kyverno)
7. [Install Vault and External Secrets](#7-install-vault-and-external-secrets)
8. [Build and load the application images](#8-build-and-load-the-application-images)
9. [Stage the chart's embedded files](#9-stage-the-charts-embedded-files)
10. [Deploy the application (naked profile)](#10-deploy-the-application-naked-profile)
11. [Database setup and seeding](#11-database-setup-and-seeding)
12. [Verify the MCP layer](#12-verify-the-mcp-layer)
13. [Reach the UI and the gateway](#13-reach-the-ui-and-the-gateway)
14. [Switch to the hardened profile](#14-switch-to-the-hardened-profile)
15. [Switch the model provider to a local Ollama](#15-switch-the-model-provider-to-a-local-ollama-optional)
16. [The same sequence with `make`](#16-the-same-sequence-with-make)
17. [Cleanup and reset](#17-cleanup-and-reset)

## 1. Conventions and variables

Every section below uses these; set them once in your shell so the commands
can be pasted as written.

```bash
export CLUSTER=kahawa
export TAG=dev
export PROFILE=naked          # naked | hardened
export PACK=coffee            # coffee | health | education
export PROVIDER=mistral       # mistral | ollama
export GATEWAY_API_VERSION=v1.3.0
export CILIUM_VERSION=1.20.3
export CHART=deploy/helm/kahawa-guard

# .env is NOT read by the deployed pod — the Docker image never copies it in,
# and the Helm chart has no mechanism that reads it either. It's only useful
# here because it gives every `helm upgrade` below a $MISTRAL_API_KEY to pass
# through explicitly with --set-string. Without this, MISTRAL_API_KEY renders
# as an empty string and every Mistral call fails with
# "Illegal header value b'Bearer '" — found the hard way; see
# NETWORKING-POSTMORTEM.md section 7.
set -a; source .env; set +a
```

`PROFILE`, `PACK` and `PROVIDER` are the three axes the `values-*.yaml` files
and the `--set` flags below key off. Keep them exported and every command in
this runbook stays copy-pasteable.

## 2. Prerequisites

```bash
for t in docker kind kubectl helm cilium hubble npx uv jq; do
  command -v "$t" >/dev/null || echo "missing: $t"
done
```

Copy the env template and fill in what you need (a Mistral key, or set
`PROVIDER=ollama` later and skip it):

```bash
cp .env.example .env
```

## 3. Bring up the kind cluster

```bash
kind create cluster --name "$CLUSTER" --config deploy/kind/kind-config.yaml
```

`deploy/kind/kind-config.yaml` disables the default CNI and kube-proxy (Cilium
replaces both) and adds a `containerdConfigPatches` mirror for a local registry
at `localhost:5000`. That mirror only does something if a `kind-registry`
container exists on the same Docker network — this repo doesn't build images
through it, so you can ignore it unless you set one up yourself:

```bash
docker run -d --restart=always -p 5000:5000 --name kind-registry --network kind registry:2
```

Confirm the cluster is up:

```bash
kubectl cluster-info --context "kind-$CLUSTER"
kubectl get nodes
```

Nodes will show `NotReady` until Cilium is installed in the next section —
that's expected with `disableDefaultCNI: true`.

## 4. Install Cilium

`gatewayAPI.enabled=true` in `deploy/platform/cilium-values.yaml` needs the
Gateway API CRDs present first, or the cilium-operator crash-loops on missing
CRDs, so that comes before the chart install.

```bash
# 1. Gateway API CRDs (prerequisite for gatewayAPI.enabled)
kubectl apply -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"

# 2. Cilium repo + install
helm repo add cilium https://helm.cilium.io
helm repo update
helm upgrade --install cilium cilium/cilium --version "$CILIUM_VERSION" \
  -n kube-system -f deploy/platform/cilium-values.yaml \
  --set k8sServiceHost="${CLUSTER}-control-plane"

cilium status --wait
```

Sanity checks:

```bash
kubectl get nodes                          # should now show Ready
cilium hubble ui                            # opens the Hubble UI in your browser
```

If `bpf.datapathMode: netkit` fails on your kernel, drop that line from
`cilium-values.yaml` and re-run the `helm upgrade` — it falls back to the
default veth datapath.

## 5. Install Tetragon

Tetragon is **not** bundled with the Cilium chart — no `charts/tetragon`
subdirectory, no `dependencies:` entry, no `tetragon` key anywhere in
Cilium's own `templates/` or `values.yaml` (checked directly against the real
1.20.3 chart). It installs as its own separate release, from Cilium's `cilium`
Helm repo but a different chart:

```bash
helm upgrade --install tetragon cilium/tetragon --version "$TETRAGON_VERSION" \
  -n kube-system -f deploy/platform/tetragon-values.yaml

kubectl rollout status -n kube-system ds/tetragon
```

**What Tetragon actually does, since it's easy to lose track of in all this
platform plumbing:** it's an eBPF-based runtime security tool, from the same
team as Cilium, that watches process execs, file opens, and network
connections at the kernel level, per pod, and — via a `TracingPolicy` — can
act on what it sees, including killing the offending process outright. That's
the enforcement layer the demo's Scene 3b and 3c lean on: Tetragon doesn't
just log that a process reached somewhere it shouldn't (the metadata
endpoint, a file outside a records server's allowed directory) — it can
`Sigkill` it, in the kernel, the moment the real syscall happens, regardless
of what the application's own code tried to validate first. See
`deploy/policies/tetragon/*.yaml` for the actual policies this repo ships.

Sanity check:

```bash
kubectl exec -n kube-system ds/tetragon -c tetragon -- tetra getevents -o compact | head
```

## 6. Install Kyverno

Base install only — no policies yet. Policies are applied later, in
[section 14](#14-switch-to-the-hardened-profile), because applying them now
(with nothing deployed) teaches you nothing and applying them to the naked
profile is the whole point of the demo's "before" state.

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update
helm upgrade --install kyverno kyverno/kyverno \
  -n kyverno --create-namespace -f deploy/platform/kyverno-values.yaml

kubectl -n kyverno get pods
```

## 7. Install Vault and External Secrets

Only load-bearing in the hardened profile (`security.secretsFromVault: true`
in `values-hardened.yaml`). The naked profile uses a plain `Secret` rendered
from values instead, so you can skip this section entirely if you're only
running naked — come back to it before [section 14](#14-switch-to-the-hardened-profile).

```bash
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm upgrade --install vault hashicorp/vault \
  -n vault --create-namespace -f deploy/platform/vault-values.yaml

helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace

kubectl -n vault get pods
kubectl -n external-secrets get pods
```

Vault here runs in **dev mode** — in-memory, auto-unsealed, root token
`root`. Fine for a demo, never for anything real.

## 8. Build and load the application images

```bash
docker build -t kahawa/ui:"$TAG"           ui
docker build -t kahawa/gateway:"$TAG"      gateway
docker build -t kahawa/kahawa-tools:"$TAG" mcp/kahawa-tools
docker build -t kahawa/farm-weather:"$TAG" mcp/farm-weather
docker build -t kahawa/records-fs:"$TAG"   mcp/records-fs
docker build -t kahawa/fake-imds:"$TAG"    attacker/fake-imds
docker build -t kahawa/postgres:"$TAG"     data/postgres

for i in ui gateway kahawa-tools farm-weather records-fs fake-imds postgres; do
  kind load docker-image kahawa/$i:"$TAG" --name "$CLUSTER"
done
```

`kind load docker-image` pushes straight into the kind nodes' containerd image
store — no registry round trip needed for local images, which is why the
`kind-registry` mirror from section 3 isn't required for this repo to work.

## 9. Stage the chart's embedded files

The Helm chart reads `packs/`, `prompts/`, `ui/nginx.conf` and
`data/schema.sql` from *inside its own directory* via Helm's `.Files.Get`, so
they have to be copied in before every install. This is what `make stage`
automates:

```bash
rm -rf "$CHART/packs" "$CHART/prompts"
cp -R packs "$CHART/packs"
cp -R prompts "$CHART/prompts"
mkdir -p "$CHART/files"
cp ui/nginx.conf data/schema.sql "$CHART/files/"
```

These copies are git-ignored (`deploy/helm/kahawa-guard/{packs,prompts,files}/`
in `.gitignore`) — the real source of truth stays at the repo root. Re-run this
whenever you edit a pack, a prompt, `nginx.conf` or `schema.sql`.

## 10. Deploy the application (naked profile)

```bash
helm upgrade --install kahawa "$CHART" \
  -f "$CHART/values.yaml" -f "$CHART/values-${PROFILE}.yaml" \
  --set pack="$PACK" --set image.tag="$TAG" --set llm.provider="$PROVIDER" \
  --set-string llm.mistral.apiKey="$MISTRAL_API_KEY"
```

Watch everything come up:

```bash
kubectl get pods -A -l app.kubernetes.io/part-of=kahawa-guard

kubectl -n data      rollout status deploy/postgres
kubectl -n data      rollout status deploy/redis
kubectl -n gateway   rollout status deploy/gateway
kubectl -n kahawa-ui rollout status deploy/kahawa-ui
kubectl -n tools     rollout status deploy/kahawa-tools
kubectl -n tools     rollout status deploy/records-fs
kubectl -n attacker  rollout status deploy/farm-weather
kubectl -n attacker  rollout status deploy/fake-imds
kubectl -n n8n       rollout status deploy/n8n
```

The gateway will log MCP connection warnings until section 12 — that's
expected; nothing is listening to prove the tool list yet from your side,
though the gateway itself can already reach `kahawa-tools` in-cluster.

## 11. Database setup and seeding

**The schema applies itself.** `data/postgres/Dockerfile` copies
`data/postgres/init.sh` to `/docker-entrypoint-initdb.d/00-init.sh`, which runs
on the Postgres pod's first start (empty `PGDATA`), substitutes `EMBED_DIM`
into the mounted `schema.sql`, and applies it. Confirm it happened:

```bash
PG_POD=$(kubectl -n data get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl -n data exec -i "$PG_POD" -- psql -U kahawa -d kahawa -c '\dt'
```

You should see `members`, `plots`, `forest_2020`, `dealers`, `products`,
`payments`, `documents`, `chunks`, `pending_actions`, `audit_events`.

**Now seed it.** This truncates and reloads every invented fixture row
(members, dealers, products, payments, plots, the forest fixture):

```bash
kubectl -n data exec -i "$PG_POD" -- psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa <<'SQL'
TRUNCATE members, plots, forest_2020, dealers, products, payments,
         chunks, documents, pending_actions, audit_events RESTART IDENTITY CASCADE;
SQL

python3 scripts/_seed.py | \
  kubectl -n data exec -i "$PG_POD" -- psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa
```

`scripts/_seed.py` reads `data/seed/*.csv` and `*.geojson` and prints plain
SQL — inspect it any time with `python3 scripts/_seed.py | less` before piping
it anywhere.

**Load the one trusted document** (the extension notes) so retrieval has
something real to cite. This needs the gateway reachable, so port-forward it
first:

```bash
kubectl -n gateway port-forward svc/gateway 8000:8000 &
GW_PF=$!

curl -sf -X POST http://localhost:8000/api/upload \
  -F "role=coop" -F "title=Kirinyaga Coffee Extension Notes" -F "trust=trusted" \
  -F "file=@data/seed/docs/extension_notes.md;type=text/markdown" | jq .
```

The fake Coffee Board circular (`data/seed/docs/fake_circular.md`) is
deliberately **not** loaded here — it gets uploaded live, during Scene 2, as
an untrusted "dealer" document. Pre-seeding it would give the scene away
before the room watches the upload happen.

Keep `GW_PF` around; section 13 reuses that same port-forward.

## 12. Verify the MCP layer

Port-forward both MCP servers (separate local ports from the gateway's 8000,
so note the gateway port-forward above already owns `:8000` locally — use
`:8001` here to avoid a clash, matching what `scripts/port-forwards.sh mcp all`
does):

```bash
kubectl -n tools    port-forward svc/kahawa-tools 8001:8000 &
kubectl -n attacker port-forward svc/farm-weather 8100:8000 &
```

List and smoke-test with the MCP Inspector CLI (never older than 0.14.1 —
CVE-2025-49596):

```bash
npx @modelcontextprotocol/inspector@latest --cli http://localhost:8001/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector@latest --cli http://localhost:8100/mcp --transport http --method tools/list

./mcp/tests/smoke.sh http://localhost:8001/mcp
```

Print and record the pinned tool-list hashes (these are what
`gateway/app/mcp/pinning.py` checks at runtime, and what catches farm-weather's
rug pull on stage):

```bash
./scripts/mcp-pin.sh print http://localhost:8001/mcp http://localhost:8100/mcp
```

Copy those hashes into `mcp/tests/pins.json` and into each pack's `pins:`
block (`packs/coffee.yaml`, etc.), then redeploy so the gateway enforces them:

```bash
helm upgrade --install kahawa "$CHART" \
  -f "$CHART/values.yaml" -f "$CHART/values-${PROFILE}.yaml" \
  --set pack="$PACK" --set image.tag="$TAG" --set llm.provider="$PROVIDER" \
  --set-string llm.mistral.apiKey="$MISTRAL_API_KEY"
```

Check with `./scripts/mcp-pin.sh check http://localhost:8001/mcp http://localhost:8100/mcp`
afterwards — it should print `ok` for both.

## 13. Reach the UI and the gateway

```bash
kubectl -n kahawa-ui port-forward svc/kahawa-ui 8080:8080 &
```

Open `http://localhost:8080` — the chat screen on the left, the admin panel
(layer switches, verdict feed, spend meter, pending actions) on the right.

Talk to the gateway directly, bypassing the UI, using the port-forward from
section 11:

```bash
curl -s -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+254700000001","message":"Dawa gani ya ugonjwa wa matunda ya kahawa?"}' | jq .

curl -s http://localhost:8000/api/admin/state | jq .
curl -s http://localhost:8000/healthz
```

Run a scene by hand — these are plain shell scripts, nothing make-specific
about them:

```bash
GATEWAY_URL=http://localhost:8000 ./scenes/scene1.sh
```

## 14. Switch to the hardened profile

This applies admission control first, then redeploys with the hardened
values, then applies the network and runtime policies on top:

```bash
# 1. Admission control — Kyverno policies
kubectl apply -R -f deploy/policies/kyverno

# 2. Redeploy with the hardened profile
helm upgrade --install kahawa "$CHART" \
  -f "$CHART/values.yaml" -f "$CHART/values-hardened.yaml" \
  --set pack="$PACK" --set image.tag="$TAG" --set llm.provider="$PROVIDER" \
  --set-string llm.mistral.apiKey="$MISTRAL_API_KEY"

# 3. Network policy — default deny, FQDN/L7 egress rules, plus the provider-specific rule
kubectl apply -f deploy/policies/cilium/
kubectl apply -f deploy/policies/cilium/providers/"$PROVIDER".yaml

# 4. Runtime policy — Tetragon TracingPolicies
kubectl apply -R -f deploy/policies/tetragon

# 5. Confirm everything came back up under the new profile
kubectl get pods -A -l app.kubernetes.io/part-of=kahawa-guard
```

Watch the difference live with two more terminals:

```bash
cilium hubble ui
kubectl exec -n kube-system ds/tetragon -c tetragon -- \
  tetra getevents -o compact --namespace tools,n8n,gateway
```

Try the naked-profile pod spec Kyverno now refuses:

```bash
kubectl apply -f scenes/naked-pod.yaml   # expect: rejected by Kyverno
```

To go back to naked, remove the policies first, then redeploy:

```bash
kubectl delete -R -f deploy/policies/kyverno  --ignore-not-found
kubectl delete -R -f deploy/policies/cilium   --ignore-not-found
kubectl delete -R -f deploy/policies/tetragon --ignore-not-found

helm upgrade --install kahawa "$CHART" \
  -f "$CHART/values.yaml" -f "$CHART/values-naked.yaml" \
  --set pack="$PACK" --set image.tag="$TAG" --set llm.provider="$PROVIDER" \
  --set-string llm.mistral.apiKey="$MISTRAL_API_KEY"
```

## 15. Switch the model provider to a local Ollama (optional)

```bash
ollama pull mistral-small3.2
ollama pull nomic-embed-text
```

Run Ollama bound to the kind network's gateway address, **never** `0.0.0.0` —
Ollama's API has no authentication by default:

```bash
docker network inspect kind | jq -r '.[0].IPAM.Config[0].Gateway'   # confirm it's 172.18.0.1
OLLAMA_HOST=172.18.0.1:11434 ollama serve
```

Redeploy pointed at it:

```bash
export PROVIDER=ollama
helm upgrade --install kahawa "$CHART" \
  -f "$CHART/values.yaml" -f "$CHART/values-${PROFILE}.yaml" \
  --set pack="$PACK" --set image.tag="$TAG" --set llm.provider=ollama
```

If you're hardened, also swap the egress rule (Mistral's FQDN rule for
Ollama's CIDR rule):

```bash
kubectl delete -f deploy/policies/cilium/providers/mistral.yaml --ignore-not-found
kubectl apply  -f deploy/policies/cilium/providers/ollama.yaml
```

**Then re-run all of [section 11](#11-database-setup-and-seeding)'s truncate
and seed steps.** `mistral-embed` is 1024-wide, `nomic-embed-text` is
768-wide — embeddings from the two cannot coexist in one `vector(n)` column,
and `EMBED_DIM` only takes effect on a fresh schema apply, not a live ALTER.
Either truncate `chunks`/`documents` and re-upload, or delete the Postgres pod
entirely so `PGDATA` re-inits with the new `EMBED_DIM` from the chart.

## 16. The same sequence with `make`

Everything above, as the targets that run it:

| Section | Raw sequence | `make` target |
| --- | --- | --- |
| 3 | create the kind cluster | `make cluster` |
| 4 | Gateway API CRDs + Cilium | `make cilium` |
| 5 | Tetragon (its own release, not bundled with Cilium) | `make tetragon` |
| 6 | Kyverno base install | `make kyverno` |
| 7 | Vault + External Secrets | `make secrets` |
| 4–7 | all platform pieces | `make platform` |
| 8 | build + `kind load` every image | `make images load` |
| 9 | stage packs/prompts/files into the chart | `make stage` (also runs as part of `deploy`) |
| 10 | helm install, naked | `make deploy` (`PROFILE=naked` is the default) |
| 11 | truncate, reseed, upload the trusted doc | `make reset` |
| 12 | port-forward + Inspector list/smoke/pin | `make mcp-forward`, `make mcp-list`, `make mcp-test`, `make mcp-pin`, `make mcp-check` |
| 13 | port-forward the UI | `make ui` |
| 14 | policies + hardened redeploy | `make harden` |
| 14 (back to naked) | remove policies + naked redeploy | `make naked` |
| 15 | pull local models | `make ollama`, then `make deploy PROVIDER=ollama` |
| — | everything through section 10 in one shot | `make up` |
| — | run a scene | `make scene1` (… `scene2`, `scene3`, `scene3b`, `scene3c`, `scene4`) |
| — | change the pack without a full redeploy | `make swap PACK=health` |

`make up` = sections 3 through 10 in one call. It does **not** run section
11's seeding for you beyond what `make deploy` triggers — run `make reset`
right after, same as this runbook does by hand.

## 17. Cleanup and reset

### Reset for the next demo run (keep the cluster)

Between scenes, or before a rehearsal, you want the data and session state
back to a clean slate without tearing anything down:

```bash
make reset
```

which is exactly section 11's truncate/reseed/upload, plus switching to the
pack in `$PACK` and clearing the gateway's in-memory verdict feed and parked
actions. By hand, that's:

```bash
PG_POD=$(kubectl -n data get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')

kubectl -n data exec -i "$PG_POD" -- psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa <<'SQL'
TRUNCATE members, plots, forest_2020, dealers, products, payments,
         chunks, documents, pending_actions, audit_events RESTART IDENTITY CASCADE;
SQL

python3 scripts/_seed.py | kubectl -n data exec -i "$PG_POD" -- psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa

curl -sf -X POST http://localhost:8000/api/upload \
  -F "role=coop" -F "title=Kirinyaga Coffee Extension Notes" -F "trust=trusted" \
  -F "file=@data/seed/docs/extension_notes.md;type=text/markdown" | jq .

./scripts/admin.sh pack "$PACK"
./scripts/admin.sh reset
```

Stop any stray `kubectl port-forward` processes left over from a previous
session before you start the next one — they hold their local port open even
after a pod restarts:

```bash
pkill -f 'kubectl.*port-forward' 2>/dev/null || true
```

### Remove just the application (keep the platform)

Useful while iterating on the chart without reinstalling Cilium/Kyverno/Vault
each time:

```bash
helm uninstall kahawa
```

Postgres and Redis data disappear with their pods (both use `emptyDir`
volumes in this demo on purpose — nothing persists across a pod restart
either). Re-run sections 8–11 to bring the app back.

### Full teardown

```bash
# stop any background port-forwards you started
pkill -f 'kubectl.*port-forward' 2>/dev/null || true

# delete the cluster — this removes every Helm release, every namespace,
# every policy CRD instance, everything. There is nothing else to uninstall
# separately inside the cluster.
kind delete cluster --name "$CLUSTER"

# if you created one in section 3
docker rm -f kind-registry 2>/dev/null || true

# optional: drop the locally-built images
docker image rm $(docker image ls 'kahawa/*' -q) 2>/dev/null || true

# optional: stop a local Ollama server you started for section 15
pkill -f 'ollama serve' 2>/dev/null || true
```

`kind delete cluster` is the one command that actually matters here — every
Helm release, CRD, namespace and policy lives inside that cluster's etcd, so
deleting the cluster deletes all of it. Everything else above is housekeeping
on your host, not the cluster.
