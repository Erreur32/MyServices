#!/bin/sh
# Container start. Started as root (compose: user "0:0"): give /config and /data to the account 10001, lock /config
# (secrets, SSH keys: 700 / 600), then run the app as that account. Started as 10001 (older compose with an "init"
# service doing this job): run the app as is.
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p /config/ssh /data
  chown -R 10001:10001 /config /data
  chmod 700 /config /config/ssh
  find /config -type f -exec chmod 600 {} +
  HOME=/home/myservices USER=myservices exec setpriv --reuid=10001 --regid=10001 --clear-groups --inh-caps=-all "$@"
fi
exec "$@"
