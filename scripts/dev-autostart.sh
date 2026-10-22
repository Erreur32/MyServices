#!/usr/bin/env bash
# After a reboot of the dev machine: start the dev server again (Vite :5180) in the herdr pane « MyServices dev », the usual way (npm run dev
# at the root of the repo). herdr keeps its panes but not what ran in them. The backend :8090 comes back by itself (restart: unless-stopped):
# dev.sh only runs a « compose up -d » that changes nothing, reuses the « Logs backend » pane, then starts Vite.
# Meant to be called once herdr answers (by the machine's own herdr autostart script). Does nothing when Vite already listens.
set -u
HERDR=${HERDR:-/root/.local/bin/herdr}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
log() { echo "$(date -Is) $*"; }

if ss -ltn 'sport = :5180' 2>/dev/null | grep -q LISTEN; then
  log "Vite :5180 already running, nothing to do"
  exit 0
fi
# Pane found by its label, like scripts/dev-stop.sh: its id may change
pane=$("$HERDR" pane list 2>/dev/null | jq -r '.result.panes[] | select(.label == "MyServices dev") | .pane_id' | head -n 1)
if [ -z "$pane" ]; then
  log "pane « MyServices dev » not found, Vite not started"
  exit 1
fi
log "starting MyServices dev (npm run dev) in $pane"
"$HERDR" pane send-keys "$pane" C-u >/dev/null # text left on the prompt line (seen after a reboot) would be glued to the command
"$HERDR" pane run "$pane" "cd $ROOT && npm run dev"
