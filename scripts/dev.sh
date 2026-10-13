#!/usr/bin/env bash
# One dev launcher: the backend container (API, collection, sign-in page) and the front with hot reload (Vite), started and stopped together.
#
#   scripts/dev.sh            start the backend if needed, then Vite in the foreground ; Ctrl+C stops both
#   scripts/dev.sh --build    rebuild the image (myservices:dev) and recreate the backend first (after a Python change)
#   scripts/dev.sh --keep     leave the backend running when Vite stops
#   scripts/dev.sh --stop     stop the backend and leave
#
# Settings (environment, or a .dev.env file at the root of the repo, ignored by git):
#   MS_DEV_COMPOSE   compose file of the backend          (default: compose.yaml of the repo, page on :8090)
#   MS_DEV_PROJECT   compose project name                 (default: compose's own)
#   MS_DEV_BACKEND   address of the backend, for Vite     (default: http://127.0.0.1:8090)
#   MS_DEV_HOSTS     extra host names allowed by Vite     (default: this machine's first IP)
#   VITE_PORT        port of the front                    (default: 5180)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
[[ -f "$ROOT/.dev.env" ]] && set -a && . "$ROOT/.dev.env" && set +a

COMPOSE=${MS_DEV_COMPOSE:-$ROOT/compose.yaml}
BACKEND=${MS_DEV_BACKEND:-http://127.0.0.1:8090}
HOSTS=${MS_DEV_HOSTS:-$(hostname -I 2>/dev/null | awk '{print $1}')}
dc() { docker compose ${MS_DEV_PROJECT:+-p "$MS_DEV_PROJECT"} -f "$COMPOSE" "$@"; }

build=0 keep=0
for a in "$@"; do
  case $a in
    --build) build=1 ;;
    --keep) keep=1 ;;
    --stop) dc stop; exit 0 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

if [[ "$build" = 1 ]]; then
  echo "▸ building myservices:dev…"
  docker build -q -t myservices:dev --build-arg GIT_REV="$("$ROOT/scripts/git-rev.sh")" "$ROOT" >/dev/null   # git state shown in the header
  dc up -d --force-recreate
else
  dc up -d
fi

echo -n "▸ waiting for the backend ($BACKEND)"
for _ in $(seq 1 60); do
  curl -sf "$BACKEND/healthz" >/dev/null && break
  echo -n .; sleep 1
done
curl -sf "$BACKEND/healthz" >/dev/null || { echo " not answering: docker compose logs" >&2; exit 1; }
echo " ok"

if [[ "$keep" = 0 ]]; then
  trap 'echo; echo "▸ stopping the backend…"; dc stop >/dev/null 2>&1 || true' EXIT
fi
echo "▸ front with hot reload: http://${HOSTS:-localhost}:${VITE_PORT:-5180}/  (Ctrl+C stops$([[ "$keep" = 0 ]] && echo " both"))"  # NOSONAR S5332: the local Vite dev server, http on purpose
cd "$ROOT/front"
MYSERVICES_BACKEND="$BACKEND" MS_DEV_HOSTS="$HOSTS" npm run dev
