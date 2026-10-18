#!/usr/bin/env bash
# Substitutes EMBED_DIM into the schema the chart mounts, so the vector(n) column
# always matches the embedding model the gateway is configured with.
set -euo pipefail

: "${EMBED_DIM:=1024}"
SCHEMA=/docker-entrypoint-initdb.d/schema.sql

if [ -f "$SCHEMA" ]; then
  echo "init: rendering schema with EMBED_DIM=${EMBED_DIM}"
  sed "s/__EMBED_DIM__/${EMBED_DIM}/g" "$SCHEMA" > /tmp/schema.rendered.sql
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/schema.rendered.sql
  # The mounted copy still has the placeholder; stop the entrypoint running it raw.
  mv "$SCHEMA" /tmp/schema.sql.applied 2>/dev/null || true
fi
