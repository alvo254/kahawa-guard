#!/usr/bin/env bash
# scripts/mcp-pin.sh — usage: mcp-pin.sh print|check URL [URL...]
#
# Hashes each server's tools/list result with the MCP Inspector CLI and either
# prints the hash (print) or compares it with mcp/tests/pins.json (check). This
# is the SAME canonical form the gateway uses at runtime (jq -S sorted, compact,
# sha256) — see gateway/app/mcp/pinning.py's module docstring for why the two
# must stay in step.
set -euo pipefail

mode=${1:-}; shift || true
if [[ "$mode" != "print" && "$mode" != "check" ]]; then
  echo "usage: $0 print|check URL [URL...]" >&2
  exit 2
fi
if [[ $# -eq 0 ]]; then
  echo "give at least one server URL" >&2
  exit 2
fi

INSPECTOR_VERSION=${INSPECTOR_VERSION:-latest}
INSPECTOR="npx @modelcontextprotocol/inspector@${INSPECTOR_VERSION}"
PINS_FILE="$(dirname "$0")/../mcp/tests/pins.json"

status=0
for url in "$@"; do
  raw=$($INSPECTOR --cli "$url" --transport http --method tools/list --format json 2>/dev/null)
  # Confirm this path against the Inspector CLI's actual output shape before
  # relying on it — the docs note the result may be wrapped differently across
  # releases.
  hash=$(echo "$raw" | jq -S '.result' | tr -d '\n' | shasum -a 256 | cut -d' ' -f1)

  if [[ "$mode" == print ]]; then
    echo "$url $hash"
  else
    want=$(jq -r --arg u "$url" '.[$u] // ""' "$PINS_FILE")
    if [[ -z "$want" ]]; then
      echo "UNPINNED $url (actual $hash) — add it to mcp/tests/pins.json"
      status=1
    elif [[ "$hash" == "$want" ]]; then
      echo "ok      $url"
    else
      echo "CHANGED $url (expected $want, got $hash)"
      status=1
    fi
  fi
done
exit $status
