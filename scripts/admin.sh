#!/usr/bin/env bash
# scripts/admin.sh — layer switches and pack changes via the admin API.
# Usage:
#   admin.sh layers <layer>=on|off [<layer>=on|off ...]
#   admin.sh pack <name>
#   admin.sh reset
#   admin.sh state
set -euo pipefail

GATEWAY_URL=${GATEWAY_URL:-http://localhost:8000}
ADMIN_TOKEN=${ADMIN_TOKEN:-}

auth_header=()
if [[ -n "$ADMIN_TOKEN" ]]; then
  auth_header=(-H "X-Admin-Token: $ADMIN_TOKEN")
fi

cmd=${1:-}; shift || true

case "$cmd" in
  layers)
    [[ $# -ge 1 ]] || { echo "give at least one layer=on|off pair" >&2; exit 2; }
    body="{"
    sep=""
    for pair in "$@"; do
      key=${pair%%=*}
      val=${pair#*=}
      case "$val" in on|true|1) bval=true ;; off|false|0) bval=false ;;
        *) echo "bad value for $key: $val (use on/off)" >&2; exit 2 ;; esac
      body+="${sep}\"${key}\":${bval}"
      sep=","
    done
    body+="}"
    curl -sf "${auth_header[@]}" -H "Content-Type: application/json" \
      -d "{\"layers\":${body}}" "$GATEWAY_URL/api/admin/layers" | jq .
    ;;
  pack)
    [[ $# -eq 1 ]] || { echo "give exactly one pack name" >&2; exit 2; }
    curl -sf "${auth_header[@]}" -H "Content-Type: application/json" \
      -d "{\"pack\":\"$1\"}" "$GATEWAY_URL/api/admin/pack" | jq .
    ;;
  reset)
    curl -sf "${auth_header[@]}" -X POST "$GATEWAY_URL/api/admin/reset" | jq .
    ;;
  state)
    curl -sf "$GATEWAY_URL/api/admin/state" | jq .
    ;;
  mcp-refresh)
    curl -sf "${auth_header[@]}" -X POST "$GATEWAY_URL/api/admin/mcp-refresh" | jq .
    ;;
  *)
    echo "usage: $0 layers <layer>=on|off [...] | pack <name> | reset | state | mcp-refresh" >&2
    exit 2
    ;;
esac
