#!/bin/sh
# Seeds n8n before it starts: the credentials the workflows reference, every
# workflow in $WF_DIR, and activation of the MCP server workflow. Runs as an
# initContainer on every pod start, since n8n's own state is an emptyDir and the
# encryption key it generates is new each time. Imports overwrite by id.
set -eu

WF_DIR=${WF_DIR:-/workflows}
MCP_WORKFLOW_ID=kahawaMcpServer1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$WF_DIR"/*.json "$work/"

bearer=""
if [ -n "${N8N_MCP_TOKEN:-}" ]; then
  bearer=',{"id":"kahawa-mcp-bearer","name":"Kahawa MCP bearer","type":"httpBearerAuth",
            "data":{"token":"'"$N8N_MCP_TOKEN"'"}}'
  # HARDENED: the MCP trigger demands the gateway's bearer token.
  node -e '
    const fs = require("fs"), f = process.argv[1], wf = JSON.parse(fs.readFileSync(f));
    const t = wf.nodes.find(n => n.type === "@n8n/n8n-nodes-langchain.mcpTrigger");
    t.parameters.authentication = "bearerAuth";
    t.credentials = { httpBearerAuth: { id: "kahawa-mcp-bearer", name: "Kahawa MCP bearer" } };
    fs.writeFileSync(f, JSON.stringify(wf));
  ' "$work/kahawa_mcp.json"
fi

mkdir -p "$work/creds"
cat > "$work/creds/creds.json" <<JSON
[
  {"id":"kahawa-postgres","name":"Kahawa Postgres","type":"postgres",
   "data":{"host":"$DB_POSTGRESDB_HOST","port":5432,"database":"$DB_POSTGRESDB_DATABASE",
           "user":"$DB_POSTGRESDB_USER","password":"$DB_POSTGRESDB_PASSWORD","ssl":"disable"}},
  {"id":"kahawa-at-header","name":"Africa's Talking apiKey header","type":"httpHeaderAuth",
   "data":{"name":"apiKey","value":"${AT_API_KEY:-unset}"}}$bearer
]
JSON

n8n import:credentials --input="$work/creds/creds.json"
n8n import:workflow --separate --input="$work"
n8n update:workflow --id="$MCP_WORKFLOW_ID" --active=true
