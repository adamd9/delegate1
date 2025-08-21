#!/usr/bin/env bash
set -euo pipefail

PORTS=(3000 8081)

kill_pids() {
  local p="$1"
  local pids
  pids=$(lsof -ti tcp:"$p" || true)
  if [[ -z "$pids" ]]; then
    echo "No processes listening on port $p"
    return 0
  fi
  echo "Sending SIGTERM to PIDs $pids on port $p"
  kill $pids || true
  # Wait briefly for graceful shutdown
  for i in {1..10}; do
    sleep 0.2
    if [[ -z "$(lsof -ti tcp:$p || true)" ]]; then
      echo "Port $p is now free"
      return 0
    fi
  done
  # Force kill if still present
  pids=$(lsof -ti tcp:"$p" || true)
  if [[ -n "$pids" ]]; then
    echo "Sending SIGKILL to PIDs $pids on port $p"
    kill -9 $pids || true
  fi
  if [[ -z "$(lsof -ti tcp:$p || true)" ]]; then
    echo "Port $p is now free"
  else
    echo "Warning: Port $p still appears to be in use" >&2
  fi
}

for port in "${PORTS[@]}"; do
  kill_pids "$port"
  echo "---"
done
