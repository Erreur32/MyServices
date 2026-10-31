#!/usr/bin/env bash
# MyServices agent installer for Linux (run as root, systemd required).
#
#   export MSV_URL='http://<myservices>:8090'
#   export MSV_TOKEN='<token shown once by MyServices>'
#   curl -fsSL "$MSV_URL/agent/install.sh" | sudo env MSV_URL="$MSV_URL" MSV_TOKEN="$MSV_TOKEN" bash
#
# Options (environment variables, add them to the sudo env list):
#   MSV_MINUTES=5      interval between two reports (1 to 1440)
#   MSV_DOCKER=1       also put the agent user in the docker group (read Docker containers). Warning: the docker group is root-equivalent
#   MSV_SMART=1        allow `sudo -n smartctl -H /dev/*` for the agent user (SMART health of the disks)
#   MSV_SUDO=1         allow the three read-only commands that need root, each alone (exact sudo rules): services to restart after an
#                      update (needrestart, list mode), Fail2ban bans, and the process names behind the listening ports (ss)
#   MSV_UNINSTALL=1    remove the agent (revoke its token in MyServices: Settings -> Agents)
# Re-running is safe: it downloads the agent again and renews the config and the timer.
set -euo pipefail

DIR=/opt/myservices-agent
USER_NAME=myservices-agent
UNIT=myservices-agent
SUDOERS=/etc/sudoers.d/myservices-agent
OLD_SUDOERS=/etc/sudoers.d/myservices-agent-smart   # name used up to agent 3 (SMART only)

die() { echo "x $*" >&2; exit 1; }
ok() { echo "+ $*"; }

[[ "$(id -u)" = 0 ]] || die "Run this as root (put sudo before bash)."
command -v systemctl >/dev/null || die "systemd is required (systemctl not found)."

if [[ "${MSV_UNINSTALL:-}" = 1 ]]; then
  systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
  systemctl stop "$UNIT.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer" "$SUDOERS" "$OLD_SUDOERS"
  systemctl daemon-reload
  systemctl reset-failed "$UNIT.service" "$UNIT.timer" >/dev/null 2>&1 || true   # else a removed unit stays listed as « not-found failed » in systemctl --failed
  id "$USER_NAME" >/dev/null 2>&1 && userdel "$USER_NAME" >/dev/null 2>&1 || true
  rm -rf "$DIR"
  ok "MyServices agent removed (revoke its token in MyServices: Settings -> Agents)."
  exit 0
fi

URL=${MSV_URL:-}
TOKEN=${MSV_TOKEN:-}
MINUTES=${MSV_MINUTES:-5}
# Plain http is deliberate for a MyServices on the local network (the token never leaves it); https is used when the server has a certificate
URL_OK=0
[[ "$URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] && URL_OK=1  # NOSONAR S5332: local network, see above
[[ "$URL" =~ ^https?://\[[0-9A-Fa-f:]+\](:[0-9]{1,5})?$ ]] && URL_OK=1  # NOSONAR S5332: local network, see above
(( URL_OK )) || die "Bad MyServices address: '$URL' (expected http://host:port, no trailing path)"  # NOSONAR S5332: message only
[[ "$TOKEN" =~ ^msv_agent_[A-Za-z0-9_-]+$ ]] || die "Bad token: it must start with msv_agent_"
[[ "$MINUTES" =~ ^[0-9]+$ ]] && (( MINUTES >= 1 && MINUTES <= 1440 )) || die "MSV_MINUTES must be between 1 and 1440"
command -v python3 >/dev/null || die "python3 is required"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 6) else 1)' || die "Python 3.6 or newer is required"
command -v curl >/dev/null || die "curl is required"

# A dedicated account without a login, in the groups that let it read the system journal (and Docker only if asked)
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$DIR" --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
fi
for g in adm systemd-journal; do
  getent group "$g" >/dev/null && usermod -aG "$g" "$USER_NAME"
done
if [[ "${MSV_DOCKER:-}" = 1 ]]; then
  getent group docker >/dev/null && usermod -aG docker "$USER_NAME" || echo "! no docker group on this machine, skipped"
fi

mkdir -p "$DIR"
chown "$USER_NAME:$USER_NAME" "$DIR"
chmod 750 "$DIR"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$URL/agent/agent.py" -o "$TMP" || die "Cannot download the agent from $URL"
python3 -m py_compile "$TMP" || die "The downloaded agent has syntax errors"
install -o "$USER_NAME" -g "$USER_NAME" -m 644 "$TMP" "$DIR/agent.py"

# Config: the token is in it, so only the agent account (and root) can read it
( umask 077; printf '{"url": "%s", "token": "%s", "interval": %d}\n' "$URL" "$TOKEN" $((MINUTES * 60)) > "$DIR/config.json" )
chown "$USER_NAME:$USER_NAME" "$DIR/config.json"
chmod 600 "$DIR/config.json"
ok "Agent installed in $DIR"

NNP="NoNewPrivileges=true"
RULES=()
if [[ "${MSV_SMART:-}" = 1 ]]; then
  RULES+=("/usr/sbin/smartctl -H /dev/*")
fi
if [[ "${MSV_SUDO:-}" = 1 ]]; then
  # The exact commands MyServices runs through sudo -n (health.NEEDRESTART_ARGS, health.FAIL2BAN_ARGS, connectors/process.LISTEN_SH)
  RULES+=("/usr/sbin/needrestart -b -r l" "/usr/bin/fail2ban-client banned" "$(command -v ss || echo /usr/bin/ss) -tlnpH")
fi
rm -f "$OLD_SUDOERS"
if (( ${#RULES[@]} )); then
  for r in "${RULES[@]}"; do echo "$USER_NAME ALL=(root) NOPASSWD: $r"; done > "$SUDOERS.tmp"
  visudo -cf "$SUDOERS.tmp" >/dev/null || { rm -f "$SUDOERS.tmp"; die "sudoers rule rejected"; }
  chmod 440 "$SUDOERS.tmp"; mv "$SUDOERS.tmp" "$SUDOERS"
  NNP="# NoNewPrivileges is left off: sudo needs to gain privileges"
  ok "sudo allowed for ${#RULES[@]} exact read-only command(s): $SUDOERS"
else
  rm -f "$SUDOERS"
fi

cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=MyServices agent (sends this machine's health to MyServices)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
ExecStart=/usr/bin/env python3 $DIR/agent.py
TimeoutStartSec=300
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DIR
$NNP
EOF
cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=MyServices agent, every $MINUTES min

[Timer]
OnBootSec=1min
OnUnitActiveSec=${MINUTES}min
RandomizedDelaySec=15

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now "$UNIT.timer" >/dev/null 2>&1
ok "Timer '$UNIT.timer' enabled (every $MINUTES min, one minute after boot)"

echo "  First report..."
if systemctl start "$UNIT.service"; then
  ok "Done: the machine now reports to MyServices."
else
  journalctl -u "$UNIT.service" -n 8 --no-pager 2>/dev/null || true
  die "First report failed: see 'journalctl -u $UNIT.service' and $DIR/agent.log (wrong address, revoked token, or a report already sent less than a minute ago: wait a minute and retry)"
fi
