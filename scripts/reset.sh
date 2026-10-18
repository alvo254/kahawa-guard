#!/usr/bin/env bash
# scripts/reset.sh PROFILE PACK — reseed data, clear budgets, reset switches.
# Run before each scene or rehearsal, and ALWAYS after switching LLM provider,
# because embeddings from different models cannot be mixed in one pgvector
# column (the column width is EMBED_DIM; switching provider changes it).
set -euo pipefail

PROFILE=${1:-naked}
PACK=${2:-coffee}
GATEWAY_URL=${GATEWAY_URL:-http://localhost:8000}
NAMESPACE_DATA=${NAMESPACE_DATA:-data}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== reset: profile=$PROFILE pack=$PACK =="

echo "-- truncating and reseeding Postgres from data/seed --"
PG_POD=$(kubectl -n "$NAMESPACE_DATA" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
PG_USER=${PG_USER:-kahawa}
PG_DB=${PG_DB:-kahawa}

kubectl -n "$NAMESPACE_DATA" exec -i "$PG_POD" -- psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" <<'SQL'
TRUNCATE members, plots, forest_2020, dealers, products, payments,
         chunks, documents, pending_actions, audit_events RESTART IDENTITY CASCADE;
SQL

python3 "$HERE/_seed.py" | \
  kubectl -n "$NAMESPACE_DATA" exec -i "$PG_POD" -- psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"

echo "-- uploading the trusted extension notes through the gateway (for embeddings) --"
if curl -sf -o /dev/null "$GATEWAY_URL/healthz"; then
  curl -sf -X POST "$GATEWAY_URL/api/upload" \
    -F "role=coop" -F "title=Kirinyaga Coffee Extension Notes" -F "trust=trusted" \
    -F "file=@$HERE/../data/seed/docs/extension_notes.md;type=text/markdown" \
    | jq . || echo "warn: extension notes upload failed"
else
  echo "warn: gateway not reachable at $GATEWAY_URL; skipping document upload"
fi
# The fake circular (data/seed/docs/fake_circular.*) is deliberately NOT loaded
# here — Scene 2 uploads it live, as an untrusted "dealer" document. Pre-seeding
# it would give away the scene before the room sees the upload happen.

echo "-- switching pack and clearing session state via the admin API --"
"$HERE/admin.sh" pack "$PACK" || echo "warn: pack switch failed; is the gateway reachable at $GATEWAY_URL?"
"$HERE/admin.sh" reset || echo "warn: admin reset failed; is the gateway reachable at $GATEWAY_URL?"

echo "== reset done =="
