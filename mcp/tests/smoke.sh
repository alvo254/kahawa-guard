#!/usr/bin/env bash
# mcp/tests/smoke.sh — call every kahawa-tools tool through the Inspector CLI
# with known inputs and fail if a result is missing or malformed.
# Usage: smoke.sh [URL]   (default http://localhost:8000/mcp)
set -euo pipefail

URL=${1:-http://localhost:8000/mcp}
INSPECTOR_VERSION=${INSPECTOR_VERSION:-latest}
INSPECTOR="npx @modelcontextprotocol/inspector@${INSPECTOR_VERSION}"

status=0

call() {
  local tool=$1; shift
  local args=("$@")
  local cli_args=()
  for kv in "${args[@]}"; do
    cli_args+=(--tool-arg "$kv")
  done
  echo "--- $tool ${args[*]:-} ---"
  if ! out=$($INSPECTOR --cli "$URL" --transport http --method tools/call \
              --tool-name "$tool" "${cli_args[@]}" --format json 2>&1); then
    echo "FAIL $tool: inspector call errored"
    echo "$out"
    status=1
    return
  fi
  if ! echo "$out" | jq -e '.result' >/dev/null 2>&1; then
    echo "FAIL $tool: no .result in output"
    echo "$out"
    status=1
    return
  fi
  echo "ok   $tool"
}

call lookup_dealer "licence_no=DL-0042"
call lookup_dealer "name=Highland Coffee Chemicals"
call lookup_payment_status "grower_code=KG-0001"
call get_extension_notes "topic=berry disease"
call check_plot "grower_code=KG-0003"
call fetch_url "url=http://kahawa-tools.tools.svc.cluster.local:8000/healthz"

if [[ $status -ne 0 ]]; then
  echo "smoke test FAILED"
else
  echo "smoke test passed, all tools responded"
fi
exit $status
