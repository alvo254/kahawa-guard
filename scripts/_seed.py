#!/usr/bin/env python3
"""Emit SQL that loads data/seed/* into Postgres. Used by scripts/reset.sh as:

    python3 scripts/_seed.py | kubectl -n data exec -i <postgres-pod> -- \
        psql -v ON_ERROR_STOP=1 -U kahawa -d kahawa

The CSVs are produced by scripts/seedgen.py (deterministic, synthetic). Each CSV
starts with a '# SYNTHETIC …' banner line, which the readers here skip.

The documents table (extension notes, the fake circular) is NOT loaded here:
it is loaded through the gateway's /api/upload so the chunks get real
embeddings. The fake circular in particular should arrive live, during Scene 2.
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "seed"

# Must match gateway/app/pipeline/identify.py's hash_phone exactly, or a member
# looked up by phone in the UI will not match the row seeded here.
PHONE_SALT = "kahawa-demo-salt"


def hash_phone(phone: str) -> str:
    return hashlib.sha256((PHONE_SALT + phone.strip()).encode()).hexdigest()[:16]


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def s(value: str) -> str:
    """Quoted string, or NULL for an empty/blank cell."""
    return sql_str(value) if value is not None and str(value).strip() != "" else "NULL"


def num(value: str) -> str:
    """Numeric literal, or NULL for an empty cell."""
    return str(value).strip() if value is not None and str(value).strip() != "" else "NULL"


def rows(name: str):
    """DictReader over a seed CSV, skipping the leading '# SYNTHETIC' banner."""
    with (SEED / name).open() as f:
        yield from csv.DictReader(line for line in f if not line.startswith("#"))


def emit_members() -> list[str]:
    out = []
    for r in rows("members.csv"):
        out.append(
            "INSERT INTO members (grower_code, phone_hash, phone_e164, coop_id, "
            "payout_account_ref, full_name, national_id, date_of_birth, sub_county, "
            "village, next_of_kin, next_of_kin_phone, joined_on, status, phone_changed_on) "
            # phone_e164 is NOT NULL; a member with no number on file stores '' (not NULL).
            f"VALUES ({sql_str(r['grower_code'])}, {sql_str(hash_phone(r['phone']))}, "
            f"{sql_str(r['phone'])}, {int(r['coop_id'])}, {sql_str(r['payout_account_ref'])}, "
            f"{s(r['full_name'])}, {s(r['national_id'])}, {s(r['date_of_birth'])}, "
            f"{s(r['sub_county'])}, {s(r['village'])}, {s(r['next_of_kin'])}, "
            f"{s(r['next_of_kin_phone'])}, {s(r['joined_on'])}, {s(r['status'])}, "
            f"{s(r['phone_changed_on'])});"
        )
    return out


def emit_dealers() -> list[str]:
    return [
        "INSERT INTO dealers (licence_no, name, status, valid_until) "
        f"VALUES ({sql_str(r['licence_no'])}, {sql_str(r['name'])}, "
        f"{sql_str(r['status'])}, {s(r['valid_until'])});"
        for r in rows("dealer_register.csv")
    ]


def emit_products() -> list[str]:
    out = []
    for r in rows("products.csv"):
        registered = "TRUE" if r["registered"].strip().lower() == "true" else "FALSE"
        out.append(
            "INSERT INTO products (name, registered, max_dose_ml_per_20l, notes) "
            f"VALUES ({sql_str(r['name'])}, {registered}, {num(r['max_dose_ml_per_20l'])}, "
            f"{sql_str(r['notes'])});"
        )
    return out


def _by_member(table: str, cols: str, select: str, csv_name: str) -> list[str]:
    """INSERT … SELECT id, … FROM members WHERE grower_code = …  (keeps FKs consistent)."""
    out = []
    for r in rows(csv_name):
        out.append(
            f"INSERT INTO {table} ({cols}) SELECT id, {select(r)} "
            f"FROM members WHERE grower_code = {sql_str(r['grower_code'])};"
        )
    return out


def emit_payments() -> list[str]:
    return _by_member(
        "payments", "member_id, season, kilos, amount_kes, status, paid_at",
        lambda r: f"{sql_str(r['season'])}, {num(r['kilos'])}, {num(r['amount_kes'])}, "
                  f"{sql_str(r['status'])}, {'now()' if r['status'] == 'paid' else 'NULL'}",
        "payments.csv")


def emit_deliveries() -> list[str]:
    return _by_member(
        "deliveries", "member_id, season, delivered_on, kilos, grade, factory",
        lambda r: f"{sql_str(r['season'])}, {s(r['delivered_on'])}, {num(r['kilos'])}, "
                  f"{s(r['grade'])}, {s(r['factory'])}",
        "deliveries.csv")


def emit_advances() -> list[str]:
    return _by_member(
        "advances", "member_id, kind, amount_kes, issued_on, status, dealer_licence",
        lambda r: f"{sql_str(r['kind'])}, {num(r['amount_kes'])}, {s(r['issued_on'])}, "
                  f"{s(r['status'])}, {s(r['dealer_licence'])}",
        "advances.csv")


def emit_grading() -> list[str]:
    # grading has lot_ref BEFORE member_id, so build the SELECT explicitly.
    out = []
    for r in rows("grading.csv"):
        out.append(
            "INSERT INTO grading (lot_ref, member_id, season, grade, cupping_score, outturn_pct, milled_on) "
            f"SELECT {sql_str(r['lot_ref'])}, id, {s(r['season'])}, {s(r['grade'])}, "
            f"{num(r['cupping_score'])}, {num(r['outturn_pct'])}, {s(r['milled_on'])} "
            f"FROM members WHERE grower_code = {sql_str(r['grower_code'])};"
        )
    return out


def emit_sacco() -> list[str]:
    return _by_member(
        "sacco", "member_id, savings_kes, loan_balance_kes, loan_status, last_statement",
        lambda r: f"{num(r['savings_kes'])}, {num(r['loan_balance_kes'])}, "
                  f"{s(r['loan_status'])}, {s(r['last_statement'])}",
        "sacco.csv")


def emit_buyers() -> list[str]:
    return [
        "INSERT INTO buyers (buyer_code, name, country, contact_name, contact_email, "
        "contact_phone, bank_name, bank_account, settlement_swift, kra_pin) "
        f"VALUES ({sql_str(r['buyer_code'])}, {sql_str(r['name'])}, {s(r['country'])}, "
        f"{s(r['contact_name'])}, {s(r['contact_email'])}, {s(r['contact_phone'])}, "
        f"{s(r['bank_name'])}, {s(r['bank_account'])}, {s(r['settlement_swift'])}, "
        f"{s(r['kra_pin'])});"
        for r in rows("buyers.csv")
    ]


def emit_contracts() -> list[str]:
    out = []
    for r in rows("contracts.csv"):
        out.append(
            "INSERT INTO contracts (contract_ref, buyer_id, season, kilos, price_per_kg_usd, "
            "incoterm, signed_at, status) "
            f"SELECT {sql_str(r['contract_ref'])}, id, {sql_str(r['season'])}, {num(r['kilos'])}, "
            f"{num(r['price_per_kg_usd'])}, {s(r['incoterm'])}, {s(r['signed_at'])}, {s(r['status'])} "
            f"FROM buyers WHERE buyer_code = {sql_str(r['buyer_code'])};"
        )
    return out


def geom_literal(geometry: dict) -> str:
    return f"ST_SetSRID(ST_GeomFromGeoJSON({sql_str(json.dumps(geometry))}), 4326)"


def emit_plots() -> list[str]:
    out = []
    data = json.loads((SEED / "plots.geojson").read_text())
    for feature in data["features"]:
        props = feature["properties"]
        mock = "TRUE" if props.get("mock_location") else "FALSE"
        accuracy = props.get("gps_accuracy_m")
        accuracy_sql = str(accuracy) if accuracy is not None else "NULL"
        out.append(
            "INSERT INTO plots (member_id, geom, gps_accuracy_m, mock_location) "
            f"SELECT id, {geom_literal(feature['geometry'])}, {accuracy_sql}, {mock} "
            f"FROM members WHERE grower_code = {sql_str(props['grower_code'])};"
        )
    return out


def emit_forest() -> list[str]:
    data = json.loads((SEED / "forest_2020_fixture.geojson").read_text())
    return [f"INSERT INTO forest_2020 (geom) VALUES ({geom_literal(f['geometry'])});"
            for f in data["features"]]


def main() -> None:
    print("-- generated by scripts/_seed.py — every row here is invented for the demo")
    print("BEGIN;")
    for block in (emit_members, emit_dealers, emit_products, emit_payments,
                  emit_deliveries, emit_advances, emit_grading, emit_sacco,
                  emit_buyers, emit_contracts, emit_plots, emit_forest):
        for stmt in block():
            print(stmt)
    print("COMMIT;")


if __name__ == "__main__":
    sys.exit(main())
