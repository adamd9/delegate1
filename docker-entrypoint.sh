#!/usr/bin/env bash
# docker-entrypoint.sh — run before starting the app server
# 1. Authenticate gh CLI with COPILOT_GITHUB_TOKEN
# 2. Ensure the Copilot CLI binary is downloaded and on PATH

set -e

# Authenticate gh if we have a token
if [ -n "$COPILOT_GITHUB_TOKEN" ]; then
  echo "$COPILOT_GITHUB_TOKEN" | gh auth login --with-token 2>/dev/null || true

  # If the CLI binary isn't in the persisted volume yet, download it directly
  COPILOT_BIN="$HOME/.local/share/gh/copilot/copilot"
  if [ ! -f "$COPILOT_BIN" ]; then
    echo "[entrypoint] Downloading GitHub Copilot CLI..."
    ARCH=$(uname -m)
    case "$ARCH" in
      aarch64|arm64) ASSET="copilot-linux-arm64.tar.gz" ;;
      *)             ASSET="copilot-linux-x64.tar.gz" ;;
    esac
    TMP_DIR=$(mktemp -d)
    GH_TOKEN="$COPILOT_GITHUB_TOKEN" gh release download \
      --repo github/copilot-cli \
      --pattern "$ASSET" \
      --dir "$TMP_DIR" 2>&1 || true
    if [ -f "$TMP_DIR/$ASSET" ]; then
      mkdir -p "$(dirname "$COPILOT_BIN")"
      tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"
      EXTRACTED=$(find "$TMP_DIR" -name "copilot" -type f | head -1)
      if [ -n "$EXTRACTED" ]; then
        cp "$EXTRACTED" "$COPILOT_BIN"
        chmod +x "$COPILOT_BIN"
        echo "[entrypoint] Copilot CLI downloaded successfully"
      fi
    fi
    rm -rf "$TMP_DIR"
  fi

  # Symlink to PATH so 'which copilot' succeeds (preferred over ghMode)
  if [ -f "$COPILOT_BIN" ] && [ ! -f /usr/local/bin/copilot ]; then
    ln -sf "$COPILOT_BIN" /usr/local/bin/copilot
    echo "[entrypoint] Copilot CLI ready: $(copilot --version 2>/dev/null || echo 'version unknown')"
  elif [ -f "$COPILOT_BIN" ]; then
    echo "[entrypoint] Copilot CLI already linked: $(copilot --version 2>/dev/null || echo 'version unknown')"
  else
    echo "[entrypoint] WARNING: Copilot CLI binary not found, will fall back to gh copilot wrapper"
  fi
fi

exec "$@"
