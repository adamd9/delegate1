#!/usr/bin/env bash

# hk_app_logs.sh
#
# PURPOSE
#   Fetch Azure App Service logs for the HK production app (hk.drop37.com).
#   Uses az CLI — must already be authenticated (az login).
#
# HOW IT WORKS
#   - 'tail': streams live container output via az webapp log tail.
#   - 'logs': downloads a Kudu log snapshot, extracts docker container logs, tails N lines.
#   - 'ps':   shows current app state and URL via az webapp show.
#
# USAGE
#   ./scripts/hk_app_logs.sh ps
#   ./scripts/hk_app_logs.sh logs [--lines N]
#   ./scripts/hk_app_logs.sh tail
#
# NOTES ON LOGGING
#   The 'logs' command downloads container logs written to stdout/stderr.
#   If you see "no log files found", enable container logging first:
#     az webapp log config \
#       --name hk-api-drop37 \
#       --resource-group AppServiceDev \
#       --docker-container-logging filesystem

set -euo pipefail

APP_NAME="hk-api-drop37"
RESOURCE_GROUP="AppServiceDev"

print_usage() {
  cat <<'USAGE'
Usage:
  hk_app_logs.sh ps
  hk_app_logs.sh logs [--lines N]
  hk_app_logs.sh tail

Commands:
  ps     Show current app state, URL, and last-modified timestamp.
  logs   Download a log snapshot from Kudu and print the last N lines (default: 50).
  tail   Stream live container logs (Ctrl+C to stop).
USAGE
}

check_az_auth() {
  if ! az account show --output none 2>/dev/null; then
    echo "az CLI is not authenticated. Run: az login" >&2
    exit 1
  fi
}

cmd_ps() {
  az webapp show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME" \
    --query "{App:name, State:state, URL:defaultHostName, LastModified:lastModifiedTimeUtc}" \
    --output table
}

cmd_logs() {
  local lines="$1"

  local tmp_zip tmp_dir
  tmp_zip=$(mktemp /tmp/hk-logs-XXXXXX.zip)
  tmp_dir=$(mktemp -d /tmp/hk-logs-XXXXXX)
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp_zip' '$tmp_dir'" EXIT

  echo "Downloading logs for $APP_NAME ..."
  az webapp log download \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME" \
    --log-file "$tmp_zip" \
    --output none

  unzip -q "$tmp_zip" -d "$tmp_dir"

  # Prefer docker container logs (stdout/stderr from node dist/server.js).
  # Kudu names them like <date>_<machine>_default_docker.log
  local -a log_files
  mapfile -t log_files < <(find "$tmp_dir" -type f -name "*_docker.log" | sort)

  # Fall back to any log/txt files if no docker logs found
  if [[ ${#log_files[@]} -eq 0 ]]; then
    mapfile -t log_files < <(find "$tmp_dir" -type f \( -name "*.log" -o -name "*.txt" \) | sort)
  fi

  if [[ ${#log_files[@]} -eq 0 ]]; then
    echo "No log files found in the downloaded archive." >&2
    echo "Enable container logging with:" >&2
    echo "  az webapp log config --name $APP_NAME --resource-group $RESOURCE_GROUP --docker-container-logging filesystem" >&2
    exit 1
  fi

  echo "--- last $lines lines ---"
  cat "${log_files[@]}" | tail -n "$lines"
}

cmd_tail() {
  echo "Streaming live logs for $APP_NAME  (Ctrl+C to stop) ..."
  echo ""
  az webapp log tail \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME"
}

main() {
  if [[ $# -lt 1 ]]; then
    print_usage >&2
    exit 2
  fi

  local cmd="$1"
  shift

  case "$cmd" in
    -h|--help) print_usage; exit 0 ;;
    ps|logs|tail) ;;
    *)
      echo "Unknown command: $cmd" >&2
      print_usage >&2
      exit 2
      ;;
  esac

  local lines="50"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --lines) lines="${2:-}"; shift 2 ;;
      -h|--help) print_usage; exit 0 ;;
      *)
        echo "Unknown argument: $1" >&2
        print_usage >&2
        exit 2
        ;;
    esac
  done

  check_az_auth

  case "$cmd" in
    ps)   cmd_ps ;;
    logs) cmd_logs "$lines" ;;
    tail) cmd_tail ;;
  esac
}

main "$@"
