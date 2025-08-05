#!/usr/bin/env bash
# Run localtunnel.js in background, show startup info, then detach.
set -euo pipefail

if [ "${CODEX_CLI:-}" != "true" ]; then
  echo "[start-localtunnel] Skipped: CODEX_CLI is not 'true'"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/localtunnel.log"

node "$SCRIPT_DIR/../localtunnel.js" > "$LOG_FILE" 2>&1 &
LT_PID=$!

until grep -q "Public URL" "$LOG_FILE"; do sleep 1; done
head -n 20 "$LOG_FILE"

disown "$LT_PID"
