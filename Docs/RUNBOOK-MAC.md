# Kahawa Guard: Mac Setup (OrbStack)

`RUNBOOK.md` is written for native Linux — a real machine, a cloud VM, or any
shell already running on Linux. On a Mac there's no Linux kernel underneath
you at all, so before any of that document applies, you need to get into a
real Linux environment first. This doc is that step, and it hands off to
`RUNBOOK.md` the moment you're there.

**A note on shells, since it matters for which commands below actually work.**
Your Mac's shell is fish. The Ubuntu machine OrbStack gives you runs bash by
default (nothing installs fish in there). So:
- Every command in **"On your Mac"** blocks below is fish syntax.
- Every command in **"Inside the Ubuntu machine"** blocks is bash/POSIX —
  identical to `RUNBOOK.md`, because once you're in there, you *are* the
  native-Linux case.

Writing the Ubuntu-side commands in fish would just make them wrong; fish
isn't installed there and the install scripts below assume bash.

## Table of contents

1. [Which path do you actually need?](#1-which-path-do-you-actually-need)
2. [Install OrbStack](#2-install-orbstack)
3. [Path A — OrbStack as your Docker backend only](#3-path-a--orbstack-as-your-docker-backend-only)
4. [Path B — a dedicated Linux machine](#4-path-b--a-dedicated-linux-machine)
5. [Verify the kernel is ready for Tetragon and Cilium](#5-verify-the-kernel-is-ready-for-tetragon-and-cilium)
6. [Install the toolchain inside the machine](#6-install-the-toolchain-inside-the-machine)
7. [Where your repo lives](#7-where-your-repo-lives)
8. [Reaching the cluster and the UI from your Mac](#8-reaching-the-cluster-and-the-ui-from-your-mac)
9. [Hand off to RUNBOOK.md](#9-hand-off-to-runbookmd)
10. [Cleanup — the OrbStack layer](#10-cleanup--the-orbstack-layer)

## 1. Which path do you actually need?

Two different setups both get called "running kind in OrbStack," and they
lead to completely different next steps:

| | Path A | Path B |
| --- | --- | --- |
| What it is | OrbStack is just your Docker Desktop replacement | A dedicated, named Linux VM (OrbStack's "Linux machines" feature) |
| Where `kind create cluster` runs | Directly in your Mac's fish terminal | Inside the Linux machine's own shell (bash) |
| Where `kubectl`/`helm`/etc. need installing | Already on your Mac | Inside the Linux machine |
| Extra "connect to it" step needed? | No — `kind` already writes a working `~/.kube/config` on your Mac | Only if you want your Mac's own `kubectl` to reach it too (section 8) |

If you haven't deliberately created a named machine (no `orb create`
anywhere in your history), you're on Path A — skip to
[section 3](#3-path-a--orbstack-as-your-docker-backend-only) and you're
probably already done. If you did create one (as in the `Containerlab`
session this doc grew out of), you're on Path B — read
[section 4](#4-path-b--a-dedicated-linux-machine) onward.

## 2. Install OrbStack

On your Mac (fish):

```fish
brew install --cask orbstack
```

Open it once from Spotlight/Applications so it finishes its first-run setup
and installs its CLI (`orb`) and Docker-compatible socket.

## 3. Path A — OrbStack as your Docker backend only

If OrbStack set itself as your current Docker context (it does this by
default), `kind` run from your Mac terminal already talks to OrbStack's
engine, and the resulting kubeconfig already points somewhere your Mac can
reach — OrbStack forwards published container ports out to `127.0.0.1` on
the Mac host, the same way Docker Desktop does.

On your Mac (fish):

```fish
docker context ls              # confirm "orbstack" or similar is current
docker ps                       # confirm it actually talks to OrbStack
```

That's it. Nothing else in this document applies to you — go straight to
`RUNBOOK.md` section 3 (`kind create cluster`) and run everything from your
normal Mac terminal.

The one thing still worth doing from this path is the kernel check in
[section 5](#5-verify-the-kernel-is-ready-for-tetragon-and-cilium), run
against a throwaway container, since Tetragon's BTF requirement and
Cilium's netkit datapath care about the kernel underneath OrbStack's Docker
engine either way.

## 4. Path B — a dedicated Linux machine

Why you'd choose this over Path A: a named machine gives you a normal,
persistent Ubuntu shell you can `ssh` into, install a full toolchain in, and
leave running — closer to the "small Linux VM" the project's plan always
assumed for Mac, and an easy way to keep this demo's tools cleanly separated
from anything else on your Mac.

On your Mac (fish):

```fish
orb create ubuntu kahawa-guard

# enter it — either works; `orb` is the quicker day-to-day one
orb shell kahawa-guard
# or: ssh kahawa-guard@orb
```

(Check `orb --help` / `orb create --help` for the current flags if these
don't match what you see — OrbStack's CLI is actively developed and exact
subcommand names can shift between versions faster than this doc will.)

Everything from here on runs **inside that shell**, which is bash.

## 5. Verify the kernel is ready for Tetragon and Cilium

Inside the Ubuntu machine (bash):

```bash
uname -r
ls /sys/kernel/btf/vmlinux
cat /etc/os-release
```

What you're checking for:
- `/sys/kernel/btf/vmlinux` must exist — Tetragon needs BTF.
- The kernel version should be 6.7 or newer for Cilium's
  `bpf.datapathMode: netkit` in `deploy/platform/cilium-values.yaml`.

On an Ubuntu 26.04 OrbStack machine with kernel `7.2.9-orbstack-*`, both are
already satisfied — confirmed on the machine this doc was written against.
Re-run this check after any OrbStack update, though; it's a 30-second
sanity check, not a one-time fact.

If a future OrbStack kernel ever falls short on the netkit requirement
specifically (BTF is far more likely to still be fine), drop
`bpf.datapathMode: netkit` from `cilium-values.yaml` — it falls back to the
default veth datapath with no feature loss for this demo.

## 6. Install the toolchain inside the machine

Inside the Ubuntu machine (bash) — this is the same install sequence as any
fresh native-Ubuntu box, nothing OrbStack-specific about it:

```bash
sudo apt-get update
sudo apt-get install -y jq git make curl

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/

# kind — check https://github.com/kubernetes-sigs/kind/releases for the current tag
KIND_VERSION=v0.25.0
curl -Lo ./kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-$(dpkg --print-architecture)"
chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind

# Helm (official install script, architecture-aware)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Cilium CLI
# NOTE: the {,.sha256sum} suffix must stay UNQUOTED — bash only performs brace
# expansion on unquoted text, and this line fetches two files (the tarball and
# its checksum) in one curl call via that expansion. Quoting it silently turns
# this into a single request for a literal, nonexistent URL that 404s, and
# --fail then makes every later step fail quietly on a file that was never
# downloaded — nothing reaches /usr/local/bin and `cilium` ends up "not found"
# with no obvious error pointing at why.
CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)
ARCH=$(dpkg --print-architecture)
curl -L --fail --remote-name-all https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${ARCH}.tar.gz{,.sha256sum}
sha256sum --check cilium-linux-${ARCH}.tar.gz.sha256sum
sudo tar xzvfC cilium-linux-${ARCH}.tar.gz /usr/local/bin
rm cilium-linux-${ARCH}.tar.gz*
cilium version --client

# Hubble CLI — same unquoted-brace-expansion requirement as above
HUBBLE_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/hubble/master/stable.txt)
curl -L --fail --remote-name-all https://github.com/cilium/hubble/releases/download/${HUBBLE_VERSION}/hubble-linux-${ARCH}.tar.gz{,.sha256sum}
sha256sum --check hubble-linux-${ARCH}.tar.gz.sha256sum
sudo tar xzvfC hubble-linux-${ARCH}.tar.gz /usr/local/bin
rm hubble-linux-${ARCH}.tar.gz*
hubble version

# Node.js 22 (for npx — the MCP Inspector needs >= 22.19)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# uv (Python env/package manager, for the gateway and scripts/_seed.py)
curl -LsSf https://astral.sh/uv/install.sh | sh
# uv installs to ~/.local/bin and updates your shell rc file, but that PATH
# change doesn't reach THIS already-running shell — source the shim the
# installer leaves for exactly this case instead of opening a new shell:
source $HOME/.local/bin/env
```

Confirm everything landed:

```bash
docker ps
kind version
kubectl version --client
helm version
cilium version --client
node --version
uv --version
```

`docker` itself needs no install step here if you already saw a `docker0`
bridge in `ip addr` output — Docker was already running in the machine.

## 7. Where your repo lives

OrbStack mirrors your Mac's filesystem into the machine at the same
absolute path. If you're reading this file at
`/Users/you/.../kahawa-guard/RUNBOOK-MAC.md` on your Mac, it's at that exact
same path inside the Ubuntu shell too — no syncing, no separate clone.

```bash
cd /Users/you/Desktop/projects/work/kahawa-guard   # same path as on your Mac
```

Keep editing files from the Mac side (your editor, this session) and run
every cluster command from the Ubuntu shell — that split works cleanly
because of this filesystem mirroring.

## 8. Reaching the cluster and the UI from your Mac

Everything in `RUNBOOK.md` works fine run entirely from inside the Ubuntu
shell — `make ui`'s port-forward, `curl` against the gateway, the MCP
Inspector web client, all of it. You only need this section if you
specifically want your Mac's *own* browser or `kubectl` to reach into the
cluster directly, rather than opening a browser tab from inside the VM (if
your Linux machine's desktop environment doesn't even have one).

The straightforward option: tunnel one port at a time over SSH instead of
fighting with kubeconfig merging.

On your Mac (fish):

```fish
ssh -L 8080:localhost:8080 kahawa-guard@orb
```

Then, **inside that same SSH session** (bash), run the port-forward that
actually matters:

```bash
kubectl -n kahawa-ui port-forward svc/kahawa-ui 8080:8080
```

Now `http://localhost:8080` on your Mac reaches the UI, tunneled through SSH
to the VM's own port-forward. Repeat with a different `-L` mapping for the
gateway (`8000:8000`) or the MCP servers if you want those reachable
directly too.

Pulling the whole kubeconfig onto your Mac and rewriting its `server:`
address to the machine's OrbStack hostname is possible as well, but the
exact hostname pattern OrbStack uses for machine networking is the kind of
detail that shifts between OrbStack releases — check `orb` and OrbStack's
current docs before relying on it. The SSH tunnel above has no such
moving part.

## 9. Hand off to RUNBOOK.md

From here, inside the Ubuntu machine's shell, you *are* the native-Linux
case. Open `RUNBOOK.md` and start at section 3 (`kind create cluster`) —
nothing about the rest of that document is Mac-specific, because by this
point nothing about your situation is either.

## 10. Cleanup — the OrbStack layer

`RUNBOOK.md` section 17 covers tearing down the kind cluster itself —
run that first, from inside the Ubuntu shell, exactly as written there.

Once that's done, the OrbStack-specific layer on top, from your Mac (fish):

```fish
# stop the machine without deleting it (keeps the toolchain installed for next time)
orb stop kahawa-guard

# or delete it outright
orb delete kahawa-guard
```

Deleting the machine removes everything installed in [section 6](#6-install-the-toolchain-inside-the-machine)
along with it — the next session starts from [section 4](#4-path-b--a-dedicated-linux-machine)
again. Stopping it instead keeps the toolchain in place and just frees the
RAM/CPU OrbStack was giving it; `orb shell kahawa-guard` later boots it back
up where you left off.
