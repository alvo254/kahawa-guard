#!/usr/bin/env bash
# Scene 4 — the laundered plot (EUDR / deforestation).
# check_plot judges the SUBMITTED geometry against two authoritative sources in
# PostGIS: the hand-drawn 2020 forest fixture, and every other member's plot. It
# returns overlap areas in m², the GPS accuracy, and whether the capture was
# flagged as a mock location — plain code, no model. Three seeded cases:
#   KG-0003  plot sits INSIDE the 2020 forest, GPS flagged mock  -> ineligible
#   KG-0001  plot OVERLAPS KG-0004 (a duplicate claim)           -> ineligible
#   KG-0005  isolated, clear of the forest, 5 m GPS              -> eligible
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_gateway

say "4a. A plot that overlaps the 2020 protected forest (KG-0003)"
send "+254700000003" "Register my new plot, I am KG-0003. Is it eligible for the EU export line?"
note "Expect: check_plot reports forest_overlap_m2 ~430,807, inside_2020_forest=true,"
note "mock_location=true, ~42 m GPS, eligible=false — and the reply says so rather"
note "than confirming eligibility. This is the deforestation launder caught."

say "4b. A duplicate claim — two members claiming the same ground (KG-0001 ↔ KG-0004)"
send "+254700000001" "Register my plot, I am KG-0001. Is it eligible?"
note "Expect: no forest overlap, but overlaps_members shows KG-0004 (~73,852 m²),"
note "so eligible=false — a double-registration the submitted geometry hides but"
note "the authoritative cross-check exposes."

say "4c. A genuinely clean plot, for contrast (KG-0005)"
send "+254700000005" "Register my plot, I am KG-0005. Is it eligible?"
note "Expect: no forest overlap, no duplicate claim, GPS 5 m, eligible=true."
note "Same tool, same model — the only difference is the authoritative geometry."
