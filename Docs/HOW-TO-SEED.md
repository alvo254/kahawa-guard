# How to seed the database (and when it needs a re-init)

A standalone runbook for loading demo data and for changing it later. The key
thing to internalise: **data changes and schema changes take effect by two
different paths**, and getting them confused is why a reseed can silently come
back empty.

## Table of contents

1. [The 30-second version](#1-the-30-second-version)
2. [How the database is built (the mental model)](#2-how-the-database-is-built-the-mental-model)
3. [Reseed data only (no schema change)](#3-reseed-data-only-no-schema-change)
4. [Change the schema (new tables/columns) — needs a re-init](#4-change-the-schema-new-tablescolumns--needs-a-re-init)
5. [Change the generated dataset](#5-change-the-generated-dataset)
6. [Verify](#6-verify)
7. [Why a reseed comes back empty](#7-why-a-reseed-comes-back-empty)
8. [Switching embedding model / EMBED_DIM](#8-switching-embedding-model--embed_dim)
9. [Command reference](#9-command-reference)

## 1. The 30-second version

```bash
# Data only (rows changed, schema unchanged):
make reset

# Schema changed (edited data/schema.sql — new table/column):
make deploy                                     # push the new schema into the ConfigMap
kubectl -n data rollout restart deploy/postgres # emptyDir wiped -> init re-runs the NEW schema
kubectl -n data rollout status deploy/postgres
make reset                                      # load the rows
```

If a reseed returns 0 rows, you almost certainly changed the schema but skipped
the `make deploy` + Postgres restart — see §7.

## 2. How the database is built (the mental model)

Three separate pieces, and each changes by a different action:

| Piece | Where it lives | Applied when | Changed by |
| --- | --- | --- | --- |
| **Schema** (`CREATE TABLE …`) | `data/schema.sql` → staged to `files/schema.sql` → **`postgres-init` ConfigMap** → mounted at `/docker-entrypoint-initdb.d/schema.sql` | **only on a fresh/empty data dir** (Postgres' init hook) | `make deploy` (updates the ConfigMap) **+ a Postgres restart** (re-runs init) |
| **Rows** (the actual data) | `data/seed/*.csv`, `plots.geojson` | every time you run it | `make reset` (TRUNCATE + `scripts/_seed.py` INSERTs) |
| **Documents/embeddings** | uploaded, not seeded | end of `make reset` | the gateway's `/api/upload` (needs the gateway on `:8000`) |

Two facts that explain everything:

- **Postgres storage is an `emptyDir`.** Every pod restart starts with an empty
  data directory, so the init hook runs `schema.sql` again — but it runs
  **whatever the ConfigMap currently holds**, which is only as new as the last
  `make deploy`.
- **The init hook only fires on an empty data dir.** Editing `schema.sql` and
  doing nothing does not change a running database. You must get the new schema
  into the ConfigMap (`make deploy`) and then give Postgres an empty dir
  (restart) so init re-applies it.

So: **rows → `make reset`. Schema → `make deploy` + restart, then `make reset`.**

## 3. Reseed data only (no schema change)

This is the common case — new rows, same tables.

```bash
make reset
```

What it does (`scripts/reset.sh`):
1. `TRUNCATE` every data table (RESTART IDENTITY CASCADE).
2. `python3 scripts/_seed.py | psql …` — loads `data/seed/*` as INSERTs, with
   `ON_ERROR_STOP=1` (one bad row aborts the whole load — see §7).
3. Uploads the trusted extension notes through the gateway for embeddings
   (needs the gateway reachable on `:8000`; it only warns if not).

The DB-seed step runs on this host via `kubectl exec`, so the member/buyer/
delivery rows load even if the gateway is down; only step 3 needs it.

**Step 3 is retryable on its own.** The notes upload calls the gateway, which
calls Mistral to embed — so it can transiently fail (a `500` from an embedding
hiccup, especially right after a Postgres restart, or a `429` rate limit). You
will see `warn: extension notes upload failed`. The **row data is unaffected**;
only retrieval grounding is missing until you retry — no need to re-run the whole
reset:

```bash
curl -s -X POST http://localhost:8000/api/upload \
  -F role=coop -F title="Kirinyaga Coffee Extension Notes" -F trust=trusted \
  -F "file=@data/seed/docs/extension_notes.md;type=text/markdown" | jq .
# success looks like: {"document_id":1, "chunks":2, "trust":"trusted", ...}
```

## 4. Change the schema (new tables/columns) — needs a re-init

When you edit `data/schema.sql` (added `buyers`, `contracts`, the member PII
columns, etc.), the running database will **not** pick it up on its own. Full
sequence:

```bash
# 1. push the edited schema into the postgres-init ConfigMap
make deploy                 # runs `make stage` (copies data/schema.sql -> files/) then helm upgrade

# 2. give Postgres an empty data dir so its init hook re-runs the NEW schema
kubectl -n data rollout restart deploy/postgres
kubectl -n data rollout status deploy/postgres

# 3. load the rows into the new shape
make reset
```

Skipping step 1 is the classic trap: a restart alone re-inits from the **old**
ConfigMap, so the new tables never appear (and then `make reset` fails to
TRUNCATE a table that doesn't exist, leaving everything empty).

> Note: `make deploy` does not restart Postgres by itself (no ConfigMap checksum
> annotation on that pod), which is why step 2 is explicit.

## 5. Change the generated dataset

The rows come from a deterministic generator, `scripts/seedgen.py`:

```bash
scripts/seedgen.py --members 300 --seed 42
#   writes data/seed/{members,payments,dealer_register,products,buyers,contracts,
#          deliveries,advances,grading,sacco}.csv and plots.geojson
```

- `--members N` — population size. `--seed S` — change for a different (still
  reproducible) population. `--seasons a,b` — crop seasons.
- Deterministic: same flags → identical output, so demos reproduce and diffs are
  clean.
- Attack fixtures (KG-0003 in the forest, KG-0001↔KG-0004 overlap, KG-0005 clean,
  revoked DL-0045, unregistered Rapid Grow Booster) and the KG-0001–0008 names/
  phones are **pinned** and asserted at the end of a run.
- Pure stdlib — no dependencies.

After regenerating, it's a **data-only** change, so just `make reset` (the schema
didn't change). If you also add a new *table* to the generator, that's a schema
change too — do §4.

Workflow to resize or reshape the data:

```bash
scripts/seedgen.py --members 500 --seed 7   # regenerate
make reset                                   # load it (schema unchanged)
```

## 6. Verify

```bash
kubectl -n data exec deploy/postgres -- psql -U kahawa -d kahawa -c "\dt"      # tables present
kubectl -n data exec deploy/postgres -- psql -U kahawa -d kahawa -c \
  "SELECT count(*) FROM members;      -- expect ~300
   SELECT count(*) FROM deliveries;   -- expect a few thousand
   SELECT count(*) FROM buyers;       -- expect 8
   SELECT full_name,national_id,sub_county,status FROM members WHERE grower_code='KG-0001';
   SELECT name,bank_account,settlement_swift FROM buyers LIMIT 3;"
```

Spot-check the attack fixtures survived a reseed:

```bash
kubectl -n data exec deploy/postgres -- psql -U kahawa -d kahawa -c \
  "SELECT grower_code, payout_account_ref FROM members WHERE grower_code='KG-0003';
   SELECT licence_no, status FROM dealers WHERE licence_no='DL-0045';         -- revoked
   SELECT name, registered FROM products WHERE name='Rapid Grow Booster';      -- false"
```

## 7. Why a reseed comes back empty

In order of likelihood:

1. **Schema changed but you skipped `make deploy` + restart (§4).** The new
   tables don't exist, `TRUNCATE` fails on a missing table, nothing loads. This
   is the one that just bit us.
2. **A bad INSERT with `ON_ERROR_STOP=1`.** One failing row (FK violation,
   numeric overflow, bad date) aborts the whole transaction → 0 rows. Find the
   culprit:
   ```bash
   python3 scripts/_seed.py | kubectl -n data exec -i deploy/postgres -- \
     psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa 2>&1 | tail -20
   ```
   The last line before the abort names the statement; fix `seedgen.py` and
   regenerate.
3. **You restarted Postgres but never ran `make reset`.** A fresh pod has the
   schema (empty tables) but no rows. Run `make reset`.
4. **`python3` or the repo isn't on the host running `make reset`.** The seed
   step shells out to `python3 scripts/_seed.py` locally.

Separately, `warn: extension notes upload failed` at the end of `make reset` does
**not** mean the rows failed — that is only step 3 (the embedded notes), and the
member/buyer/delivery data is already committed. Retry just the upload (§3). It
is usually a transient Mistral embedding `500`/`429`; re-running the `curl`
succeeds.

A note on **missing phones**: ~5% of generated members have no number on file.
`phone_e164` is `NOT NULL`, so the loader stores an empty string `''` for them
(not `NULL`) — a realistic "no number" state. If you add a NOT-NULL column to a
seeded table and the generator can leave it blank, the loader must emit `''` or a
default, not `NULL`, or the whole load aborts under `ON_ERROR_STOP=1`.

## 8. Switching embedding model / EMBED_DIM

The `chunks.embedding` column is `vector(EMBED_DIM)`, substituted by
`data/postgres/init.sh` at init (1024 for `mistral-embed`, 768 for
`nomic-embed-text`). Embeddings from different models cannot be mixed in one
column, so when you switch provider you must re-init the schema (§4) so the
vector width changes, then `make reset` to reload and re-embed. `EMBED_DIM` is
set from the chart values the init script reads.

## 9. Command reference

```bash
make reset                                    # TRUNCATE + reload rows (+ upload notes)
scripts/seedgen.py --members N --seed S        # regenerate the CSVs/GeoJSON (deterministic)
make deploy                                    # stage schema into the ConfigMap + helm upgrade
kubectl -n data rollout restart deploy/postgres   # re-init DB from the current ConfigMap
kubectl -n data rollout status  deploy/postgres
# debug a failing load:
python3 scripts/_seed.py | kubectl -n data exec -i deploy/postgres -- \
  psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa 2>&1 | tail -20
# wipe + rebuild from scratch (schema + data):
make deploy && kubectl -n data rollout restart deploy/postgres && \
  kubectl -n data rollout status deploy/postgres && make reset
```

Rule of thumb, one more time: **rows → `make reset`; schema → `make deploy` +
Postgres restart, then `make reset`.**
