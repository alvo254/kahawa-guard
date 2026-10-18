-- Kahawa Guard schema. Every row seeded from this repo is invented: members,
-- plots, dealers, payments and documents. The forest fixture is hand-drawn.
--
-- The embedding column width must match the model in use:
--   mistral-embed      -> 1024
--   nomic-embed-text   ->  768
-- EMBED_DIM is substituted below by data/postgres/init.sh, and scripts/reset.sh
-- recreates the table when you switch providers. Embeddings from different
-- models cannot be mixed in one table.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  grower_code TEXT UNIQUE NOT NULL,
  -- phone_hash is what the gateway's own pipeline and audit trail use (a
  -- one-way SHA256 — see gateway/app/pipeline/identify.py). It can never be
  -- turned back into a dialable number, by design.
  phone_hash TEXT NOT NULL,
  -- phone_e164 is the real (here: invented sandbox) number n8n's SMS
  -- workflows actually send to. Only n8n's Postgres queries read this column;
  -- the gateway itself never selects it, so the model and the audit log never
  -- see a real number, only its hash.
  phone_e164 TEXT NOT NULL,
  coop_id INT NOT NULL,
  payout_account_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plots (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  geom geometry(Polygon, 4326) NOT NULL,
  gps_accuracy_m REAL,
  mock_location BOOLEAN DEFAULT FALSE,
  captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forest_2020 (
  id SERIAL PRIMARY KEY,
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS dealers (
  licence_no TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,          -- active, suspended, revoked
  valid_until DATE
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  registered BOOLEAN NOT NULL DEFAULT TRUE,
  max_dose_ml_per_20l REAL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  season TEXT NOT NULL,
  kilos REAL NOT NULL,
  amount_kes NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL,          -- pending, paid, held
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title TEXT,
  uploader_role TEXT NOT NULL,   -- board, coop, dealer, member
  trust TEXT NOT NULL,           -- trusted, untrusted
  sha256 TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  document_id INT REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(__EMBED_DIM__)
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id UUID PRIMARY KEY,
  tool TEXT NOT NULL,
  args JSONB NOT NULL,
  phone_hash TEXT,
  member_confirmed BOOLEAN DEFAULT FALSE,
  officer_approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ DEFAULT now(),
  profile TEXT, pack TEXT, phone_hash TEXT,
  layer TEXT, decision TEXT, score REAL, detail JSONB
);

CREATE INDEX IF NOT EXISTS plots_geom_idx      ON plots USING GIST (geom);
CREATE INDEX IF NOT EXISTS forest_2020_geom_idx ON forest_2020 USING GIST (geom);
CREATE INDEX IF NOT EXISTS audit_at_idx         ON audit_events (at DESC);
