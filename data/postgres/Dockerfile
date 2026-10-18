# PostGIS plus pgvector in one image, so plots and embeddings live in one database.
# Pin the digest before rehearsals.
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*

# Runs on first start, before the schema, so it can substitute EMBED_DIM.
COPY init.sh /docker-entrypoint-initdb.d/00-init.sh
RUN chmod +x /docker-entrypoint-initdb.d/00-init.sh
