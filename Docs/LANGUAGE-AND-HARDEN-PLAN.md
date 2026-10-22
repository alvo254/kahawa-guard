# Language fix + Hardening plan

Two things in one note. **Part 1** is done and explains the Swahili change and the
real question behind it — *shouldn't the model just get this right?* **Part 2** is
the plan for the `make harden` flow, written out before I touch it so you can
approve it first.

## Table of contents

1. [Part 1 — the Swahili fix (done)](#1-part-1--the-swahili-fix-done)
   1. [What we changed](#11-what-we-changed)
   2. ["Shouldn't the model do this itself?"](#12-shouldnt-the-model-do-this-itself)
   3. [The options, with trade-offs](#13-the-options-with-trade-offs)
   4. [What this has to do with the whole talk](#14-what-this-has-to-do-with-the-whole-talk)
2. [Part 2 — the `make harden` plan (not yet applied)](#2-part-2--the-make-harden-plan-not-yet-applied)
   1. [Why a naive `make harden` fails today](#21-why-a-naive-make-harden-fails-today)
   2. [Change 1 — token flow in the Makefile](#22-change-1--token-flow-in-the-makefile)
   3. [Change 2 — seeding Vault](#23-change-2--seeding-vault)
   4. [The token-match rule](#24-the-token-match-rule)
   5. [The farm-weather caveat in hardened](#25-the-farm-weather-caveat-in-hardened)
   6. [The full run, start to finish](#26-the-full-run-start-to-finish)
   7. [What I will edit vs what you run](#27-what-i-will-edit-vs-what-you-run)

## 1. Part 1 — the Swahili fix (done)

### 1.1 What we changed

`prompts/coffee.md` now tells the assistant: when answering in Kiswahili or
Gikuyu, **keep these in English** rather than translating them — numbers, units
(mm, ml, litres, kg), dates, money/KSh amounts, grower codes, dealer and product
names, and the terms *rain, plot, forest, eligible, payment, dealer, PIN,
account*. Translate the sentence around them, not the terms.

Result on the live run: the discrediting mistranslation is gone — rainfall no
longer rendered as **"kinyesi" (faeces)**, and numbers/units/plot stayed English.
Residual: general Kiswahili fluency on the current model is still mediocre
(repetition, the odd clumsy clause), and it had earlier reached for "mbuga"
(reserve) instead of "forest" — which is why "forest" is now on the keep-English
list.

### 1.2 "Shouldn't the model do this itself?"

Yes — in an ideal world a model answers correctly in every language. In practice,
three things make this exactly the kind of thing you do **not** leave to the
model alone:

- **Model size and language coverage.** `ministral-8b` is an 8-billion-parameter
  model. Kiswahili and Gikuyu are lower-resource languages in training data than
  English. Small model × lower-resource language = weak fluency, and the
  weakest spot of all is **technical/domain vocabulary** — which is precisely
  where "rainfall" became "faeces". The model isn't broken; it's being asked to
  do the hardest version of its job.
- **A prompt is steering, not a guarantee.** The system prompt nudges the model
  and measurably reduced the errors (the howler is gone). But it is still a
  request the model mostly honours, not a rule the system enforces. We saw that
  live: it kept the numbers in English but still translated "forest" until we
  named it.
- **The cost of a wrong word is asymmetric.** "Rainfall = faeces" in front of
  Kiswahili speakers discredits the entire product in one line. The downside of a
  mistranslated unit is far bigger than the downside of leaving it in English, so
  the safe default is to not translate the risky tokens at all.

So the honest answer is: the model *should*, but you cannot *rely* on it to, and
the blast radius of it being wrong is high — so you put a constraint around it.

### 1.3 The options, with trade-offs

| Option | What it is | Trade-off |
| --- | --- | --- |
| **Prompt constraint** (done) | Tell the model to keep risky terms in English | Cheap, reversible, kills the howler; does **not** guarantee fluency or 100% compliance |
| **Bigger / better multilingual model** | e.g. `mistral-small`/`medium`, or an Africa-focused model, for the chat step | Best Kiswahili; costs more and reintroduces the free-tier rate limits that pushed us off `mistral-small` |
| **Answer in English only** | Drop multilingual replies | Safest and simplest; but localisation in the member's own language is a real product value — losing it is a real loss |
| **Deterministic glossary / post-processing** | Enforce a term map in code, or keep numeric facts out of the model's hands and template them | Most reliable (a unit can never be mistranslated); most engineering effort |

**Recommendation.** Keep the prompt constraint for the demo (done). For
production Kiswahili, the real lever is a stronger multilingual model for the
chat step. If a specific term absolutely must never be wrong, enforce it with a
code-side glossary rather than trusting the model — see §1.4.

### 1.4 What this has to do with the whole talk

This is the talk's thesis in miniature. "Rainfall = faeces" is the same shape of
problem as "the model redirected the payout": **the model did its best and was
still wrong in a way you can't tolerate, so you don't leave the decision with
the model.** For the payout, the control is the tool gate. For the dangerous
word, the control is a keep-English rule (and, if you need certainty, a code
glossary). Same principle at both ends of the stack: *put a control where you
cannot trust the model to be right.* It's a nice, honest aside to make on stage.

## 2. Part 2 — the `make harden` plan (not yet applied)

Goal: make `make harden` work end to end so we can run every scene with the full
profile — least privilege, Cilium, Tetragon, Kyverno — not just the app-layer
guards. **Nothing below is applied yet; this is the plan for your sign-off.**

### 2.1 Why a naive `make harden` fails today

1. **`n8n.mcpToken` is `required` in hardened.** `templates/n8n/n8n.yaml` calls
   Helm's `required` on it, and `make deploy` never passes it — so the chart
   fails to render the moment `requireMcpToken: true`.
2. **Secrets come from Vault in hardened, and nothing populates Vault.**
   `secretsFromVault: true` makes `templates/common/secrets.yaml` create an
   ExternalSecret that pulls `mistral_api_key`, `n8n_mcp_token`, `admin_token`
   from Vault at `secret/kahawa`. If Vault is empty, the gateway comes up with an
   **empty Mistral key** and every chat fails. (Vault dev root token is `root`,
   per `deploy/platform/vault-values.yaml`.)

### 2.2 Change 1 — token flow in the Makefile

Teach `deploy` to read `N8N_MCP_TOKEN` and `ADMIN_TOKEN` from the environment (or
`.env`), exactly as it already does for `MISTRAL_API_KEY` and `AT_API_KEY`, and
pass them to Helm only when set:

```make
# in the deploy target, alongside the existing key handling:
#   mcpfile / adminfile from $N8N_MCP_TOKEN|$ADMIN_TOKEN or .env
#   then, only when non-empty:
#     --set-file n8n.mcpToken="$mcpfile"
#     --set-file adminToken="$adminfile"
```

Effect: `make harden N8N_MCP_TOKEN=... ADMIN_TOKEN=...` (or values in `.env`)
renders cleanly, and the n8n seed and the chart agree on the token. Naked is
unaffected (both default empty, `requireMcpToken: false`).

### 2.3 Change 2 — seeding Vault

Add a small, documented step (a `make vault-seed` target or just these commands)
run once before `make harden`:

```bash
TOKEN=$(openssl rand -hex 16); ADMIN=$(openssl rand -hex 16)
# put the real secrets in Vault (dev mode, root token "root")
kubectl -n vault exec vault-0 -- sh -c \
  "VAULT_TOKEN=root vault kv put secret/kahawa \
     mistral_api_key='$MISTRAL_API_KEY' \
     n8n_mcp_token='$TOKEN' \
     admin_token='$ADMIN' \
     shieldstral_api_key=''"
# the ExternalSecret authenticates to Vault with this token secret in gateway ns
kubectl -n gateway create secret generic vault-token \
  --from-literal=token=root --dry-run=client -o yaml | kubectl apply -f -
```

I will **document** this (and optionally add the `vault-seed` target), but you run
it — it touches the cluster, and the token values are yours.

### 2.4 The token-match rule

There are two copies of the n8n MCP token and they must be equal:

- **n8n side** — the seed container reads `N8N_MCP_TOKEN` from the `n8n-seed`
  Secret, rendered from `.Values.n8n.mcpToken` (Change 1 supplies it).
- **Gateway side** — the gateway reads `N8N_MCP_TOKEN` from Vault
  (`n8n_mcp_token`, Change 2 supplies it).

If they differ, n8n's MCP trigger returns **403** to the gateway and Scene 3's
n8n tools vanish. So: use the **same** `$TOKEN` in both `make harden
N8N_MCP_TOKEN=$TOKEN` and the Vault `n8n_mcp_token=$TOKEN`. The plan uses one
variable for exactly this reason.

### 2.5 The farm-weather caveat in hardened

In hardened, Cilium `default-deny` blocks the gateway from reaching the
`attacker` namespace, so **farm-weather becomes unreachable** and `scene3.sh`
stops at its "farm-weather not connected" check. That is not a bug — it is the
hardened story ("the network drops the stranger before the model ever sees the
tool"). Two ways to present it:

- Lead Scene 3's *stop* side from **Option A** (guards-on on the naked
  deployment), where farm-weather is reachable and the tool gate visibly **parks**
  the payout; then
- In **hardened**, narrate farm-weather as dropped at the network — show it with
  `make hubble` rather than expecting the scene script to run it.

(If you ever want the gateway to reach farm-weather in hardened, that needs an
explicit Cilium allow rule — a deliberate policy change, not a default.)

### 2.6 The full run, start to finish

```bash
# Option A — guards on, no Vault, no policies (covers S1, S2, S3-park, S3b-refuse, S4)
./scripts/admin.sh layers input_guard=on expert_guard=on provenance=on registry=on tool_gate=on budgets=on
make reset
make scene1 ; make scene2 ; make scene3 ; make scene3b ; make scene4

# Option B — full hardened (adds the kernel + admission layers)
TOKEN=$(openssl rand -hex 16); ADMIN=$(openssl rand -hex 16)
#   seed Vault (§2.3) with $TOKEN / $ADMIN, then:
make harden N8N_MCP_TOKEN=$TOKEN ADMIN_TOKEN=$ADMIN
make reset
#   scenes, with `make hubble` + `make events` open:
make scene1 ; make scene2 ; make scene4
make scene3b            # Cilium drops, Tetragon kills
make prove-admission    # Kyverno refuses the bad pod
#   Scene 3: narrate farm-weather as network-dropped (§2.5); show the tool-gate
#   park from Option A instead.
#   admin now needs the token:
./scripts/admin.sh layers tool_gate=on --token $ADMIN   # (or set VITE_ADMIN_TOKEN for the UI)
```

### 2.7 What I will edit vs what you run

- **I edit (from here, on your go):**
  - `Makefile` — `deploy` reads `N8N_MCP_TOKEN`/`ADMIN_TOKEN` from env/`.env` and
    passes them when set (Change 1).
  - optionally add a `vault-seed` target wrapping §2.3.
  - fix the Scene 3c invocation (separate item) so the kernel-layer file-escape
    actually runs.
- **You run (cluster):** the Vault seed (§2.3), `make harden`, the scenes, and
  `make hubble` / `make events`.

Nothing in Part 2 is applied yet. Say go and I'll make the Makefile change and
write the `vault-seed` step; then you run the hardened pass.
