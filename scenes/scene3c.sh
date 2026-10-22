#!/usr/bin/env bash
# Scene 3c — the server you cannot trust.
#
# records-fs is a stdio MCP server that is supposed to confine reads to
# /srv/records. Its own check reproduces the EscapeRoute flaw class
# (CVE-2025-53109/53110): a string-prefix check on the raw path, no symlink
# resolution. Two escapes are pre-staged in the image (see its Dockerfile):
#   - /srv/records-evil/secret.txt   a sibling dir starting with the same prefix
#   - /srv/records/backdoor-link.txt a symlink inside the allowed dir, pointing out
#
# The point is not "patch this server". It is that Tetragon's confine-records-fs
# TracingPolicy enforces the real boundary underneath it, on the kernel's actual
# file open, regardless of what path string the server validated. Have
# `make events` running in another tab before you start this.
#
# We drive the stdio server with RAW newline-delimited JSON-RPC piped straight
# into `kubectl exec -i` — the real way a stdio MCP server is spoken to, and with
# no MCP Inspector / npx flag-parsing in the way (the previous version failed on
# every call for that reason).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

NS=${NS:-tools}
PROTO=${PROTO:-2024-11-05}
POD=$(kubectl -n "$NS" get pod -l app=records-fs -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POD" ]; then
  echo "no records-fs pod in namespace $NS — is it deployed?" >&2
  exit 1
fi

# One tools/call over a fresh stdio process: initialize, initialized, call.
mcp_read() {
  local path=$1 init inited call
  init=$(jq -cn --arg v "$PROTO" \
    '{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:$v,capabilities:{},clientInfo:{name:"scene3c",version:"0"}}}')
  inited='{"jsonrpc":"2.0","method":"notifications/initialized"}'
  call=$(jq -cn --arg p "$path" \
    '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"read_record",arguments:{path:$p}}}')
  printf '%s\n%s\n%s\n' "$init" "$inited" "$call" \
    | kubectl -n "$NS" exec -i "$POD" -- python3 server.py 2>/dev/null
}

read_record() {
  local path=$1 out line
  out=$(mcp_read "$path" || true)
  # `|| true`: under `set -euo pipefail` a non-matching grep returns non-zero,
  # which would abort the whole script here before the empty-line check below.
  line=$(printf '%s\n' "$out" | grep '"id":2' | tail -1 || true)
  if [ -z "$line" ]; then
    echo "(no response this call — the stdio handshake is intermittent over"
    echo " 'kubectl exec -i'; re-run 'make scene3c'. If it never responds, the"
    echo " process was killed (hardened) — check: make events)"
    return
  fi
  # The tool's return is JSON inside the result's text content; pretty-print it.
  printf '%s' "$line" \
    | jq -r '.result.content[0].text // (.result|tostring) // (.error|tostring)' 2>/dev/null \
    | jq . 2>/dev/null || printf '%s\n' "$line"
}

say "records-fs pod: $POD (driven over raw JSON-RPC via kubectl exec -i)"

say "0. Sanity: list the tools the server exposes"
printf '%s\n%s\n' \
  "$(jq -cn --arg v "$PROTO" '{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:$v,capabilities:{},clientInfo:{name:"scene3c",version:"0"}}}')" \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  | { cat; printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; } \
  | kubectl -n "$NS" exec -i "$POD" -- python3 server.py 2>/dev/null \
  | grep '"id":2' | jq -r '.result.tools[].name' 2>/dev/null \
  | sed 's/^/    tool: /' || echo "    (no tools listed — the handshake failed; see note below)"
note "If nothing lists here, the server isn't answering over stdio at all —"
note "check: kubectl -n $NS exec -i $POD -- python3 server.py <<< '{}'  (should not error on import)"

say "1. A normal read inside the allowed directory"
note 'read_record("/srv/records/member-KG-0001.txt")'
read_record "/srv/records/member-KG-0001.txt"
note "Expect: succeeds — this is the server behaving as intended (no policy applied)."

say "2. The path-prefix bypass (CVE-2025-53110 shape)"
note 'read_record("/srv/records-evil/secret.txt") — a sibling directory whose'
note "name merely STARTS WITH /srv/records as a string. The server's own check"
note "(a bare .startswith) passes this."
read_record "/srv/records-evil/secret.txt"
note "Naked (no Tetragon policy): the fake secret comes back — the server's"
note "self-policing failed exactly as CVE-2025-53110 describes."
note "Hardened (confine-records-fs applied): killed on the real kernel open —"
note "/srv/records-evil/secret.txt is the forbidden area. Watch: make events"

say "3. The symlink bypass (CVE-2025-53109 shape)"
note 'read_record("/srv/records/backdoor-link.txt") — a symlink INSIDE the'
note "allowed directory, pointing to the same secret outside it. The server"
note "validates the link's own (allowed) path, then follows it to the real target."
read_record "/srv/records/backdoor-link.txt"
note "Naked: the fake secret comes back again, through the link this time."
note "Hardened: Tetragon kills it the same way — the link's STRING looks like it"
note "is inside /srv/records, but the kernel judges the RESOLVED open"
note "(/srv/records-evil/secret.txt), so it does not care which trick produced it."

say "Apply the policy and repeat 2 and 3 to show the difference live:"
note "  kubectl apply -f deploy/policies/tetragon/confine-records-fs.yaml"
