# Sourced by every scene script. Not run directly.
set -euo pipefail

GATEWAY_URL=${GATEWAY_URL:-http://localhost:8000}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

send() {
  # send PHONE "message text"  -> pretty-prints the gateway's reply and verdicts
  local phone=$1 message=$2
  curl -sf -X POST "$GATEWAY_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$phone" --arg m "$message" '{phone:$p, message:$m}')" \
  | jq '{reply, blocked_by, pending, verdicts: [.verdicts[] | select(.decision!="info") | {layer, decision, detail, score}]}'
}

require_gateway() {
  if ! curl -sf -o /dev/null "$GATEWAY_URL/healthz"; then
    echo "gateway not reachable at $GATEWAY_URL — run 'make ui' or port-forward it first" >&2
    exit 1
  fi
}
