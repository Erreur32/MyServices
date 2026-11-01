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
#   MSV_NPM=/path/npm-api.sh  read this Nginx Proxy Manager through its script, as the owner of the script (exact sudo rules, one per list)
#   MSV_SMART=1        allow `sudo -n smartctl -H /dev/*` for the agent user (SMART health of the disks)
#   MSV_SUDO=1         allow the three read-only commands that need root, each alone (exact sudo rules): services to restart after an
#                      update (needrestart, list mode), Fail2ban bans, and the process names behind the listening ports (ss)
#   MSV_ALLOW_HTTP=1   accept plain http beyond the local network or a VPN: the token then crosses the internet unencrypted
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
# Same rule in install.ps1: beyond the local network or a VPN, the token would cross the internet unencrypted
LOCAL_HOST='^(localhost|[^.\[]+|.*\.(lan|local|home|internal|ts\.net)|10\.[0-9.]+|127\.[0-9.]+|192\.168\.[0-9.]+|169\.254\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9.]+|\[(fc|fd|fe[89ab])[^]]*\]|\[::1\])$'
[[ "$URL" =~ ^https?://(\[[^]]+\]|[^:/]+) ]]
SERVER=${BASH_REMATCH[1],,}
if [[ "$URL" == http://* && "${MSV_ALLOW_HTTP:-}" != 1 && ! "$SERVER" =~ $LOCAL_HOST ]]; then  # NOSONAR S5332: this line refuses it
  die "Refused: plain http to $SERVER would send the agent token unencrypted across the internet. Use https or a VPN address, or add MSV_ALLOW_HTTP=1 to the sudo env list."
fi
[[ "$TOKEN" =~ ^msv_agent_[A-Za-z0-9_-]+$ ]] || die "Bad token: it must start with msv_agent_"
[[ "$MINUTES" =~ ^[0-9]+$ ]] && (( MINUTES >= 1 && MINUTES <= 1440 )) || die "MSV_MINUTES must be between 1 and 1440"
NPM=${MSV_NPM:-}
NPM_USER=""
if [[ -n "$NPM" ]]; then
  [[ "$NPM" =~ ^/[A-Za-z0-9._/-]+$ && -x "$NPM" ]] || die "MSV_NPM must be the full path of an executable npm-api.sh"
  [[ -z $(find "$NPM" -perm -o+w) ]] || die "MSV_NPM: the script must not be writable by every account"
  command -v sudo >/dev/null || die "MSV_NPM needs sudo on this machine"
  NPM_USER=$(stat -c %U "$NPM")
  # Its login token is written in DATA_DIR of npm-api.conf, by default data/ next to the script
  NPM_DATA=$(sed -n 's/^DATA_DIR="\{0,1\}\([^"#]*\)"\{0,1\}.*/\1/p' "$(dirname "$NPM")/npm-api.conf" 2>/dev/null | tail -1 || true)
  [[ "$NPM_DATA" =~ ^/[A-Za-z0-9._/-]+$ ]] || NPM_DATA="$(dirname "$NPM")/data"
  install -d -o "$NPM_USER" "$NPM_DATA"
fi
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
NPM_JSON=""
[[ -n "$NPM" ]] && NPM_JSON=$(printf ', "npm": {"path": "%s", "user": "%s"}' "$NPM" "$NPM_USER")
( umask 077; printf '{"url": "%s", "token": "%s", "interval": %d%s}\n' "$URL" "$TOKEN" $((MINUTES * 60)) "$NPM_JSON" > "$DIR/config.json" )
chown "$USER_NAME:$USER_NAME" "$DIR/config.json"
chmod 600 "$DIR/config.json"
ok "Agent installed in $DIR"

NNP="NoNewPrivileges=true"
PROTECT_HOME=true
WRITABLE="$DIR"
RULES=()
if [[ "${MSV_SMART:-}" = 1 ]]; then
  RULES+=("/usr/sbin/smartctl -H /dev/*")
fi
if [[ "${MSV_SUDO:-}" = 1 ]]; then
  # The exact commands MyServices runs through sudo -n (health.NEEDRESTART_ARGS, health.FAIL2BAN_ARGS, connectors/process.LISTEN_SH)
  RULES+=("/usr/sbin/needrestart -b -r l" "/usr/bin/fail2ban-client banned" "$(command -v ss || echo /usr/bin/ss) -tlnpH")
fi
rm -f "$OLD_SUDOERS"
if (( ${#RULES[@]} )) || [[ -n "$NPM" ]]; then
  {
    for r in ${RULES[@]+"${RULES[@]}"}; do echo "$USER_NAME ALL=(root) NOPASSWD: $r"; done
    if [[ -n "$NPM" ]]; then   # runs as the owner of the script, not as root; the exact lists of npmapi.LISTS
      for o in --host-list --redirect-host-list --dead-host-list --stream-host-list --access-list; do
        echo "$USER_NAME ALL=($NPM_USER) NOPASSWD: $NPM --json $o"
      done
    fi
  } > "$SUDOERS.tmp"
  visudo -cf "$SUDOERS.tmp" >/dev/null || { rm -f "$SUDOERS.tmp"; die "sudoers rule rejected"; }
  chmod 440 "$SUDOERS.tmp"; mv "$SUDOERS.tmp" "$SUDOERS"
  NNP="# NoNewPrivileges is left off: sudo needs to gain privileges"
  ok "sudo allowed for exact read-only commands: $SUDOERS"
  if [[ -n "$NPM" ]]; then   # sudo stays in the sandbox of the service: the script must see /home and write its login token
    PROTECT_HOME=read-only
    WRITABLE="$DIR $NPM_DATA"
  fi
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
ProtectHome=$PROTECT_HOME
ProtectSystem=strict
ReadWritePaths=$WRITABLE
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
