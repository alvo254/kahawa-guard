# Kahawa Guard: Cluster Networking Postmortem

What actually broke, across the first full bring-up of this cluster inside an
OrbStack Ubuntu VM, and exactly what fixed each thing — from a kind cluster
that couldn't even get its nodes to `Ready`, through to a real, verified
`200 OK` from Mistral's API.

Two genuinely different classes of problem turned up, and it matters to keep
them separate: **misconfiguration bugs we introduced** (wrong Cilium settings,
an unset shell variable, a wrong assumption about how Tetragon ships) versus
**an unreliable network path out of this specific VM** (DNS and HTTP/80
egress misbehaving in ways no config change on our side could fix, only work
around). The fixes for the first class are permanent and portable anywhere.
The fixes for the second class are specific to this OrbStack environment and
may not apply, or may need redoing, elsewhere.

## Table of contents

1. [Summary](#1-summary)
2. [Failure: Cilium refused to start at all](#2-failure-cilium-refused-to-start-at-all)
3. [Failure: the API server hostname resolved to nothing](#3-failure-the-api-server-hostname-resolved-to-nothing)
4. [Pattern: intermittent DNS and HTTP flakiness out of the VM](#4-pattern-intermittent-dns-and-http-flakiness-out-of-the-vm)
5. [Failure: the Postgres image couldn't apt-get anything](#5-failure-the-postgres-image-couldnt-apt-get-anything)
6. [Failure: every pod's external DNS lookup timed out](#6-failure-every-pods-external-dns-lookup-timed-out)
7. [Getting to Mistral: the key was never actually set](#7-getting-to-mistral-the-key-was-never-actually-set)
8. [Confirmed working state](#8-confirmed-working-state)
9. [What's portable versus OrbStack-specific](#9-whats-portable-versus-orbstack-specific)
10. [If this happens again](#10-if-this-happens-again)

## 1. Summary

| # | Failure | Root cause | Class | Fix |
| --- | --- | --- | --- | --- |
| 1 | Cilium agents crash-looped, no node ever went `Ready` | `autoDirectNodeRoutes: true` and `installNoConntrackIptablesRules: true` both set alongside `routingMode: tunnel` — each is fatal in combination with tunnel mode | our misconfiguration | removed both settings from `cilium-values.yaml` |
| 2 | Cilium agents crashed with `lookup -control-plane: no such host` | `$CLUSTER` was unset in the shell that ran `helm upgrade`, so `--set k8sServiceHost="${CLUSTER}-control-plane"` rendered an empty-prefixed, unresolvable hostname | our misconfiguration (session state) | re-ran with the hostname hardcoded |
| 3 | Several image pulls (`quay.io`, `reg.kyverno.io`) failed then succeeded on retry | TLS handshake timeouts / DNS `server misbehaving` to specific CDN-fronted hosts | VM network flakiness | none needed — self-cleared on kubelet's own retry/backoff |
| 4 | Postgres image build: `apt-get update` failed outright, then failed differently after switching to HTTPS | OrbStack blocks outbound port 80 entirely; its HTTPS interception needs `ca-certificates`, which isn't installed in the base image | VM network policy + missing package | HTTPS sources + a scoped, temporary unverified bootstrap to install `ca-certificates`, then full verification restored |
| 5 | Every gateway outbound call (`api.mistral.ai`, embeddings, chat) failed with `Temporary failure in name resolution` | CoreDNS forwards external queries to the node's own resolver, which is OrbStack's embedded DNS proxy (`0.250.250.254`) — that proxy was timing out on 100% of queries, for any hostname | VM network flakiness (sustained, not transient) | patched CoreDNS's `Corefile` to forward directly to `8.8.8.8`/`1.1.1.1`, bypassing the proxy entirely |
| 6 | `/api/chat` returned `500`, then later `Illegal header value b'Bearer '` | `MISTRAL_API_KEY` was never actually passed to the Helm release — `.env` is not read by the deployed pod, only by local dev tooling | our misconfiguration | `--set-string llm.mistral.apiKey=...` on the `helm upgrade` |

By the end: Mistral's `/v1/embeddings` endpoint returned a real `200 OK`, and
`/v1/chat/completions` returned a `429` — Mistral's own rate limit, not a bug
anywhere in this stack. That `429` is in this table as confirmation the whole
chain works, not as a problem that needed fixing.

## 2. Failure: Cilium refused to start at all

First symptom, from `kubectl get pods -A`: every `cilium-*` agent pod stuck
`Init:CrashLoopBackOff` or similar, no node ever reporting `Ready`, and
therefore everything downstream — `coredns`, `local-path-provisioner`, every
app pod — stuck `Pending` forever (kind nodes stay `NotReady`, and the
scheduler won't place ordinary pods on a `NotReady` node, until a CNI finishes
installing).

The actual crash, from the agent's own log:

```
level=fatal msg="auto-direct-node-routes cannot be used withtunneling. Packets must be routed through the tunnel device."
```

`deploy/platform/cilium-values.yaml` had both set:

```yaml
routingMode: tunnel
autoDirectNodeRoutes: true
```

These are mutually exclusive by design. Tunnel mode wraps every inter-node
packet in a VXLAN/Geneve envelope and routes it through the tunnel interface;
`autoDirectNodeRoutes` is a *native*-routing feature that wires direct host
routes bypassing any tunnel. Both settings came from an original pasted
`helm install` command and were never meant to coexist.

Fixed by removing `autoDirectNodeRoutes` — redeployed, and a **second**,
different fatal error appeared from the exact same family:

```
level=fatal msg="install-no-conntrack-iptables-rules requires the agent to run in direct routing mode."
```

Same cause, different setting: `installNoConntrackIptablesRules: true` is
also native-mode-only. Tunnel mode still needs Cilium's default iptables
conntrack rules for correct tracking around the VXLAN interface; skipping
them is only safe when eBPF handles the equivalent at the datapath level,
which only happens in native mode. Removed it too.

Both fixes were verified against the real Cilium 1.20.3 chart (`helm
template` against the actual chart, not just a YAML syntax check) before
being declared fixed.

## 3. Failure: the API server hostname resolved to nothing

With the routing conflicts cleared, a **third**, unrelated crash appeared —
all three agents failing in lockstep at the exact same init step:

```
error="Get \"https://-control-plane:6443/api/v1/namespaces/kube-system\": dial tcp: lookup -control-plane: no such host"
```

The hostname being resolved was `-control-plane` — missing the `kahawa`
prefix entirely. The install command was:

```bash
helm upgrade --install cilium cilium/cilium --version "$CILIUM_VERSION" \
  -n kube-system -f deploy/platform/cilium-values.yaml \
  --set k8sServiceHost="${CLUSTER}-control-plane"
```

`$CLUSTER` was exported early in the session but the shell that actually ran
this particular `helm upgrade` had lost it (a different terminal pane, or a
long gap — the usual way an exported variable quietly stops being exported).
`${CLUSTER}-control-plane` with an empty `$CLUSTER` renders to literally
`-control-plane`, which is not a real hostname anywhere.

Fixed by hardcoding the real value instead of relying on the variable again:
`--set k8sServiceHost=kahawa-control-plane` — the actual Docker container
name for the control-plane node, resolvable via Docker's own embedded DNS on
the shared `kind` bridge network every node container sits on.

## 4. Pattern: intermittent DNS and HTTP flakiness out of the VM

Before the two failures below, which both got permanent fixes, the same
general symptom showed up twice and **cleared on its own**:

- `cilium-plfv6`'s init container failed to pull `quay.io/cilium/cilium` with
  `net/http: TLS handshake timeout` reaching `cdn01.quay.io` — confirmed via a
  raw TCP connect test from inside the node (`port 443: CONNECTED`, immediate
  success on retest), so this was a one-off blip in that specific pull
  attempt, not a systemic block. Cleared after deleting the pod to force an
  immediate retry rather than wait out kubelet's backoff.
- Kyverno's `admission-controller` and `background-controller` both failed to
  pull their images with `dial tcp: lookup reg.kyverno.io on 0.250.250.254:53:
  server misbehaving`, then **succeeded** on a later retry without any config
  change — direct evidence the resolver at `0.250.250.254` (OrbStack's
  embedded DNS proxy) was intermittently failing, not permanently broken, at
  that point in time.

Both are included here because they're the first direct evidence of the
resolver that failure #6 later nails down conclusively — at this stage it
still looked like ordinary network jitter, not something to patch.

## 5. Failure: the Postgres image couldn't apt-get anything

Building `data/postgres/Dockerfile` (originally `FROM postgis/postgis:16-3.4`)
failed on `apt-get install postgresql-16-pgvector`:

```
E: Unable to locate package postgresql-16-pgvector
```

masking a prior, more informative line further up:

```
W: Failed to fetch http://deb.debian.org/debian/dists/bookworm/InRelease
   Could not connect to debian.map.fastlydns.net:80 ... Connection refused
```

Two separate things, confirmed directly rather than assumed:

**The base image itself.** `docker buildx imagetools inspect postgis/postgis`
across every tag tried (`16-3.4`, `16-3.5`, `16-3.6`, `17-3.5`, `17-3.6`,
`latest`) showed `linux/amd64` only — no arm64 manifest exists for that image
at all. The official `postgres:16-bookworm` image, checked the same way, is
genuinely multi-arch (`linux/arm64/v8` included). Switched the base image.

**The network itself.** A raw TCP test from inside `postgres:16-bookworm`
showed port 80 outright unreachable (`Network is unreachable`) while port 443
connected fine — OrbStack blocks plain HTTP and expects everything over
HTTPS, which it intercepts with its own injected root CA
(`/etc/ssl/certs/orbstack-root.crt`, found sitting in the base image).
`ca-certificates` wasn't installed at all, so there was nothing to verify
against even after switching the apt sources to `https://`.

Fixed with a sequence tested live, container by container, before it ever
went into the Dockerfile:

1. Stage `orbstack-root.crt` into `/usr/local/share/ca-certificates/` if it
   exists (a no-op anywhere this file doesn't exist).
2. Switch the Debian and PGDG apt sources from `http://` to `https://`.
3. Bootstrap past the chicken-and-egg problem — installing `ca-certificates`
   itself needs a verified HTTPS fetch, which needs `ca-certificates` — with
   a **temporary**, narrowly-scoped `apt.conf.d` override disabling cert
   verification, removed immediately after that one package installs.
4. Restore full verification and install the real target packages
   (`postgresql-16-postgis-3`, `postgresql-16-postgis-3-scripts`,
   `postgresql-16-pgvector`) normally, fully verified.

Verified for real: built natively on arm64 (`docker build --no-cache`, exit
0), then ran the image and confirmed `CREATE EXTENSION postgis` and
`CREATE EXTENSION vector` both actually work against a live database.

## 6. Failure: every pod's external DNS lookup timed out

Once the application was deployed, the gateway's very first chat request
failed:

```
httpx.ConnectError: [Errno -3] Temporary failure in name resolution
```

reaching `api.mistral.ai`. Narrowed down methodically rather than assumed:

```bash
# is this specific to api.mistral.ai, or general?
kubectl -n gateway exec deploy/gateway -- python3 -c \
  "import socket; print(socket.gethostbyname('github.com'))"
# -> socket.gaierror: [Errno -3] Temporary failure in name resolution

# what's the pod's own resolver?
kubectl -n gateway exec deploy/gateway -- cat /etc/resolv.conf
# -> nameserver 10.96.0.10   (CoreDNS's ClusterIP — correct, not the bug)

# what does CoreDNS itself see?
kubectl -n kube-system logs -l k8s-app=kube-dns --tail=30 --since=10m
# -> [ERROR] plugin/errors: 2 api.mistral.ai. A: read udp
#    10.244.0.153:43042->0.250.250.254:53: i/o timeout
# -> [ERROR] plugin/errors: 2 github.com. A: read udp
#    10.244.2.239:...->0.250.250.254:53: i/o timeout
```

`github.com` failed identically to `api.mistral.ai` — this was never specific
to Mistral. CoreDNS was receiving every query correctly and forwarding it
exactly where it should (its own Corefile had `forward . /etc/resolv.conf`,
i.e. "trust whatever the node says"), and the node's resolver is the same
`0.250.250.254` OrbStack proxy from section 4 — except this time it was a
**sustained** 100% timeout across 10+ minutes and multiple hosts, not a
transient blip that would clear with a retry.

Fixed by patching CoreDNS's `Corefile` to forward directly to public
resolvers instead of the stuck proxy:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health { lameduck 5s }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        forward . 8.8.8.8 1.1.1.1 {
           max_concurrent 1000
        }
        cache 30
        loop
        reload
        loadbalance
    }
EOF
kubectl -n kube-system rollout restart deployment coredns
```

Confirmed, not assumed: `socket.gethostbyname('api.mistral.ai')` from inside
the gateway pod afterward returned a real IP (`172.66.2.203`).

This only changes where CoreDNS forwards *external* (non-`cluster.local`)
lookups. In-cluster service discovery, and anything on the nodes themselves
(outside Kubernetes, like `apt` in section 5), is untouched.

## 7. Getting to Mistral: the key was never actually set

With DNS fixed, the next `/api/chat` call failed differently:

```
WARNING app.pipeline.model model call failed: Illegal header value b'Bearer '
```

`Bearer ` with nothing after it — `MISTRAL_API_KEY` was an empty string.
`.env` at the repo root was never actually wired to the deployed pod: it's
read by `pydantic-settings` only when the gateway runs directly on a host
next to that file; the Docker image never copies `.env` in, and the Helm
chart has no mechanism that reads it either. The chart's `MISTRAL_API_KEY`
secret comes purely from `.Values.llm.mistral.apiKey`, which is simply absent
from `values.yaml` by default (the `secrets.yaml` template's `default ""`
renders empty rather than erroring on the missing key).

Fixed by sourcing `.env` into the shell and passing it through explicitly:

```bash
set -a; source .env; set +a
helm upgrade --install kahawa deploy/helm/kahawa-guard \
  -f deploy/helm/kahawa-guard/values.yaml -f deploy/helm/kahawa-guard/values-naked.yaml \
  --set pack=coffee --set image.tag="$TAG" --set llm.provider=mistral \
  --set-string llm.mistral.apiKey="$MISTRAL_API_KEY"
```

One hiccup along the way: the very first attempt at this `helm upgrade`
failed with an unrelated-looking

```
Error: UPGRADE FAILED: YAML parse error on kahawa-guard/templates/attacker/fake-imds.yaml:
error converting YAML to JSON: yaml: line 25: mapping values are not allowed in this context
```

Reproducing the exact same command locally with a fake key rendered that
template perfectly cleanly, which ruled out the template itself as the bug —
the leading theory was the real key containing a `,` or `=`, both significant
to Helm's `--set` parsing mini-language, corrupting the values merge in a way
that surfaced as an unrelated-looking template error. A plain retry of the
identical command succeeded on the next attempt (`REVISION: 2`), so this was
never conclusively root-caused — logged here as a known rough edge, not a
fixed one. If it recurs, `--set-file llm.mistral.apiKey=<path-to-key-file>`
sidesteps `--set`'s parsing entirely and is the more robust option.

## 8. Confirmed working state

Not asserted — read directly from the gateway's own log on a real request:

```
INFO httpx HTTP Request: POST https://api.mistral.ai/v1/embeddings "HTTP/1.1 200 OK"
INFO httpx HTTP Request: POST https://api.mistral.ai/v1/chat/completions "HTTP/1.1 429 Too Many Requests"
```

The `429` is Mistral's own rate limit on the account/key — not a defect
anywhere in this stack. It's proof the whole chain (DNS → TLS → auth) is
intact: a request that's wrong at the network or auth layer doesn't get far
enough to be told "too many requests" by the far end.

## 9. What's portable versus OrbStack-specific

| Fix | Portable to any environment | OrbStack-specific |
| --- | --- | --- |
| Removing `autoDirectNodeRoutes` / `installNoConntrackIptablesRules` | ✅ always wrong under `routingMode: tunnel`, anywhere | |
| Hardcoding the control-plane hostname | ✅ a shell-state bug, not environment-specific | |
| `postgres:16-bookworm` instead of `postgis/postgis` | ✅ fixes real multi-arch gap, matters on any arm64 host | |
| Trusting `orbstack-root.crt` if present | | conditional — literally checks for OrbStack's own file, no-op elsewhere |
| HTTPS apt sources + `ca-certificates` bootstrap | mostly ✅ (HTTPS sources are good practice anywhere) | the *reason* it was needed (port 80 blocked) is OrbStack's network policy |
| CoreDNS forwarding straight to `8.8.8.8`/`1.1.1.1` | works anywhere, but | only *necessary* because OrbStack's embedded proxy was stuck — on a healthy network this is a style choice, not a fix |
| `--set-string`/`--set-file` for the API key | ✅ general Helm hygiene | |

If this repo moves to a different host (a cloud VM, a different Mac
virtualization tool, bare-metal Linux), re-check section 6 and section 5
specifically before assuming they're still needed — the underlying network
conditions that made them necessary may not exist there, and the CoreDNS
patch in particular is worth reverting to `forward . /etc/resolv.conf` if the
host's own resolver is reliable, so cluster DNS stays consistent with
whatever DNS policy that host actually wants.

## 10. If this happens again

- A `Pending` pod almost everywhere, with only CNI-adjacent DaemonSets
  progressing, means **the CNI isn't up yet** — check `cilium-*` agent logs
  first, not the `Pending` pods themselves.
- `Init:CrashLoopBackOff` or a fatal message in a Cilium agent's log is almost
  always a real, deterministic config conflict — `cilium status --wait`
  hanging is a symptom, the agent's own log (`kubectl logs <pod> --previous`)
  has the actual reason every time it happened tonight.
- An image pull failing with a TLS timeout or DNS "server misbehaving" to one
  specific CDN-fronted host, where a *sibling* pod pulling the same image
  succeeds, is transient — force a retry (`kubectl delete pod ...`) before
  assuming it's a real problem.
- The same failure sustained across 10+ minutes and multiple unrelated
  hostnames is not transient — check `kubectl -n kube-system logs -l
  k8s-app=kube-dns` for the exact upstream address CoreDNS is timing out
  against, same as section 6.
- A `500` from `/api/chat` with nothing useful in the response body: check
  the gateway's own log, not the UI — `kubectl -n gateway logs -l app=gateway
  --tail=60`. Every failure in this document that reached the gateway showed
  up there in plain English.
