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
  payout_account_ref TEXT NOT NULL,
  -- Member PII. All synthetic (see scripts/seedgen.py). These make the demo DB
  -- read like a real cooperative register — and give the poisoning scenes a real
  -- person to point at.
  full_name TEXT,
  national_id TEXT,
  date_of_birth DATE,
  sub_county TEXT,
  village TEXT,
  next_of_kin TEXT,
  next_of_kin_phone TEXT,
  joined_on DATE,
  status TEXT DEFAULT 'active',        -- active | inactive | deceased
  phone_changed_on DATE                -- NULL unless the number is stale
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

-- Operational back-office tables. All synthetic. Payments above are derived from
-- deliveries, so the numbers reconcile the way a real factory system's do.
CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  season TEXT NOT NULL,
  delivered_on DATE NOT NULL,
  kilos REAL NOT NULL,
  grade TEXT,
  factory TEXT
);

CREATE TABLE IF NOT EXISTS advances (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  kind TEXT NOT NULL,                       -- cash | fertiliser | pesticide
  amount_kes NUMERIC(12,2),
  issued_on DATE,
  status TEXT,                              -- outstanding | repaid | written_off
  dealer_licence TEXT REFERENCES dealers(licence_no)
);

CREATE TABLE IF NOT EXISTS grading (
  id SERIAL PRIMARY KEY,
  lot_ref TEXT UNIQUE NOT NULL,
  member_id INT REFERENCES members(id),
  season TEXT,
  grade TEXT,                               -- AA | AB | PB | C | TT
  cupping_score REAL,
  outturn_pct REAL,
  milled_on DATE
);

CREATE TABLE IF NOT EXISTS sacco (
  member_id INT PRIMARY KEY REFERENCES members(id),
  savings_kes NUMERIC(12,2),
  loan_balance_kes NUMERIC(12,2),
  loan_status TEXT,                         -- none | current | arrears
  last_statement DATE
);

-- Corporate buyer layer: the "leak corporate PII / financials" target.
CREATE TABLE IF NOT EXISTS buyers (
  id SERIAL PRIMARY KEY,
  buyer_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  bank_name TEXT,
  bank_account TEXT,
  settlement_swift TEXT,
  kra_pin TEXT
);

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  contract_ref TEXT UNIQUE NOT NULL,
  buyer_id INT REFERENCES buyers(id),
  season TEXT NOT NULL,
  kilos REAL NOT NULL,
  price_per_kg_usd NUMERIC(8,2) NOT NULL,
  incoterm TEXT,                            -- FOB | CIF
  signed_at DATE,
  status TEXT                              -- draft | signed | settled
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
