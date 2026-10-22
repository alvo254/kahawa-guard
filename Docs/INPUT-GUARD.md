# The Input Guard (L1) — how it works

A deep dive on the first guard in the pipeline: what it is, the two forms it
takes, every branch it can hit, why it **fails open**, and how to read it on
stage. Written against the live code, not the brochure.

> **One-line version.** L1 is Mistral's moderation applied to the member's
> message *before* the model is called. It runs in two places — a standalone
> `/v1/moderations` scoring call (what the admin panel shows) and an inline
> guardrail declared on the chat request itself. It blocks when a risky category
> scores ≥ 0.5. When the moderation API errors, it **fails open** (lets the
> message through) so a flaky API never bricks the demo — which is a deliberate
> tradeoff, not a bug.

## Table of contents

1. [Where L1 sits in the pipeline](#1-where-l1-sits-in-the-pipeline)
2. [The two forms of L1](#2-the-two-forms-of-l1)
3. [The standalone check, line by line](#3-the-standalone-check-line-by-line)
4. [Categories and the threshold](#4-categories-and-the-threshold)
5. [Every branch it can take](#5-every-branch-it-can-take)
6. [The inline guardrail on the chat call](#6-the-inline-guardrail-on-the-chat-call)
7. [Fail-open: why, and the consequence](#7-fail-open-why-and-the-consequence)
8. [L1 vs L2 — who catches what](#8-l1-vs-l2--who-catches-what)
9. [Reading L1 on stage (verdicts & logs)](#9-reading-l1-on-stage-verdicts--logs)
10. [Configuration](#10-configuration)
11. [Local provider (Ollama): there is no L1](#11-local-provider-ollama-there-is-no-l1)
12. [Known failure modes & gotchas](#12-known-failure-modes--gotchas)
13. [Code map](#13-code-map)

## 1. Where L1 sits in the pipeline

The gateway runs nine ordered steps (`gateway/app/main.py`). L1 is step 2 — the
first guard after identity, and the first thing that can refuse a message:

```text
1 identify      hash the phone, load the session, check the budget
2 input_guard   Mistral moderation on the request            (L1)   ← this doc
3 expert_guard  Shieldstral yes/no questions on the input     (L2)
4 retrieve      pgvector search, with provenance
5 model         chat call (also carries the inline guardrail) (L1')
6 tool_gate     allow / cap / park / refuse each tool call    (L4)
7 expert_guard  Shieldstral questions on the draft reply       (L2)
8 registry      dealer / product / dose checks                 (L3)
9 audit         every verdict to Postgres
```

If L1 blocks, the handler returns immediately with the refusal
`"I cannot help with that request."` and `blocked_by: "input_guard"` — the model
is never called. It is the cheapest possible refusal: no tokens spent, no tools
offered, nothing retrieved.

It is gated by the **`input_guard` switch** in the admin panel. Naked starts it
off; hardened starts it on. Off means step 2 publishes an `info` verdict and
returns "not blocked" without calling anything.

## 2. The two forms of L1

L1 is Mistral moderation, but it is applied **twice**, in two different ways:

| | Standalone check (step 2) | Inline guardrail (step 5) |
| --- | --- | --- |
| Where | `pipeline/input_guard.py` → `check_input()` | declared on the chat request in `pipeline/model.py` → `llm/mistral.py` |
| Endpoint | `POST /v1/moderations` | `guardrails` field on `POST /v1/chat/completions` |
| Model | `moderation_model` = `mistral-moderation-latest` | `guardrail_model` = `moderation_llm_v2` |
| Purpose | gives the admin panel a **score to show before the model runs**, and the hard block | a second, provider-side check bound to the actual chat call |
| Can it block the pipeline? | **Yes** — returns early with `blocked_by=input_guard` | No — it annotates the chat response; it is belt-and-braces |
| Sees | the input only | the input only (guardrails are input-side) |

Both are **input-only** — neither ever sees the model's reply. That is L2's job
on the way out (`expert_guard_out`) and L3's (`registry`).

Why two? The standalone call is what produces the **number** the room sees on the
verdict feed before the model is even reached, and it is the one that actually
stops the request. The inline guardrail is declared on the chat call so that even
if someone bypasses the pipeline ordering, the provider still applies a
moderation pass to that specific completion. In practice the standalone check is
the one that matters for the demo.

## 3. The standalone check, line by line

`check_input(text, phone_hash)` in `gateway/app/pipeline/input_guard.py`:

1. **Switch gate.** If `input_guard` is off → publish an `info` verdict
   (`"switch off"`) and return not-blocked. (This is the naked default.)
2. **Capability check.** If the active provider has no `moderate` method (the
   local Ollama provider) → publish `info` and return not-blocked. See §11.
3. **Call moderation.** `await provider().moderate(text)` → `POST /v1/moderations`
   with `{model: moderation_model, input: [text]}`.
   - On **any exception** (timeout, 4xx/5xx, network) → log a warning, publish an
     `info` verdict `"guardrail unavailable: {exc}"`, return **not-blocked**.
     This is the fail-open path (§7).
4. **Score it.** Take `results[0].category_scores`, keep the categories whose
   names start with a blocked category (§4), and find the single worst score.
5. **Decide.** `blocked = worst_score >= 0.5`. Publish a `block` or `allow`
   verdict carrying the worst category, its score, and all category scores in
   `extra`. Return the outcome.

The key structural fact: **steps 1, 2 and the exception path all publish `info`
and return not-blocked.** Only step 4–5 produce a `block`/`allow` with a real
score. So the *presence* of a scored `input_guard` verdict tells you the
moderation call actually succeeded.

## 4. Categories and the threshold

```python
BLOCK_CATEGORIES = ("prompt_injection", "jailbreak", "pii", "selfharm", "violence")
THRESHOLD = 0.5
```

Mistral's moderation returns a `category_scores` map (each 0–1). L1:

- filters to categories whose name **starts with** one of `BLOCK_CATEGORIES`
  (so `pii`, `pii/national_id`, etc. all count), falling back to *all* categories
  if that filter is empty;
- takes the single highest score among those;
- **blocks if that score ≥ 0.5.**

So a message scoring `jailbreak 0.997` or `pii 1.00` is blocked; `pii 0.00`
passes. The verdict detail is `"{worst_category} {score}"`, e.g. `jailbreaking 1.00`.

> The threshold is a module constant, not a pack setting — the same 0.5 applies
> in every pack. (L2's thresholds, by contrast, are per-question in the pack.)

## 5. Every branch it can take

This is the table to keep next to you on stage — it maps what you *see* to what
*happened*:

| What happened | Verdict `decision` | `detail` | Blocks? | Visible in scene output? |
| --- | --- | --- | --- | --- |
| Switch off (naked default) | `info` | `switch off` | no | **no** (scenes hide `info`) |
| Local provider, no moderation | `info` | `no inline guardrail on a local model…` | no | **no** |
| Moderation call threw (timeout/5xx) | `info` | `guardrail unavailable: {exc}` | no | **no** |
| Scored, below threshold | `allow` | `{category} {score}` e.g. `pii 0.00` | no | yes |
| Scored, at/above threshold | `block` | `{category} {score}` e.g. `jailbreaking 1.00` | **yes** | yes |

**This is why a request can show *no* `input_guard` line at all.** The scene
scripts filter out `info` verdicts (`select(.decision!="info")` in
`scenes/_common.sh`), so the three `info` branches are invisible in `make
sceneN` output. No line ≠ "L1 was skipped" — it means L1 ran and hit one of the
three info branches, almost always **the moderation call erroring out**. Confirm
which in the gateway log (§9).

## 6. The inline guardrail on the chat call

In `pipeline/model.py`, the chat call passes
`guardrail = packs.on("input_guard") and settings.llm_provider == "mistral"`.
When true, `llm/mistral.py` adds to the completion request:

```python
payload["guardrails"] = [{settings.guardrail_model: {}}]   # moderation_llm_v2
```

The response's `guardrails` field is carried back on the model verdict. This is a
provider-side moderation bound to the actual completion. Two caveats:

- It is **input-side** — it does not moderate the generated reply.
- `moderation_llm_v2` **occasionally reports "Guardrail evaluation timed out"**;
  the completion still returns, just without a guardrail result
  (`PROGRESS.md §2.5`). So it is a best-effort second opinion, not a hard gate.

The pipeline's actual block decision comes from the **standalone** check in step
2, not from this inline annotation.

## 7. Fail-open: why, and the consequence

The exception handler is explicit about its choice:

```python
except Exception as exc:                 # noqa: BLE001 — never fail the room
    log.warning("input guard call failed: %s", exc)
    bus.publish(Verdict(layer="input_guard", decision="info",
                        detail=f"guardrail unavailable: {exc}", ...))
    return GuardOutcome(False, None, "unavailable", {})     # ← not blocked
```

**L1 fails open:** when the moderation API errors, the message is allowed through
rather than refused. The rationale is availability — a flaky third-party API
should never brick the assistant in front of a room.

**The consequence is real and worth naming on stage.** If moderation times out on
a genuine jailbreak, L1 contributes nothing and the request proceeds to the
model. That is exactly what happens to the overt English override in Scene 1a:
the `/v1/moderations` call throws, L1 emits `info` and returns not-blocked, L2 is
silent (cached, no entry), and the model obeys and prints `READY`. L1 did not
decide "safe" — it **failed to decide and defaulted to allow.**

This is a deliberate security/availability tradeoff. A strict deployment would
**fail closed**: treat a guard error as a block (or at least refuse the
high-risk categories). The honest framing for the talk:

> "L1 fails open so a flaky moderation API never takes the assistant down — but
> that means a timeout on a real attack lets it through. That's why you never
> rely on a single input guard: L2 and the enforced downstream layers are the
> backstop."

(There is no fail-closed flag today. A proposed `INPUT_GUARD_FAIL_CLOSED` toggle
— default open in naked, closed in hardened — would let you demo both stances; it
is a small, self-contained change to `input_guard.py` plus the hardened values.)

## 8. L1 vs L2 — who catches what

They are easy to confuse because both inspect the *input*. They are very
different mechanisms:

| | L1 input guard | L2 expert guard |
| --- | --- | --- |
| Engine | Mistral moderation (a classifier) | Shieldstral yes/no scoring from token logprobs |
| Questions | fixed categories (jailbreak, pii, …) | the **pack's** questions (jailbreak, payout_social, credential, language_smuggling…) |
| Threshold | one constant, 0.5 | per-question, in the pack |
| Liveness | always live (an API call) | **live or cached** — `SHIELDSTRAL_MODE` |
| Fails | open (on API error) | contributes nothing if no live call and no cache hit |
| Blocks on | overt, well-known categories | subtle, domain-specific intent (e.g. a mixed-language smuggle) |

In the current build, L1 does the real blocking for the overt attacks
(Scene 1b/1c: `pii 1.00`, `jailbreaking 1.00`), and **L2 is silent on the
reworded Scene 1 prompts** because it is in cached mode with no matching entry.
L2 is meant to be the layer that catches what L1's timeout lets through (1a) —
which only happens with L2 live or its cache seeded for those prompts. See
`SCENES.md` Scene 1 and the cache note in `scenes/scene1.sh`.

## 9. Reading L1 on stage (verdicts & logs)

**On the verdict feed / in `make sceneN` output:**

- `input_guard block — jailbreaking 1.00` → L1 caught it; the request stopped
  here and the model was never called. `blocked_by: "input_guard"` in the
  response.
- `input_guard allow — pii 0.00` → L1 scored it clean; the request continued.
- **no `input_guard` line** → L1 hit an `info` branch (switch off, local
  provider, or — usually — the moderation call errored). Scenes hide `info`.

**To see the hidden `info` reason**, query the gateway log:

```bash
# the standalone moderation call that failed and why
kubectl -n gateway logs deploy/gateway --since=15m | grep "input guard call failed"
# all L1 moderation traffic
kubectl -n gateway logs deploy/gateway --since=15m | grep "/v1/moderations"
```

Or watch the live SSE feed, which shows `info` verdicts the scene scripts filter
out: the `/present` and `/ops` panels (`/api/events`).

## 10. Configuration

| Setting | Env | Default | Used by |
| --- | --- | --- | --- |
| `moderation_model` | `MODERATION_MODEL` | `mistral-moderation-latest` | standalone `/v1/moderations` (the block decision) |
| `guardrail_model` | `GUARDRAIL_MODEL` | `moderation_llm_v2` | inline guardrail on `/v1/chat/completions` |
| `mistral_base_url` | — | `https://api.mistral.ai` | both |
| HTTP timeout | — | 60 s (10 s connect) | the httpx client; a slow moderation call can time out here and trigger fail-open |
| `input_guard` switch | `GUARD_DEFAULTS` | off (naked) / on (hardened) | whether step 2 runs at all |

The two model names are **not interchangeable**: `moderation_llm_v2` is a
*guardrail* key for the chat endpoint, not a model name the `/v1/moderations`
endpoint accepts — feeding it there returns `400 Invalid model`
(`PROGRESS.md §2.4`). That is why there are two separate settings.

## 11. Local provider (Ollama): there is no L1

The inline guardrail and `/v1/moderations` are Mistral API features. The Ollama
provider has no `moderate` method, so `check_input` takes the capability branch,
publishes an `info` verdict ("no inline guardrail on a local model; the expert
guard covers the input"), and returns not-blocked. **On a local model, L1 does
not exist** — L2 (expert guard) has to carry the entire input-side defence. Keep
that in mind when demoing `make deploy PROVIDER=ollama`.

## 12. Known failure modes & gotchas

- **"No `input_guard` line" ≠ "guard skipped".** It almost always means the
  moderation call errored and L1 failed open (§5, §7). Check the log.
- **Overt jailbreak still lands sometimes, even hardened.** Fail-open + a
  moderation timeout, with L2 silent. Narrate it as the defense-in-depth lesson,
  not a bug (§7, §8).
- **`moderation_llm_v2` inline timeouts.** The completion returns without a
  guardrail result; harmless, but don't expect the inline annotation every time.
- **Wrong model in the wrong slot** → `400 Invalid model` (§10).
- **Threshold is global.** You cannot tune L1 per pack; if you need
  domain-specific input scoring, that is L2's job.
- **L1 sees input only.** A reply that leaks data is not L1's to catch — that is
  L2 output questions and L3 registry.

## 13. Code map

| Concern | Where |
| --- | --- |
| The standalone check, branches, threshold | `gateway/app/pipeline/input_guard.py` |
| The moderation HTTP call | `gateway/app/llm/mistral.py` → `moderate()` |
| The inline guardrail on the chat call | `gateway/app/llm/mistral.py` → `chat()` (`guardrails` payload) |
| Where L1 is invoked and can block | `gateway/app/main.py` (step 2, `check_input`) |
| Model names / endpoints / timeout | `gateway/app/config.py`, `llm/mistral.py` `__init__` |
| The switch | `gateway/app/packs/loader.py` (`SWITCHES`), admin API `/api/admin/layers` |
| How it reads on stage | `scenes/_common.sh` (`send` filters `info`), `SCENES.md` Scene 1 |
| History of L1 bugs (model names, guardrail shape) | `PROGRESS.md §2.4, §2.5` |
