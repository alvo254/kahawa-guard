# Kahawa Guard

A deliberately attackable AI assistant for a Kenyan coffee cooperative, and the
layered defence that stops it. Built on kind, Cilium, Hubble, Tetragon, Kyverno
and Vault, with Mistral (API or local via Ollama) behind a guard pipeline.

Two profiles of the same code:

- **naked** — every guard switched off, no network policy, no admission control.
  The attacks land.
- **hardened** — `make harden` turns on the guard pipeline and applies Cilium,
  Tetragon and Kyverno policy. The same attacks are refused, dropped, or killed
  in the kernel, on screen.

Read `kahawa-guard-technical-guide.md` for how every layer is built, and
`kahawa-guard-plan.md` for the business case and the masterclass story.

> Every member, plot, dealer, payment and document in this repo is invented.
> The forest fixture is hand-drawn, not real map data. The attacker namespace and
> the vulnerable-by-design `records-fs` server are for use **inside this demo
> cluster only**.

## Quick start

```bash
cp .env.example .env            # add your Mistral key, or set LLM_PROVIDER=ollama
make prereqs                    # check tooling
make up                         # kind cluster + platform + images + naked deploy
make ui                         # chat screen and admin panel on localhost:8080
make reset                      # before each scene or rehearsal
```

## Everyday use

```bash
make scene2                     # run a scene
make harden                     # flip to the hardened profile
make swap PACK=health           # sector swap
make mcp-forward                # then make inspector, mcp-list, mcp-test, mcp-check
make deploy PROVIDER=ollama     # run on a local Mistral model
make hubble                     # Hubble UI
make events                     # Tetragon events for tools, n8n, gateway
make down                       # throw it all away
```

Run `make help` for the full list.

## Layout

| Path | What lives there |
| --- | --- |
| `ui/` | Chat screen and admin panel (React, Vite, TypeScript), served by unprivileged nginx |
| `gateway/` | FastAPI backend: the guard pipeline, retrieval, tool gate, audit |
| `mcp/` | `kahawa-tools` (trusted), `farm-weather` (rogue), `records-fs` (vulnerable by design), pinning tests |
| `attacker/` | Fake cloud metadata service |
| `n8n/workflows/` | Exported back-office workflows |
| `packs/`, `prompts/` | Sector packs: coffee, health, education |
| `data/` | Postgres (PostGIS + pgvector) schema and invented seed data |
| `deploy/` | kind config, platform values, Helm chart, Cilium/Tetragon/Kyverno policy |
| `scenes/`, `scripts/` | Stage scripts and operator helpers |
| `redteam/` | Gikuyu, Swahili and English prompt set |

## Before the session

1. Pin every version in `versions.mk`. Nothing empty.
2. `make mcp-test` and `make mcp-check` both pass.
3. Each `make sceneN` replays cleanly from `make reset`, three times over.
4. Screen-record every scene as a fallback.
5. Never use MCP Inspector older than 0.14.1 (CVE-2025-49596).
