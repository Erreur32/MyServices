#!/bin/sh
# Container start. Started as root (compose: user "0:0"): give /config and /data to the account 10001, lock /config
# (secrets, SSH keys: 700 / 600), then run the app as that account, keeping NET_RAW only if the compose gives it. Started as 10001 (older compose with an "init"
# service doing this job): run the app as is.
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p /config/ssh /data
  chown -R 10001:10001 /config /data
  chmod 700 /config /config/ssh
  find /config -type f -exec chmod 600 {} +
  # NET_RAW given by the compose: kept for the app alone (ping on hosts where unprivileged ping is off); nothing else
  caps=-all
  [ $(( 0x$(sed -n 's/^CapPrm:[[:space:]]*//p' /proc/self/status) >> 13 & 1 )) = 1 ] && caps=-all,+net_raw
  HOME=/home/myservices USER=myservices exec setpriv --reuid=10001 --regid=10001 --clear-groups --inh-caps=$caps --ambient-caps=$caps "$@"
fi
exec "$@"
