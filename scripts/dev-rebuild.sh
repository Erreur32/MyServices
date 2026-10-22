#!/usr/bin/env bash
# Rebuild the dev backend (:8090) from the current code and restart its container, without touching Vite (:5180) or the herdr panes:
# Vite reloads by itself. Uses the dev compose file of .dev.env (MS_DEV_COMPOSE, e.g. compose.local.yaml), else compose.yaml.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
compose=$(grep -oP '^MS_DEV_COMPOSE=\K.*' .dev.env 2>/dev/null || echo compose.yaml)
docker build -q -t myservices:dev --build-arg GIT_REV="$(scripts/git-rev.sh)" .
docker compose -f "$compose" up -d --force-recreate
