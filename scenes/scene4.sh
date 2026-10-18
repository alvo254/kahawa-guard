#!/usr/bin/env bash
# Scene 4 (optional) — the laundered plot.
# KG-0003's registered plot sits inside the hand-drawn 2020 forest fixture.
# check_plot flags the overlap regardless of what the member or the model says.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_gateway

say "Registering/checking a plot that overlaps the 2020 forest fixture"
send "+254700000003" "Register my new plot, I am KG-0003. Is it eligible?"
note "Expect: check_plot reports a non-zero forest_overlap_m2 and eligible=false,"
note "and the reply says so rather than confirming eligibility."

say "A clean plot, for contrast"
send "+254700000001" "Register my plot, I am KG-0001. Is it eligible?"
note "Expect: no forest overlap, no duplicate claim, eligible=true."
