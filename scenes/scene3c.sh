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
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

INSPECTOR_VERSION=${INSPECTOR_VERSION:-latest}
INSPECTOR="npx @modelcontextprotocol/inspector@${INSPECTOR_VERSION}"
POD=$(kubectl -n tools get pod -l app=records-fs -o jsonpath='{.items[0].metadata.name}')

say "records-fs pod: $POD"
note "Each call below spawns a fresh stdio server process inside that pod via"
note "'kubectl exec -i', the real way a stdio MCP server is invoked, with the"
note "MCP Inspector CLI driving the JSON-RPC handshake."

read_record() {
  local path=$1
  $INSPECTOR --cli kubectl -n tools exec -i "$POD" -- python3 server.py \
    --method tools/call --tool-name read_record --tool-arg "path=$path" \
    --format json 2>&1 | jq . 2>/dev/null || echo "(call failed or process was killed — check: make events)"
}

say "1. A normal read inside the allowed directory"
note "read_record(\"/srv/records/member-KG-0001.txt\")"
read_record "/srv/records/member-KG-0001.txt"
note "Expect: succeeds — this is the server behaving as intended."

say "2. The path-prefix bypass (CVE-2025-53110 shape)"
note "read_record(\"/srv/records-evil/secret.txt\") — a sibling directory whose"
note "name merely STARTS WITH /srv/records as a string. The server's own check"
note "(a bare .startswith) passes this."
read_record "/srv/records-evil/secret.txt"
note "Naked (no Tetragon policy applied): the fake secret comes back — the"
note "server's self-policing failed exactly as CVE-2025-53110 describes."
note "Hardened (confine-records-fs applied): the process is killed on the real"
note "kernel-level open of a path outside /srv/records/. Watch: make events"

say "3. The symlink bypass (CVE-2025-53109 shape)"
note "read_record(\"/srv/records/backdoor-link.txt\") — a symlink INSIDE the"
note "allowed directory, pointing to the same secret outside it. The server"
note "validates the link's own (allowed) path, then follows it to the real,"
note "disallowed target."
read_record "/srv/records/backdoor-link.txt"
note "Naked: the fake secret comes back again, through the link this time."
note "Hardened: Tetragon kills it the same way — it judges the real open, not"
note "the path string, so it does not care which trick produced it."

say "Apply the policy and repeat 2 and 3 to show the difference live:"
note "  kubectl apply -f deploy/policies/tetragon/confine-records-fs.yaml"
