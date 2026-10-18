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
`RUNBOOK.md` walks the same build section by section with raw commands
instead of `make`, for the first run, for teaching, or for debugging — it
assumes native Linux. **On a Mac, start with `RUNBOOK-MAC.md` instead**: it
gets you from a Mac terminal into a real Linux shell via OrbStack, then hands
off to `RUNBOOK.md`.

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

## Setting up Africa's Talking SMS in n8n

Africa's Talking has no dedicated n8n node, so the three workflows that send
SMS (`change_payout`, `send_sms`, `send_parent_report`) call its REST API
directly with an HTTP Request node. The API key itself is **not** in the
exported workflow JSON — n8n never exports credential secrets — so set it up
once per n8n instance, in n8n's own UI:

1. **Credentials → New → Header Auth.**
2. Name: `apiKey`. Value: your `AT_API_KEY` (an Africa's Talking sandbox key —
   the sandbox `username` is always `sandbox`, already hard-coded in each
   workflow's request body).
3. Name the credential `Africa's Talking apiKey header` so it matches the
   `httpHeaderAuth` reference each workflow already points at; re-select it on
   the "Notify member by SMS" / "Send SMS" / "Send report by SMS" node if n8n
   doesn't auto-match it on import.

The real (here: invented sandbox) number each workflow sends to comes from the
`members.phone_e164` column, not `members.phone_hash` — the hash is a one-way
SHA256 the gateway uses for its own session and audit logic and cannot be
dialed. Only these n8n Postgres queries read `phone_e164`; nothing in
`gateway/` ever selects it.

## Before the session

1. Pin every version in `versions.mk`. Nothing empty.
2. `make mcp-test` and `make mcp-check` both pass.
3. Each `make sceneN` replays cleanly from `make reset`, three times over.
4. Screen-record every scene as a fallback.
5. Create the n8n `apiKey` Header Auth credential above before any scene that
   touches a payout change or an SMS — `confirm_action`'s webhook will still
   run without it, but the SMS node will error out at the end of the chain.
5. Never use MCP Inspector older than 0.14.1 (CVE-2025-49596).
