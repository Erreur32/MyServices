#!/usr/bin/env bash
# MyServices : installation en place (le dossier de ce script reste celui du programme).
# Unités systemd + extrait nginx ou Apache générés depuis deploy/*.in, puis premier passage.
# Relançable : régénère les unités (après un git pull ou un changement d'option).
set -euo pipefail

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OWNER=$(stat -c %U:%G "$DIR")
API_USER=""
API_PORT=9201
COLLECT_AT="*-*-* *:00,15,30,45:00"
WATCH_AT="*-*-* *:05,20,35,50:00"
HEALTH_AT="*-*-* 00/2:00:00"
BACKUPS_AT="*-*-* 01,07,13,19:05:00"
LAN=""
DESTDIR=""
WEBSRV="" REFRESH=1 WATCHER=1 FIRST_RUN=1 DRY=0 FORCE=0 UNINSTALL=0

usage() {
  cat <<EOF
Usage : sudo ./install.sh [options]

  --owner USER:GROUP   propriétaire du projet, de data.json et events.json (défaut : $OWNER)
  --api-user USER      utilisateur de l'API du bouton ⟳ (défaut : propriétaire, ou nobody si root)
  --api-port PORT      port local de l'API (défaut : $API_PORT)
  --collect-at SPEC    horaires du collecteur, format OnCalendar (défaut : "$COLLECT_AT")
  --watch-at SPEC      horaires du watcher (défaut : "$WATCH_AT")
  --health-at SPEC     horaires de health.py (défaut : "$HEALTH_AT"), installé si health_url = "health/"
  --backups-at SPEC    horaires de backups.py (défaut : "$BACKUPS_AT"), installé si backups-meta.json existe
  --lan CIDR           réseau autorisé à voir la page (défaut : détecté, ex. 192.168.1.0/24)
  --nginx | --apache   serveur web qui publie la page (défaut : nginx s'il est installé, sinon Apache)
  --no-web             aucun des deux (page servie autrement) ; ancien nom : --no-nginx
  --no-refresh         pas de bouton ⟳ (API + unité .path)
  --no-watcher         pas de veille des changements (ni historique ni alertes)
  --no-run             pas de premier passage
  --destdir DIR        écrit les fichiers sous DIR sans rien activer (test, paquet)
  --dry-run            affiche les actions sans rien faire
  --force              continue malgré un test de setup.py en échec ou une autre installation
  --uninstall          retire unités et extraits nginx / Apache (garde config, caches et état)
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
  --owner)
    OWNER=$2
    shift
    ;;
  --api-user)
    API_USER=$2
    shift
    ;;
  --api-port)
    API_PORT=$2
    shift
    ;;
  --collect-at)
    COLLECT_AT=$2
    shift
    ;;
  --watch-at)
    WATCH_AT=$2
    shift
    ;;
  --health-at)
    HEALTH_AT=$2
    shift
    ;;
  --backups-at)
    BACKUPS_AT=$2
    shift
    ;;
  --lan)
    LAN=$2
    shift
    ;;
  --destdir)
    DESTDIR=$2
    shift
    ;;
  --nginx) WEBSRV=nginx ;;
  --apache) WEBSRV=apache ;;
  --no-web | --no-nginx) WEBSRV=none ;;
  --no-refresh) REFRESH=0 ;;
  --no-watcher) WATCHER=0 ;;
  --no-run) FIRST_RUN=0 ;;
  --dry-run) DRY=1 ;;
  --force) FORCE=1 ;;
  --uninstall) UNINSTALL=1 ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
  esac
  shift
done

say() { printf '\033[1m==\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31m✗\033[0m %s\n' "$*" >&2
  exit 1
}
# Exécute, ou affiche seulement (--dry-run, ou --destdir pour ce qui touche au système)
run() { if [[ $DRY == 1 ]]; then echo "  + $*"; else "$@"; fi; }
sys() { if [[ -n $DESTDIR ]]; then echo "  (destdir) $*"; else run "$@"; fi; }
py() { (cd "$DIR" && PYTHONDONTWRITEBYTECODE=1 "$PYTHON" "$@"); }

SYSTEMD_DIR=$DESTDIR/etc/systemd/system
NGINX_DIR=$DESTDIR/etc/nginx
APACHE_DIR=$DESTDIR/etc/apache2
if [[ -z $WEBSRV ]]; then # choix automatique : nginx, sinon Apache (Debian : apache2ctl), sinon aucun
  if [[ -n $DESTDIR ]] || command -v nginx >/dev/null; then
    WEBSRV=nginx
  elif command -v apache2ctl >/dev/null; then
    WEBSRV=apache
  else WEBSRV=none; fi
fi
UNITS=(myservices.service myservices.timer)
[[ $WATCHER == 1 ]] && UNITS+=(myservices-watcher.service myservices-watcher.timer)
[[ $REFRESH == 1 ]] && UNITS+=(myservices-refresh-api.service myservices-refresh.path)
ALL_UNITS=(myservices.service myservices.timer myservices-watcher.service myservices-watcher.timer
  myservices-refresh-api.service myservices-refresh.path myservices-health.service myservices-health.timer
  myservices-backups.service myservices-backups.timer)

# Unité d'un autre dossier (même nom, installée à la main ou par un autre clone) : jamais retirée.
# Jugé sur le .service de l'unité (un .timer suit son service), d'après son ExecStart.
foreign() {
  local svc=$SYSTEMD_DIR/${1%.*}.service
  [[ -f $svc ]] && grep -q '^ExecStart=' "$svc" && ! grep -qF "$DIR/" "$svc"
}

[[ $EUID -eq 0 || -n $DESTDIR || $DRY == 1 ]] || die "à lancer en root (sudo ./install.sh)"
PYTHON=$(command -v python3) || die "python3 introuvable"
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 9))' || die "Python 3.9 minimum"

# Une installation existante qui pointe ailleurs (autre clone, ancienne version) n'est jamais écrasée
other=$(sed -n 's|^ExecStart=.* \(/.*\)/myservices\.py$|\1|p' "$SYSTEMD_DIR/myservices.service" 2>/dev/null || true)
# (--uninstall : seules les unités de ce dossier sont retirées, celles d'un autre sont laissées)
if [[ -n $other && $other != "$DIR" && $FORCE == 0 && $UNINSTALL == 0 ]]; then
  die "myservices.service existe déjà et lance $other/myservices.py : désinstaller depuis ce dossier, ou --force"
fi

# ---------------------------------------------------------------------------
if [[ $UNINSTALL == 1 ]]; then
  say "Désinstallation"
  WEB_DIR=$(py -c 'from config import CFG; print(CFG["web_dir"])' 2>/dev/null || echo "$DIR/web")
  # Fichiers à retirer : unités de CE dossier, extraits nginx / Apache qui publient SON web_dir
  # (un extrait d'une autre installation, ex. la prod d'un autre clone, n'est jamais touché)
  mine() { [[ -f $1 ]] && grep -qF "$WEB_DIR/" "$1"; }
  files=()
  for u in "${ALL_UNITS[@]}"; do [[ -f $SYSTEMD_DIR/$u ]] && ! foreign "$u" && files+=("$SYSTEMD_DIR/$u"); done
  mine "$NGINX_DIR/snippets/myservices.conf" && files+=("$NGINX_DIR/snippets/myservices.conf")
  # La zone de limite de débit va avec l'extrait : retirée seulement avec lui
  mine "$NGINX_DIR/snippets/myservices.conf" && [[ -f $NGINX_DIR/conf.d/myservices-zones.conf ]] &&
    files+=("$NGINX_DIR/conf.d/myservices-zones.conf")
  mine "$APACHE_DIR/conf-available/myservices.conf" && files+=("$APACHE_DIR/conf-available/myservices.conf")
  for f in "$NGINX_DIR/snippets/myservices.conf" "$APACHE_DIR/conf-available/myservices.conf"; do
    [[ -f $f ]] && ! mine "$f" && warn "$f publie un autre dossier que $WEB_DIR : gardé"
  done
  if [[ ${#files[@]} -eq 0 ]]; then
    say "Rien à retirer : aucune unité ni extrait web de $DIR"
    exit 0
  fi
  # Sauvegarde avant de retirer : unités, extraits web, configuration (restaurable par tar -xzpf -C /)
  backup=${BACKUP_DIR:-/root}/myservices-avant-desinstallation-$(date +%Y%m%d-%H%M%S).tar.gz
  keep=("${files[@]}")
  for f in config.json services-meta.json backups-meta.json; do [[ -f $DIR/$f ]] && keep+=("$DIR/$f"); done
  say "Sauvegarde → $backup"
  run tar -czPf "$backup" "${keep[@]}"
  [[ $DRY == 1 ]] || chmod 600 "$backup"
  for u in "${ALL_UNITS[@]}"; do
    [[ " ${files[*]} " == *" $SYSTEMD_DIR/$u "* ]] || continue
    sys systemctl disable --now "$u"
    run rm -f "$SYSTEMD_DIR/$u"
  done
  sys systemctl daemon-reload
  if [[ " ${files[*]} " == *" $NGINX_DIR/snippets/myservices.conf "* ]]; then
    grep -rls 'snippets/myservices.conf' "$NGINX_DIR"/sites-enabled/ 2>/dev/null |
      while read -r f; do warn "retirer « include snippets/myservices.conf; » de $f avant de recharger nginx"; done || true
    run rm -f "$NGINX_DIR/snippets/myservices.conf" "$NGINX_DIR/conf.d/myservices-zones.conf"
    sys nginx -t && sys systemctl reload nginx
  fi
  if [[ " ${files[*]} " == *" $APACHE_DIR/conf-available/myservices.conf "* ]]; then
    sys a2disconf -q myservices
    run rm -f "$APACHE_DIR/conf-available/myservices.conf"
    sys apache2ctl configtest && sys systemctl reload apache2
  fi
  say "Terminé. Sauvegarde : $backup. Gardés : config.json, services-meta.json, caches (~root/.cache/myservices),"
  echo "  /var/lib/myservices-*. Règles sudoers posées sur les autres machines (SMART, AdGuard) : à retirer à la main"
  echo "  (/etc/sudoers.d/myservices-*) si plus aucune version de MyServices ne les utilise."
  exit 0
fi

# ---------------------------------------------------------------------------
say "Configuration"
if [[ ! -f $DIR/config.json || ! -f $DIR/services-meta.json ]]; then
  [[ -t 0 ]] || die "config.json ou services-meta.json absent : lancer d'abord « sudo python3 setup.py » dans un terminal"
  [[ $DRY == 1 ]] && die "--dry-run : configuration absente, lancer d'abord « sudo python3 setup.py »"
  py setup.py || [[ $FORCE == 1 ]] || die "setup.py en échec (corriger puis relancer, ou --force)"
else
  py setup.py --check || [[ $FORCE == 1 ]] || die "setup.py --check en échec (corriger puis relancer, ou --force)"
fi

WEB_DIR=$(py -c 'from config import CFG; print(CFG["web_dir"])')
# health.py intégré seulement si la page le lit dans web/health/ (une autre URL = health-watcher externe)
if [[ $(py -c 'from config import CFG; print(CFG["health_url"])') == health/ && ! -L $WEB_DIR/health ]]; then
  UNITS+=(myservices-health.service myservices-health.timer)
fi
# backups.py seulement avec un inventaire, et si web/backups.json n'est pas le lien d'un script externe
if [[ -f $(py -c 'from config import CFG; print(CFG["backups_meta"])') && ! -L $WEB_DIR/backups.json ]]; then
  UNITS+=(myservices-backups.service myservices-backups.timer)
fi
OWNER_USER=${OWNER%%:*} OWNER_GROUP=${OWNER#*:}
id "$OWNER_USER" >/dev/null 2>&1 || die "utilisateur $OWNER_USER inconnu (--owner)"
if [[ -z $API_USER ]]; then
  API_USER=$OWNER_USER
  [[ $API_USER == root ]] && API_USER=nobody
fi
[[ $API_USER == root ]] && die "l'API du bouton ⟳ ne doit pas tourner en root (--api-user)"
if [[ -z $LAN ]]; then
  LAN=$(py setup.py --lan)
  [[ -n $LAN ]] || die "réseau local non détecté : --lan CIDR"
fi

# web_dir hors du projet : la page (fichiers statiques) y est recopiée à chaque installation
if [[ $WEB_DIR != "$DIR/web" ]]; then
  say "Page recopiée dans $WEB_DIR"
  run mkdir -p "$WEB_DIR"
  run cp -r "$DIR"/web/. "$WEB_DIR"/
fi
[[ -d $WEB_DIR || $DRY == 1 ]] && run chown -R "$OWNER" "$WEB_DIR"
case $WEB_DIR in /root/*) warn "$WEB_DIR est sous /root : ni nginx ni l'API ⟳ ne pourront le lire" ;; esac

# ---------------------------------------------------------------------------
say "Unités systemd → $SYSTEMD_DIR"
esc() { printf '%s' "$1" | sed -e 's/[|&\\]/\\&/g'; }
render() {
  local src=$1 dst=$2
  echo "  → $dst"
  [[ $DRY == 1 ]] && return
  mkdir -p "$(dirname "$dst")"
  sed -e "s|@DIR@|$(esc "$DIR")|g" -e "s|@PYTHON@|$(esc "$PYTHON")|g" \
    -e "s|@WEB_DIR@|$(esc "$WEB_DIR")|g" -e "s|@OWNER@|$(esc "$OWNER")|g" \
    -e "s|@OWNER_USER@|$(esc "$OWNER_USER")|g" -e "s|@OWNER_GROUP@|$(esc "$OWNER_GROUP")|g" \
    -e "s|@API_USER@|$(esc "$API_USER")|g" -e "s|@API_PORT@|$(esc "$API_PORT")|g" \
    -e "s|@COLLECT_AT@|$(esc "$COLLECT_AT")|g" -e "s|@WATCH_AT@|$(esc "$WATCH_AT")|g" \
    -e "s|@HEALTH_AT@|$(esc "$HEALTH_AT")|g" -e "s|@BACKUPS_AT@|$(esc "$BACKUPS_AT")|g" \
    -e "s|@LAN_CIDR@|$(esc "$LAN")|g" "$src" >"$dst"
  chmod 644 "$dst"
  if grep -q '@[A-Z_]*@' "$dst"; then die "variable non remplacée dans $dst"; fi
}
for u in "${UNITS[@]}"; do render "$DIR/deploy/systemd/$u.in" "$SYSTEMD_DIR/$u"; done
for u in "${ALL_UNITS[@]}"; do # option retirée depuis la dernière installation
  if [[ " ${UNITS[*]} " != *" $u "* && -f $SYSTEMD_DIR/$u ]] && ! foreign "$u"; then
    sys systemctl disable --now "$u"
    run rm -f "$SYSTEMD_DIR/$u"
  fi
done
sys systemctl daemon-reload
for u in "${UNITS[@]}"; do
  case $u in *.timer | *.path | myservices-refresh-api.service) sys systemctl enable --now "$u" ;; esac
done
[[ $REFRESH == 1 ]] && sys systemctl restart myservices-refresh-api.service

# ---------------------------------------------------------------------------
# Le serveur web (www-data sous Debian) doit pouvoir lire la page
web_readable() {
  if id www-data >/dev/null 2>&1 && ! runuser -u www-data -- test -r "$WEB_DIR/index.html"; then
    warn "www-data ne peut pas lire $WEB_DIR/index.html (droits des dossiers parents ? un clone dans /opt évite /home)"
  fi
}
if [[ $WEBSRV == none ]]; then
  say "Serveur web : non modifié (--no-web)"
  echo "  la page doit être servie par votre propre configuration : $WEB_DIR sous /myservices/,"
  echo "  et /myservices/api/ relayé vers 127.0.0.1:$API_PORT (bouton ⟳). Modèle : deploy/apache/ ou deploy/nginx/"
elif [[ $WEBSRV == nginx ]]; then
  if [[ -z $DESTDIR ]] && ! command -v nginx >/dev/null; then
    warn "nginx absent : page non publiée (--apache si Apache est installé, ou installer nginx et relancer)"
  else
    say "nginx → $NGINX_DIR"
    render "$DIR/deploy/nginx/myservices-zones.conf.in" "$NGINX_DIR/conf.d/myservices-zones.conf"
    render "$DIR/deploy/nginx/myservices.conf.in" "$NGINX_DIR/snippets/myservices.conf"
    if [[ -z $DESTDIR && $DRY == 0 ]]; then
      if ! out=$(nginx -t 2>&1); then
        rm -f "$NGINX_DIR/conf.d/myservices-zones.conf" "$NGINX_DIR/snippets/myservices.conf"
        die "nginx -t refuse la configuration, fichiers MyServices retirés :
$out"
      fi
      systemctl reload nginx
      web_readable
    fi
    grep -rqs 'snippets/myservices.conf' "$NGINX_DIR"/sites-enabled/ ||
      warn "ajouter « include snippets/myservices.conf; » dans le bloc server voulu de $NGINX_DIR/sites-enabled/, puis : nginx -t && systemctl reload nginx"
  fi
else # Apache, disposition Debian (conf-available + a2enconf) : actif sur tous les sites, rien à ajouter à la main
  if [[ -z $DESTDIR ]] && ! command -v a2enconf >/dev/null; then
    die "Apache sans a2enconf (pas Debian) : --no-web, puis inclure deploy/apache/myservices.conf.in adapté à la main"
  fi
  say "Apache → $APACHE_DIR"
  render "$DIR/deploy/apache/myservices.conf.in" "$APACHE_DIR/conf-available/myservices.conf"
  if [[ -z $DESTDIR && $DRY == 0 ]]; then
    a2enmod -q proxy proxy_http headers
    a2enconf -q myservices
    if ! out=$(apache2ctl configtest 2>&1); then
      a2disconf -q myservices
      rm -f "$APACHE_DIR/conf-available/myservices.conf"
      die "apache2ctl configtest refuse la configuration, extrait MyServices retiré :
$out"
    fi
    systemctl reload apache2
    web_readable
  fi
fi

# ---------------------------------------------------------------------------
if [[ $FIRST_RUN == 1 ]]; then
  say "Premier passage du collecteur (quelques minutes selon le nombre de machines)"
  sys systemctl start myservices.service || die "échec du passage : journalctl -u myservices.service"
  # Premier passage du watcher = baseline : aucune alerte
  [[ $WATCHER == 1 ]] && { sys systemctl start myservices-watcher.service || warn "watcher en échec : journalctl -u myservices-watcher"; }
  if [[ " ${UNITS[*]} " == *" myservices-health.service "* ]]; then
    sys systemctl start myservices-health.service || warn "health en échec : journalctl -u myservices-health"
  fi
  if [[ " ${UNITS[*]} " == *" myservices-backups.service "* ]]; then
    sys systemctl start myservices-backups.service || warn "backups en échec : journalctl -u myservices-backups"
  fi
fi

say "Installé"
URL=$(py -c 'from config import CFG; print(CFG["public_url"])')
echo "  Page        : ${URL:-$WEB_DIR/index.html (public_url vide)}"
echo "  Collecteur  : $COLLECT_AT · journalctl -u myservices.service"
[[ $WATCHER == 1 ]] && echo "  Watcher     : $WATCH_AT · journalctl -u myservices-watcher.service"
[[ " ${UNITS[*]} " == *" myservices-health.service "* ]] && echo "  Health      : $HEALTH_AT · journalctl -u myservices-health.service"
[[ " ${UNITS[*]} " == *" myservices-backups.service "* ]] && echo "  Backups     : $BACKUPS_AT · journalctl -u myservices-backups.service"
[[ $REFRESH == 1 ]] && echo "  Bouton ⟳    : 127.0.0.1:$API_PORT via /myservices/api/ ($([[ $WEBSRV == none ]] && echo "votre serveur web" || echo "$WEBSRV"))"
echo "  Vérifier    : sudo python3 $DIR/setup.py --check"
