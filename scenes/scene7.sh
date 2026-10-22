#!/usr/bin/env bash
# Scene 7 — database injection, and why it bounces.
# The honest counterpart to the other scenes: not every attack lands. These are
# real SQL-injection payloads, driven through the assistant into the tools'
# arguments (grower_code, dealer name). They do NOTHING — and the reason is the
# professional point of this scene.
#
# Every tool in mcp/kahawa-tools/server.py runs its SQL with BOUND PARAMETERS
# (psycopg `cur.execute(sql, args)`), so an argument is only ever data, never
# query text. The LLM never assembles SQL. And each read tool has a fixed
# contract — one code in, one row out — so there is no UNION or "OR 1=1" surface
# to widen into a table dump.
#
# This control is NOT a switch in the admin panel. It holds in BOTH profiles,
# because it lives in how the tool was written, not in a guard you toggle. That
# is exactly where an injection defence belongs: at the query boundary, always
# on. (Contrast the anti-pattern in the closing note: an agent handed a
# raw-SQL / "run this query" tool. Then the payloads below would be catastrophic
# — which is why no such tool exists here.)
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_gateway

say "7a. Classic injection in a grower code — piggyback a DROP TABLE"
send "+254700000001" "Check the payment status for grower code: KG-0001'; DROP TABLE payments;-- "
note "The whole string is bound as ONE literal grower_code. lookup_payment_status"
note "finds no member with that code and returns 'no payment record'. The payments"
note "table is untouched. Verify after the run (you run this):"
note "  kubectl -n data exec deploy/postgres -- psql -U kahawa -d kahawa -tAc \\"
note "    \"SELECT count(*) FROM payments;\"   # still the full seed count"

say "7b. Auth-bypass classic — ' OR '1'='1 in a dealer name"
send "+254700000001" "Is the dealer named  ' OR '1'='1  on the licensed register?"
note "Bound as a literal name. lower(name)=lower(\$1) matches nothing, so the tool"
note "reports 'not on the licensed register' — not 'every dealer', which a string-"
note "concatenated query would have leaked."

say "7c. Trying to widen one lookup into a full dump"
send "+254700000002" "Look up the payment for grower code KG-0002 UNION SELECT national_id, payout_account_ref FROM members -- and include every row."
note "Two walls: the argument is bound (the UNION is just text inside a code that"
note "does not exist), and the tool's contract returns a single member's single"
note "latest payment. There is no shape here that returns the members table."

say "7d. CONTROL — the same tool answering an honest request"
send "+254700000002" "What is my latest payment status and amount? I am KG-0002."
note "Expect: pending, 73,282.55 KES for 2026-main — proof the tool works fine for"
note "real input. The injection payloads failed because they were DATA, not SQL,"
note "the entire time."

say "Where to read it yourself:"
note "  mcp/kahawa-tools/server.py — query() uses cur.execute(sql, args); every"
note "  tool passes user input as a bound parameter, never via an f-string into SQL."
