# The Tetragon Lab — runtime enforcement in the kernel

A hands-on guide to the runtime layer of Kahawa Guard: what Tetragon is, the four
TracingPolicies this repo ships, how to run the Scene 3c kill live, how to read
the event stream, and how to prove a kill actually happened. Written against the
live policies and the `make` targets.

> **The one idea.** Every application-layer control (the guard pipeline) and even
> the network layer can be bypassed by a compromised or vulnerable *workload* —
> the records-fs server validates its own paths and gets them wrong. Tetragon
> moves the boundary **underneath the workload, into the kernel**, where the
> process cannot reach it: it hooks the real syscall/LSM event and can **kill the
> process in-kernel** before the dangerous operation completes. The workload's
> own bugs are irrelevant because the kernel, not the workload, makes the call.

## Table of contents

1. [What Tetragon is, and where it sits](#1-what-tetragon-is-and-where-it-sits)
2. [How it works: kprobes, selectors, actions](#2-how-it-works-kprobes-selectors-actions)
3. [Install & prerequisites](#3-install--prerequisites)
4. [The four policies in this repo](#4-the-four-policies-in-this-repo)
   1. [confine-records-fs (Sigkill, Scene 3c)](#41-confine-records-fs-sigkill-scene-3c)
   2. [block-shells-in-tool-pods (Sigkill)](#42-block-shells-in-tool-pods-sigkill)
   3. [kill-metadata-connect (Sigkill, Scene 3b)](#43-kill-metadata-connect-sigkill-scene-3b)
   4. [watch-sa-token-reads (observe)](#44-watch-sa-token-reads-observe)
5. [Running the Scene 3c kill, start to finish](#5-running-the-scene-3c-kill-start-to-finish)
6. [Reading the event stream](#6-reading-the-event-stream)
7. [Proving a kill happened (exit 137)](#7-proving-a-kill-happened-exit-137)
8. [The `make events*` targets](#8-the-make-events-targets)
9. [Deny-list vs allow-list: the 3c policy choice](#9-deny-list-vs-allow-list-the-3c-policy-choice)
10. [Teardown & toggling](#10-teardown--toggling)
11. [Troubleshooting](#11-troubleshooting)
12. [File map](#12-file-map)

## 1. What Tetragon is, and where it sits

Tetragon is an eBPF-based runtime security tool (from the Cilium project). It
attaches small programs to kernel hook points — syscalls, LSM hooks, kprobes —
and can **observe** or **act** on what a process does, in the kernel, before the
operation returns to user space. Because the decision happens in the datapath,
the monitored process is not consulted and cannot fake or bypass it.

In the Kahawa Guard stack it is the **runtime layer** — the fifth of six defence
layers:

```text
app pipeline   L1/L2/L3/L4     "is this input/action allowed?"   (the gateway)
network        Cilium          "can this packet leave?"          (kernel, L3/L4/L7)
runtime        Tetragon        "can this process even try?"      (kernel, syscalls) ← this lab
admission      Kyverno         "could this have shipped?"        (API server)
```

It runs as a **DaemonSet** (`ds/tetragon` in `kube-system`) — one agent per node.
In this single-node kind cluster that is one pod. It is **hardened-only**: the
TracingPolicies are applied by `make harden` (or `kubectl apply` by hand); naked
has no runtime policy at all, which is why the Scene 3c escapes leak there.

## 2. How it works: kprobes, selectors, actions

A `TracingPolicy` is a CRD (`cilium.io/v1alpha1`). The shape used throughout this
repo:

```yaml
spec:
  podSelector:              # which pods this applies to (omit = clusterwide)
    matchLabels: { app: records-fs }
  kprobes:
    - call: "security_file_open"   # the kernel hook to attach to
      syscall: false               # it is an LSM hook, not a raw syscall
      args:
        - index: 0
          type: "file"             # how to interpret arg 0
      selectors:
        - matchArgs:               # the condition
            - index: 0
              operator: "Prefix"   # Prefix | Postfix | Equal | NotPrefix | ...
              values: ["/srv/records-evil/"]
          matchActions:
            - action: Sigkill      # Sigkill | Post | Override | ...
```

The three moving parts:

- **The hook (`call`).** Where in the kernel to watch. This repo uses
  `security_file_open` (every file open, after path resolution),
  `security_file_permission` (file access check), `security_bprm_check` (a program
  about to be exec'd), and `tcp_connect` (an outbound connection).
- **The selector (`matchArgs`).** A condition on an argument. `Prefix`/`Postfix`
  match the start/end of a path or string; `NotPrefix` matches anything *not*
  under a set of prefixes. **Because the hook fires after path resolution, the
  argument is the REAL target — a symlink is already resolved.** That is the
  whole reason Tetragon beats the records-fs string check.
- **The action (`matchActions`).**
  - `Sigkill` — kill the offending process in-kernel (enforcement).
  - `Post` — emit an event only (observation).
  - (others exist, e.g. `Override` to fake a return value; not used here.)

## 3. Install & prerequisites

Tetragon is installed as part of the platform layer:

```bash
make tetragon       # helm install into kube-system, waits for the DaemonSet
# or the whole platform at once:
make platform       # cilium + tetragon + kyverno + vault/ESO
```

It uses `deploy/platform/tetragon-values.yaml`:

```yaml
tetragon:
  hostProcPath: /proc        # needed on kind (the host /proc mount)
  enableProcessCred: true    # capture process credentials (caps, uid)
  enableProcessNs: true      # capture namespace info for k8s enrichment
```

Confirm the agent is up:

```bash
kubectl -n kube-system rollout status ds/tetragon
kubectl -n kube-system get pods -l app.kubernetes.io/name=tetragon
```

The TracingPolicies are *not* applied by the install — they go on with
`make harden`, or individually with `kubectl apply -f deploy/policies/tetragon/...`
(which is how the Scene 3c lab applies just the one it needs).

## 4. The four policies in this repo

All live in `deploy/policies/tetragon/`.

| Policy | Hook | Scope | Action | Scene |
| --- | --- | --- | --- | --- |
| `confine-records-fs` | `security_file_open` | `app: records-fs` | **Sigkill** | 3c |
| `block-shells-in-tool-pods` | `security_bprm_check` | `kahawa.io/tier: tools` | **Sigkill** | (Q&A / hardening) |
| `kill-metadata-connect` | `tcp_connect` | clusterwide | **Sigkill** | 3b |
| `watch-sa-token-reads` | `security_file_permission` | clusterwide | **Post** (observe) | (SA-token read) |

### 4.1 confine-records-fs (Sigkill, Scene 3c)

The headline policy. records-fs is vulnerable by design (the EscapeRoute flaw
class, CVE-2025-53109 / 53110): it decides for itself which paths it may read,
with a bare string-prefix check, and gets fooled by a sibling directory and by a
symlink. This policy moves the boundary into the kernel.

```yaml
podSelector: { matchLabels: { app: records-fs } }
kprobes:
  - call: "security_file_open"
    selectors:
      - matchArgs:
          - index: 0
            operator: "Prefix"
            values: ["/srv/records-evil/"]
        matchActions:
          - action: Sigkill
```

- The **legit read** (`/srv/records/member-KG-0001.txt`) does not match → runs
  normally.
- The **prefix bypass** (`/srv/records-evil/secret.txt`) matches → the process is
  **killed** before the read returns.
- The **symlink bypass** (`/srv/records/backdoor-link.txt`): the server's string
  check sees "inside /srv/records" and allows it, but `security_file_open` fires
  on the **resolved** target `/srv/records-evil/secret.txt` → matches → **killed.**
  The server's string and the kernel's resolved view disagree, and the kernel
  wins. That is the entire lesson of Scene 3c.

This repo uses a **deny-list** (kill opens into the forbidden dir) rather than a
positive allow-list (confine to `/srv/records`); see §9 for why.

### 4.2 block-shells-in-tool-pods (Sigkill)

Any attempt to exec a shell inside a tool-tier pod is killed. Applies to pods
labelled `kahawa.io/tier: tools` (kahawa-tools, farm-weather, records-fs, n8n).

```yaml
podSelector: { matchLabels: { kahawa.io/tier: tools } }
kprobes:
  - call: "security_bprm_check"          # a program about to be exec'd
    selectors:
      - matchArgs:
          - index: 0
            operator: "Postfix"
            values: ["/sh", "/bash", "/dash"]
        matchActions:
          - action: Sigkill
```

- **Protects against:** a compromised tool image, or an n8n Code/Execute-Command
  node, spawning a shell to pivot or run arbitrary commands.
- `security_bprm_check` fires at exec, so the shell is killed before its first
  instruction. `Postfix` on the binary path catches `/bin/sh`, `/bin/bash`, etc.
- **Demo it:** `kubectl -n tools exec -it deploy/kahawa-tools -- sh` is killed the
  instant the shell execs.

### 4.3 kill-metadata-connect (Sigkill, Scene 3b)

```yaml
kprobes:
  - call: "tcp_connect"
    selectors:
      - matchArgs:
          - index: 0
            operator: "DAddr"
            values: ["169.254.169.254"]
        matchActions:
          - action: Sigkill
```

- **Protects against:** SSRF to the cloud metadata endpoint (the Scene 3b pivot).
- Clusterwide: any process on any node that opens a TCP connection to
  `169.254.169.254` is killed.
- **Layering note:** Cilium's `deny-cloud-metadata` already *drops the packet* at
  the network layer. This policy additionally *kills the process* so the room
  sees the difference between "connection refused" and "the thing is gone".
- **Caveat for Scene 3b as scripted:** the scene fetches `fake-imds`, an ordinary
  cluster service, **not** `169.254.169.254`, so this policy does **not** fire on
  that run — default-deny drops it instead. Point `fetch_url` at the metadata IP
  to trigger this policy. (See `SECURITY-LANDSCAPE.md §10`.)

### 4.4 watch-sa-token-reads (observe)

```yaml
kprobes:
  - call: "security_file_permission"
    selectors:
      - matchArgs:
          - index: 0
            operator: "Prefix"
            values: ["/var/run/secrets/kubernetes.io/serviceaccount"]
        matchActions:
          - action: Post          # record, do NOT kill
```

- **Protects against (by recording):** service-account-token theft — reading the
  mounted token to talk to the API server.
- Reading the token is not itself an attack (kubelet and legitimate clients do
  it), so this **observes** rather than kills. The recording is the evidence shown
  on stage. In hardened, workloads also have `automountServiceAccountToken:
  false`, so there is usually no token to read in the first place.

## 5. Running the Scene 3c kill, start to finish

You run the cluster commands; nothing here runs itself.

```bash
# 0. hardened records-fs confinement needs the policy applied. Start from naked
#    (no policy) so you can show the before/after.

# 1. Terminal A — the clean kill view, started FIRST (the stream is live-only,
#    it does NOT replay past events).
make events-3c

# 2. Terminal B — show the escapes LANDING with no policy (optional recap):
make scene3c
#    calls 2 & 3 return the fake secret.

# 3. Apply the kernel boundary:
kubectl apply -f deploy/policies/tetragon/confine-records-fs.yaml

# 4. Re-run the scene:
make scene3c
```

After step 4, in Terminal B the scene prints:

- call 1 → the record (legit read still works);
- calls 2 & 3 → `(no response this call …)` — the process was killed before it
  could reply, so no secret comes back.

And in Terminal A (`make events-3c`) you see the three `server.py` exits:
`0`, `137`, `137` (see §7).

## 6. Reading the event stream

`tetra getevents` is a **live stream** — it prints nothing until an event occurs
and does **not** replay history, so it must be running *before* the action. Each
line is one process event; the icons:

- `🚀 process` — a process was exec'd.
- `💥 exit` — a process exited, with its exit code at the end of the line.
- `🛑 CAP_SYS_ADMIN` and similar — a capability annotation (normal node/runc
  chatter on kind; not the attack).

The raw stream is noisy (postgres, redis, runc, kubelet). Two things cut it down:
the namespace filter (`make events`) and the Scene 3c signal filter
(`make events-3c`, §8).

> **Why a pretty "Sigkill security_file_open" line may not appear.** In `-o
> compact` you are seeing the node-level process tree, and the in-pod kprobe
> event's Kubernetes enrichment can lose the race for a process that is killed
> almost instantly. What reliably surfaces is the **exit 137** of the killed
> process (§7). For the structured kill event, use `-o json` and look for the
> `process_kprobe` with `action: "KPROBE_ACTION_SIGKILL"` and the policy name.

## 7. Proving a kill happened (exit 137)

The unambiguous, always-present signal is the **exit code** of the per-call
`python3 server.py` process that Scene 3c spawns via `kubectl exec -i`:

```text
exit ... "... exec -i records-fs-... -- python3 server.py" 0     ← call 1: legit read, ran to completion
exit ... "... exec -i records-fs-... -- python3 server.py" 137   ← call 2: SIGKILL
exit ... "... exec -i records-fs-... -- python3 server.py" 137   ← call 3: SIGKILL
```

**137 = 128 + 9**, the shell/exit convention for "terminated by signal 9
(SIGKILL)". That is exactly Tetragon's `action: Sigkill`. The contrast — `0` on
the legit read, `137` on both escapes, same tool, differing only by which file it
opened — is the on-stage proof that the kernel enforced the boundary the
vulnerable server could not.

For the structured event instead:

```bash
kubectl exec -n kube-system ds/tetragon -c tetragon -- tetra getevents -o json \
  | jq 'select(.process_kprobe.policy_name=="confine-records-fs")
        | {binary: .process_kprobe.process.binary,
           file: .process_kprobe.args[0].file_arg.path,
           action: .process_kprobe.action}'
```

## 8. The `make events*` targets

| Target | What it streams | Use when |
| --- | --- | --- |
| `make events` | compact, filtered to `--namespace tools,n8n,gateway` | general watching |
| `make events-all` | compact, **no** namespace filter | catching short-lived killed procs the namespace filter drops |
| `make events-3c` | compact, grepped to `server.py / Sigkill / SIGKILL` | the clean Scene 3c view — shows just the `0 / 137 / 137` story |

All three run `tetra getevents` inside the Tetragon pod. Start the one you want
**before** firing the scene. Note the namespace filter (`make events`) can hide
the records-fs kill, because the enrichment race leaves the short-lived killed
process without a namespace label — that is why `events-3c` / `events-all` exist.

## 9. Deny-list vs allow-list: the 3c policy choice

There are two ways to write `confine-records-fs`, and this repo chose the first:

- **Deny-list (shipped).** `Prefix` match on `/srv/records-evil/` → Sigkill. Kills
  reads *into* the forbidden area. **Robust:** never kills the server on startup or
  the legit read, needs no per-image tuning. Still proves the point, because the
  symlink resolves into the forbidden dir and is caught on the real open.
- **Allow-list (documented alternative).** `NotPrefix` on the set of paths the
  process legitimately needs (`/srv/records/`, `/usr/`, `/lib/`, `/etc/`,
  `/proc/`, `/srv/server.py`, …) → Sigkill everything else. **Stronger** positive
  containment ("confine to /srv/records, kill all else"), but it **must be tuned
  against the exact image** or it kills the server on startup (Python opens its
  own script, `ld.so.cache`, shared libs, etc.). The policy file documents how to
  switch to this form if you want it.

For a live demo the deny-list is the safe, no-tuning choice; for a real
production confinement you would invest in the allow-list and test it.

## 10. Teardown & toggling

```bash
# apply just the 3c policy
kubectl apply -f deploy/policies/tetragon/confine-records-fs.yaml
# remove it (back to the naked, leaky behaviour)
kubectl delete -f deploy/policies/tetragon/confine-records-fs.yaml

# all runtime policies at once
kubectl apply  -R -f deploy/policies/tetragon     # (also done by make harden)
kubectl delete -R -f deploy/policies/tetragon     # (also done by make naked)

# list what is loaded
kubectl get tracingpolicies
```

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `make events*` shows nothing | stream started *after* the action (live-only) | start it first, then fire the scene |
| kill not visible but behaviour is blocked | namespace-filter dropped the short-lived process | use `make events-all` / `make events-3c` |
| legit read (call 1) also killed | you switched to the allow-list form and missed a runtime prefix | add the missing prefix, or use the shipped deny-list |
| records-fs pod itself dies | an allow-list policy too narrow (kills `server.py` on startup) | same as above |
| no kills at all after apply | policy not loaded, or pod lacks the selector label | `kubectl get tracingpolicies`; check pod labels (`app: records-fs`, `kahawa.io/tier: tools`) |
| Scene 3b: `kill-metadata-connect` never fires | the scene targets `fake-imds`, not `169.254.169.254` | point `fetch_url` at the metadata IP (§4.3) |
| `tetra: command not found` style errors | wrong container | it runs *inside* the agent: `kubectl exec -n kube-system ds/tetragon -c tetragon -- tetra …` |

## 12. File map

| Thing | Where |
| --- | --- |
| The four policies | `deploy/policies/tetragon/*.yaml` |
| Install values | `deploy/platform/tetragon-values.yaml` |
| Install target | `Makefile` → `tetragon` (and `platform`) |
| Apply/remove in bulk | `Makefile` → `harden` / `naked` |
| Event stream targets | `Makefile` → `events`, `events-all`, `events-3c` |
| The scene that exercises 3c | `scenes/scene3c.sh` (`make scene3c`) |
| The vulnerable server | `mcp/records-fs/server.py`, `mcp/records-fs/Dockerfile` |
| Narrative & caveats | `Docs/SCENES.md` (3c), `Docs/SECURITY-LANDSCAPE.md` §6, `Docs/PROVE-IT.md` §E |
