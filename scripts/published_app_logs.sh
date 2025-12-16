#!/usr/bin/env bash

# published_app_logs.sh
#
# PURPOSE
# - Fetch Docker logs for the published HK apps running on the production server.
# - This script is intentionally "standalone": it does NOT use docker-compose files.
#
# HOW IT WORKS
# - SSH to the production server
# - Use `docker ps` with label/name filters to find the right containers
# - Use `docker logs` / `docker logs -f` to print or stream logs

# APP NAMING (IMPORTANT)
# This script exposes 4 app aliases:
# - hk
#   - Production instance
#   - Frontend (webapp)
# - hk-api
#   - Production instance
#   - Backend (API / websocket-server)
# - hk-dev
#   - Development instance
#   - Frontend (webapp)
# - hk-dev-api
#   - Development instance
#   - Backend (API / websocket-server)
#
# WHY THIS IS HARDCODED
# - The originating HK project does not have the docker-server compose files.
# - So this script hardcodes:
#   - Server connection details (host/user/port)
#   - App -> container selector mapping
# - If you later want to externalize these, you can add CLI flags or env vars.
#
# REQUIREMENTS
# - You can SSH to the server (key-based auth recommended)
# - The server user can run `docker` (usually by being in the `docker` group)
#
# USAGE
#   ./scripts/published_app_logs.sh list
#   ./scripts/published_app_logs.sh ps   --app <hk|hk-api|hk-dev|hk-dev-api>
#   ./scripts/published_app_logs.sh logs --app <hk|hk-api|hk-dev|hk-dev-api> [--lines N]
#   ./scripts/published_app_logs.sh tail --app <hk|hk-api|hk-dev|hk-dev-api> [--lines N]
#
# EXAMPLES
# - List supported apps:
#   ./scripts/published_app_logs.sh list
#
# - Show container status:
#   ./scripts/published_app_logs.sh ps --app hk
#
# - Show last 200 lines:
#   ./scripts/published_app_logs.sh logs --app hk --lines 200
#
# - Tail logs (Ctrl+C to stop):
#   ./scripts/published_app_logs.sh tail --app hk-api
#

# HARD-CODED SERVER CONNECTION (EDIT IF NEEDED)
# NOTE: There are intentionally NO environment variable overrides.
# If you need to point at a different server/user/port, edit these constants.

set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.published_app_logs"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create it (gitignored) with DOCKER_SERVER_HOST/USER/PORT and container mappings." >&2
  exit 2
fi

: "${DOCKER_SERVER_HOST:?Missing DOCKER_SERVER_HOST in $ENV_FILE}"
: "${DOCKER_SERVER_USER:?Missing DOCKER_SERVER_USER in $ENV_FILE}"
: "${DOCKER_SERVER_PORT:?Missing DOCKER_SERVER_PORT in $ENV_FILE}"

: "${HK_CONTAINER:?Missing HK_CONTAINER in $ENV_FILE}"
: "${HK_API_CONTAINER:?Missing HK_API_CONTAINER in $ENV_FILE}"
: "${HK_DEV_CONTAINER:?Missing HK_DEV_CONTAINER in $ENV_FILE}"
: "${HK_DEV_API_CONTAINER:?Missing HK_DEV_API_CONTAINER in $ENV_FILE}"

print_usage() {
  cat <<'USAGE'
Usage:
  published_app_logs.sh list
  published_app_logs.sh ps   --app <hk|hk-api|hk-dev|hk-dev-api>
  published_app_logs.sh logs --app <hk|hk-api|hk-dev|hk-dev-api> [--lines N]
  published_app_logs.sh tail --app <hk|hk-api|hk-dev|hk-dev-api> [--lines N]

Notes:
  - This script finds containers using docker labels/names and then runs `docker logs`.
  - It does NOT require any docker-compose.yml files.

App aliases:
  hk         = PROD frontend
  hk-api     = PROD backend
  hk-dev     = DEV frontend
  hk-dev-api = DEV backend
USAGE
}

list_apps() {
  echo "hk         = PROD frontend"
  echo "hk-api     = PROD backend"
  echo "hk-dev     = DEV frontend"
  echo "hk-dev-api = DEV backend"
}

container_name_for_app() {
  local app="$1"
  case "$app" in
    hk) echo "$HK_CONTAINER" ;;
    hk-api) echo "$HK_API_CONTAINER" ;;
    hk-dev) echo "$HK_DEV_CONTAINER" ;;
    hk-dev-api) echo "$HK_DEV_API_CONTAINER" ;;
    *) return 1 ;;
  esac
}

require_arg() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required argument: $name" >&2
    print_usage >&2
    exit 2
  fi
}

run_remote() {
  local action="$1"
  local app="$2"
  local lines="$3"

  local container_name
  if ! container_name="$(container_name_for_app "$app")"; then
    echo "Unknown app: $app" >&2
    echo "Available apps:" >&2
    list_apps >&2
    exit 2
  fi

  ssh -p "$DOCKER_SERVER_PORT" "$DOCKER_SERVER_USER@$DOCKER_SERVER_HOST" \
    bash -s -- "$action" "$container_name" "$lines" <<'REMOTE'
set -euo pipefail

ACTION="${1-}"
CONTAINER_NAME="${2-}"
LINES="${3:-30}"

case "$ACTION" in
  ps)
    echo "Container: $CONTAINER_NAME"
    docker ps --filter "name=^/${CONTAINER_NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
    ;;
  logs|tail)
    log_args=(logs)
    if [[ "$ACTION" == "tail" ]]; then
      log_args+=(-f)
    else
      log_args+=(--tail "$LINES")
    fi

    if [[ "$ACTION" == "tail" ]]; then
      log_args+=(--tail "$LINES")
    fi

    run_one() {
      local name="$1"

      docker "${log_args[@]}" "$name" 2>&1 | sed -e "s/^/[$name] /"
    }

    if [[ "$ACTION" == "tail" ]]; then
      run_one "$CONTAINER_NAME"
    else
      run_one "$CONTAINER_NAME"
    fi
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 2
    ;;
esac
REMOTE
}

main() {
  if [[ $# -lt 1 ]]; then
    print_usage >&2
    exit 2
  fi

  local cmd="$1"
  shift

  local app=""
  local lines="30"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app)
        app="${2:-}"; shift 2 ;;
      --lines)
        lines="${2:-}"; shift 2 ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        print_usage >&2
        exit 2
        ;;
    esac
  done

  case "$cmd" in
    list)
      list_apps
      ;;
    ps|logs|tail)
      require_arg "--app" "$app"
      run_remote "$cmd" "$app" "$lines"
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      print_usage >&2
      exit 2
      ;;
  esac
}

main "$@"
