# PostGIS plus pgvector in one image, so plots and embeddings live in one
# database. Pin the digest before rehearsals.
#
# Built FROM the official postgres image, not postgis/postgis: checked
# directly (docker buildx imagetools inspect) and postgis/postgis publishes
# amd64 only, across every tag tried (16-3.4, 16-3.5, 16-3.6, 17-3.5, 17-3.6,
# latest) — no arm64 manifest exists for it at all. The official postgres
# image genuinely is multi-arch (linux/arm64/v8 included), and it already has
# the PGDG apt repo configured (that's how it gets postgresql-16 itself), so
# the postgis and pgvector extension packages install the same way the
# postgis/postgis image would have added them, just without inheriting an
# amd64-only base.
FROM postgres:16-bookworm

# Some sandboxed/VM network environments (notably OrbStack) intercept
# outbound HTTPS with their own root CA and block plain HTTP outright, which
# breaks apt's default plain-HTTP Debian/PGDG sources outright ("Network is
# unreachable" on port 80) and fails cert verification on port 443 until
# ca-certificates is actually installed. The sequence below:
#   1. Trusts whatever extra root CA such an environment may have already
#      injected at /etc/ssl/certs/orbstack-root.crt — a no-op everywhere else,
#      since the file simply won't exist outside that kind of setup.
#   2. Switches the Debian/PGDG sources from http:// to https://.
#   3. Bootstraps past the chicken-and-egg problem (installing
#      ca-certificates itself needs a verified HTTPS fetch, which needs
#      ca-certificates) with a TEMPORARY, explicitly-scoped apt.conf.d
#      override that is removed immediately after, before anything else is
#      fetched — the only thing ever pulled without verification is the
#      ca-certificates package itself.
#   4. Re-runs apt-get update with full verification restored and installs
#      the actual packages this image needs, verified normally.
# Verified end-to-end against this exact base image before writing it here.
RUN if [ -f /etc/ssl/certs/orbstack-root.crt ]; then \
      mkdir -p /usr/local/share/ca-certificates && \
      cp /etc/ssl/certs/orbstack-root.crt /usr/local/share/ca-certificates/orbstack-root.crt; \
    fi \
 && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && sed -i 's|http://apt.postgresql.org|https://apt.postgresql.org|g' /etc/apt/sources.list.d/pgdg.list \
 && echo 'Acquire::https::Verify-Peer "false"; Acquire::https::Verify-Host "false";' \
      > /etc/apt/apt.conf.d/99-bootstrap-insecure.conf \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -f /etc/apt/apt.conf.d/99-bootstrap-insecure.conf \
 && update-ca-certificates \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-16-postgis-3 \
      postgresql-16-postgis-3-scripts \
      postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*

# Runs on first start, before the schema, so it can substitute EMBED_DIM.
COPY init.sh /docker-entrypoint-initdb.d/00-init.sh
RUN chmod +x /docker-entrypoint-initdb.d/00-init.sh
