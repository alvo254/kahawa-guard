#!/usr/bin/env bash
# scripts/port-forwards.sh <target> — start the port-forwards a target needs,
# in the background, and print how to stop them.
#
#   mcp      kahawa-tools -> :8000, farm-weather -> :8100
#   gateway  gateway -> :8000
#   n8n      n8n -> :5678
#   all      everything above
#
# NOTE for Scene 3b: `kubectl port-forward` enters the pod through the kubelet,
# so Cilium policy does not see this traffic. Use it for the naked part of the
# demo and for everyday MCP Inspector work; do not use it to claim a hardened
# policy blocks something, because port-forward bypasses the thing being shown.
set -euo pipefail

target=${1:-mcp}
pids=()

fwd() {
  local ns=$1 svc=$2 local_port=$3 remote_port=$4
  echo "forwarding $ns/$svc  localhost:$local_port -> :$remote_port"
  kubectl -n "$ns" port-forward "svc/$svc" "$local_port:$remote_port" \
    >/tmp/kahawa-portforward-"$svc"-"$local_port".log 2>&1 &
  pids+=("$!")
}

case "$target" in
  mcp)
    fwd tools kahawa-tools 8000 8000
    fwd attacker farm-weather 8100 8000
    ;;
  gateway)
    fwd gateway gateway 8000 8000
    ;;
  n8n)
    fwd n8n n8n 5678 5678
    ;;
  all)
    fwd gateway gateway 8000 8000
    fwd tools kahawa-tools 8001 8000
    fwd attacker farm-weather 8100 8000
    fwd n8n n8n 5678 5678
    ;;
  *)
    echo "usage: $0 mcp|gateway|n8n|all" >&2
    exit 2
    ;;
esac

sleep 1
echo
echo "running (pid): ${pids[*]}"
echo "stop with: kill ${pids[*]}"
wait
