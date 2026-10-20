#!/usr/bin/env bash
# scripts/port-forwards.sh <target> — start the port-forwards a target needs,
# in the background, and print how to stop them.
#
#   mcp      kahawa-tools -> :8001, farm-weather -> :8100, n8n -> :5678
#   gateway  gateway -> :8000
#   ui       UI and admin panel -> :8080
#   n8n      n8n -> :5678
#   all      everything above (no port is used twice)
#
# NOTE for Scene 3b: `kubectl port-forward` enters the pod through the kubelet,
# so Cilium policy does not see this traffic. Use it for the naked part of the
# demo and for everyday MCP Inspector work; do not use it to claim a hardened
# policy blocks something, because port-forward bypasses the thing being shown.
set -euo pipefail

target=${1:-mcp}
pids=()

# A port-forward is pinned to one pod and exits when that pod goes away (every
# make deploy that rolls it). Each forward runs in a loop so it reconnects to
# the new pod by itself; Ctrl-C stops them all.
fwd() {
  local ns=$1 svc=$2 local_port=$3 remote_port=$4
  local log=/tmp/kahawa-portforward-"$svc"-"$local_port".log
  echo "forwarding $ns/$svc  localhost:$local_port -> :$remote_port  (log: $log)"
  (
    while true; do
      kubectl -n "$ns" port-forward "svc/$svc" "$local_port:$remote_port" >>"$log" 2>&1 || true
      echo "$(date +%T) $svc forward ended; reconnecting" >>"$log"
      sleep 2
    done
  ) &
  pids+=("$!")
}

stop() {
  # Stop each loop first so it cannot respawn, then the kubectl it was running.
  local p kids
  for p in "${pids[@]}"; do
    kids=$(pgrep -P "$p" || true)
    kill "$p" 2>/dev/null || true
    [[ -n "$kids" ]] && kill $kids 2>/dev/null || true
  done
  exit 0
}
trap stop INT TERM

case "$target" in
  mcp)
    fwd tools kahawa-tools 8001 8000
    fwd attacker farm-weather 8100 8000
    fwd n8n n8n 5678 5678
    ;;
  gateway)
    fwd gateway gateway 8000 8000
    ;;
  ui)
    fwd kahawa-ui kahawa-ui 8080 8080
    ;;
  n8n)
    fwd n8n n8n 5678 5678
    ;;
  all)
    fwd kahawa-ui kahawa-ui 8080 8080
    fwd gateway gateway 8000 8000
    fwd tools kahawa-tools 8001 8000
    fwd attacker farm-weather 8100 8000
    fwd n8n n8n 5678 5678
    ;;
  *)
    echo "usage: $0 mcp|gateway|ui|n8n|all" >&2
    exit 2
    ;;
esac

sleep 1
echo
echo "running (pid): ${pids[*]}; forwards reconnect after pod restarts"
echo "stop with Ctrl-C"
wait
