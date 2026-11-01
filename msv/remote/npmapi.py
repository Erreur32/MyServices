"""Lecture des instances Nginx Proxy Manager, en LECTURE SEULE (GET uniquement, après connexion).

Une instance = une entrée de config.json « npm », sous l'une de ces formes :
  {"name": "lan", "url": "http://192.168.1.10:81", "user": "admin@x", "password": "..."}
      API jointe en direct depuis le collecteur ;
  {"name": "vps", "ssh": "vps", "url": "http://127.0.0.1:81", "user": "...", "password": "..."}
      API jointe par curl sur la machine distante (alias ~/.ssh/config), pour un port d'admin non
      exposé ; mot de passe et jeton passent par stdin, jamais sur une ligne de commande ;
  {"name": "lan", "api": "/opt/npm-api/npm-api.sh"}
      via npm-api.sh (--json), configuré par son npm-api.conf ; avec "ssh" en plus, le script est lancé sur cette machine
      (cas du conteneur Docker : le script est installé sur la machine, pas dans l'image).
« ip » (facultatif) : IP à laquelle les noms de cette instance doivent résoudre en LAN (contrôle
DNS) ; déduite sinon de l'URL, de la machine SSH ou du NGINX_IP de npm-api.conf.
L'ancienne clé npm_api (chemin de npm-api.sh) vaut une instance « api » nommée NPM.
"""
from __future__ import annotations

import json
import re
import shlex
import socket
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from msv.remote.sshmux import SSH_MUX, ssh_run

# Clé de résultat -> (point d'API, option npm-api.sh)
LISTS = {
    "hosts": ("nginx/proxy-hosts", "--host-list"),
    "redirects": ("nginx/redirection-hosts", "--redirect-host-list"),
    "dead": ("nginx/dead-hosts", "--dead-host-list"),
    "streams": ("nginx/streams", "--stream-host-list"),
    "acls": ("nginx/access-lists", "--access-list"),
}
TIMEOUT = 30
SSH_BATCH = "BatchMode=yes"   # ssh options of every call to a remote NPM
SSH_CONNECT_TIMEOUT = "ConnectTimeout=5"


class NPMError(Exception):
    pass


def instances(cfg: dict) -> list[dict]:
    """Instances déclarées (config « npm », ou ancienne clé npm_api), chacune avec un nom unique."""
    out = [dict(i) for i in cfg.get("npm") or []]
    if not out and cfg.get("npm_api"):
        out = [{"name": "NPM", "api": cfg["npm_api"]}]
    names = [i.get("name") for i in out]
    if any(not n for n in names) or len(set(names)) != len(names):
        raise NPMError("config.json npm : chaque instance doit avoir un « name » unique")
    for i in out:
        if not (i.get("api") or i.get("agent") or (i.get("url") and i.get("user") and i.get("password"))):
            raise NPMError(f"instance NPM {i['name']} : « api », ou « url » + « user » + « password » requis")
    return out


def _resolve(host: str | None) -> str | None:
    try:
        return socket.gethostbyname(host) if host else None
    except OSError:
        return None


def instance_ip(inst: dict, machines: dict) -> str | None:
    """IP de l'instance vue du LAN. machines : {ip: (nom, rôle, alias ssh)} de services-meta.
    Adresse de boucle locale (NPM sur la collectrice, NGINX_IP="127.0.0.1" par défaut de npm-api.sh) :
    remplacée par l'IP de la machine "local", sinon deux déclarations du même NPM ne se reconnaissent
    pas et le contrôle DNS attendrait 127.0.0.1."""
    ip = _instance_ip(inst, machines)
    if ip and ip.startswith("127."):
        return next((m_ip for m_ip, m in machines.items() if m[2] == "local"), ip)
    return ip


def _instance_ip(inst: dict, machines: dict) -> str | None:
    if inst.get("ip") or inst.get("agent"):
        return inst.get("ip") or inst["agent"]
    if inst.get("ssh"):
        return next((ip for ip, m in machines.items() if m[2] == inst["ssh"]), None)
    if inst.get("api"):
        try:
            conf = (Path(inst["api"]).parent / "npm-api.conf").read_text(encoding="utf-8")
        except OSError:
            return None
        for line in conf.splitlines():
            k, _, v = line.partition("=")
            if k.strip() == "NGINX_IP":
                return _resolve(v.strip().strip("\"'"))
        return "127.0.0.1"  # NGINX_IP absent : défaut de npm-api.sh
    return _resolve(urllib.parse.urlsplit(inst["url"]).hostname)


def _request(inst: dict, path: str, body: dict | None = None, token: str | None = None):
    """POST JSON (body) ou GET avec jeton ; directement ou par curl sur la machine SSH."""
    url = inst["url"].rstrip("/") + "/api/" + path
    what = f"NPM {inst['name']} ({url}{' via ssh ' + inst['ssh'] if inst.get('ssh') else ''})"
    if inst.get("ssh"):
        # stdin = corps JSON (connexion) ou en-tête Authorization (lecture) : rien de secret dans ps
        stdin = json.dumps(body) if body is not None else f"Authorization: Bearer {token}\n"
        curl = ["curl", "-sS", "--fail-with-body", "--max-time", str(TIMEOUT), "-H", "Content-Type: application/json"]
        curl += ["--data-binary", "@-", url] if body is not None else ["-H", "@-", url]
        try:
            r = ssh_run("npm", inst["ssh"], ["ssh", *SSH_MUX, "-o", SSH_BATCH, "-o", SSH_CONNECT_TIMEOUT, inst["ssh"], shlex.join(curl)],
                               input=stdin, capture_output=True, text=True, timeout=TIMEOUT + 10)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise NPMError(f"{what} : {e}") from e
        if r.returncode != 0:
            raise NPMError(f"{what} : {(r.stderr.strip() or r.stdout.strip() or 'code ' + str(r.returncode))[-300:]}")
        raw = r.stdout
    else:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(url, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as e:
            raise NPMError(f"{what} : HTTP {e.code} {e.read().decode(errors='replace')[:200]}") from e
        except (OSError, ValueError) as e:
            raise NPMError(f"{what} : {e}") from e
    try:
        return json.loads(raw)
    except ValueError as e:
        raise NPMError(f"{what} : réponse non JSON : {raw[:200]}") from e


def _script(path: str, opt: str, ssh: str | None = None):
    cmd = f"npm-api.sh {opt}" + (f" (via ssh {ssh})" if ssh else "")
    argv = [path, "--json", opt] if not ssh else ["ssh", *SSH_MUX, "-o", SSH_BATCH, "-o", SSH_CONNECT_TIMEOUT, ssh, shlex.join([path, "--json", opt])]
    try:
        r = ssh_run("npm", str(ssh), argv, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise NPMError(f"{cmd} : {e}") from e
    try:
        return json.loads(r.stdout)
    except ValueError as e:
        err = (r.stderr.strip() or r.stdout.strip() or "sortie vide")[-500:]
        raise NPMError(f"{cmd} a échoué (code {r.returncode}) : {err}") from e


def _from_agent(inst: dict) -> dict[str, list]:
    """The lists the machine's agent sent in its last report (npm-api.sh run there, MSV_NPM): no account of NPM here, no SSH."""
    from msv.core.config import CFG, db_path
    from msv.machines.agent_reports import fresh_reports
    rep = fresh_reports(db_path(CFG)).get(inst["agent"]) or {}
    if not rep.get("fresh"):
        raise NPMError(f"NPM {inst['name']} : pas de relevé récent de l'agent de {inst['agent']}")
    cmds = (((rep.get("report") or {}).get("data") or {}).get("cmds")) or {}
    out = {}
    for key, (_, opt) in LISTS.items():
        rc, text = (cmds.get(f"npm {opt}") or [None, ""])[:2]
        if rc is None:
            raise NPMError(f"NPM {inst['name']} : l'agent n'envoie pas NPM (installation avec MSV_NPM à faire)")
        if rc != 0:
            raise NPMError(f"NPM {inst['name']} : {text[-200:]}")
        try:
            out[key] = json.loads(text)
        except ValueError as e:
            raise NPMError(f"NPM {inst['name']} {key} : réponse de l'agent illisible") from e
    return out


def fetch(inst: dict) -> dict[str, list]:
    """{hosts, redirects, dead, streams, acls} bruts de l'API NPM ; NPMError si une lecture échoue."""
    if inst.get("agent"):
        out = _from_agent(inst)
    elif inst.get("api"):
        out = {k: _script(inst["api"], opt, inst.get("ssh")) for k, (_, opt) in LISTS.items()}
    else:
        token = _request(inst, "tokens", body={"identity": inst["user"], "secret": inst["password"]}).get("token")
        if not token:
            raise NPMError(f"NPM {inst['name']} : connexion refusée (identifiants ?)")
        out = {k: _request(inst, ep, token=token) for k, (ep, _) in LISTS.items()}
    for k, v in out.items():
        if not isinstance(v, list):  # {"error": {...}} renvoyé avec un code 200
            raise NPMError(f"NPM {inst['name']} {k} : {json.dumps(v)[:200]}")
    return out


# ───────────── npm-api.sh : vérification du chemin et installation sur une machine ─────────────

# Version figée du script (dépôt Erreur32/nginx-proxy-manager-Bash-API, tag v3.6.9) : on ne télécharge jamais « main »,
# et le fichier reçu est vérifié par son empreinte SHA-256 avant d'être installé.
SCRIPT_VERSION = "3.6.9"
SCRIPT_URL = f"https://raw.githubusercontent.com/Erreur32/nginx-proxy-manager-Bash-API/v{SCRIPT_VERSION}/npm-api.sh"
SCRIPT_SHA256 = "7502d867c2db0b606a360c2e790b5cf4c3be16f5ad8deb2b0ff4fa686322f964"
_DIR_RE = re.compile(r"^[A-Za-z0-9._/~-]{1,120}$")
_USER_RE = re.compile(r"^[^\s'\"\\$`]{1,120}$")


def _run_remote(ssh: str | None, script: str, stdin: str | None = None, timeout: int = 60) -> tuple[int, str]:
    """Exécute un petit script sh sur la machine (SSH, sans mot de passe demandé) ou ici ; (code, sortie). Les secrets passent par stdin."""
    argv = ["sh", "-c", script] if not ssh else ["ssh", *SSH_MUX, "-o", SSH_BATCH, "-o", SSH_CONNECT_TIMEOUT, ssh, shlex.join(["sh", "-c", script])]
    try:
        r = ssh_run("npm", str(ssh), argv, input=stdin, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 255, f"{type(e).__name__}"
    return r.returncode, (r.stdout + ("\n" + r.stderr if r.returncode and r.stderr else "")).strip()


def check_script(path: str, ssh: str | None = None) -> list[dict]:
    """Conseils sur le chemin de npm-api.sh, vus de la machine qui l'exécutera (SSH) ou d'ici (conteneur) :
    [{"level": "ok" | "warn" | "bad", "text": …}]. Ne lance jamais le script lui-même."""
    where = f"sur {ssh}" if ssh else "dans le conteneur"
    if not path or not _DIR_RE.match(path) or not path.endswith("npm-api.sh"):
        return [{"level": "bad", "text": "chemin attendu : celui du fichier npm-api.sh (ex. /opt/npm-api/npm-api.sh)"}]
    probe = (f'P={shlex.quote(path)}; D=$(dirname "$P"); '
             'if [ -x "$P" ]; then echo EXEC; elif [ -e "$P" ]; then echo NOEXEC; else echo MISSING; fi; '
             '[ -r "$D/npm-api.conf" ] && echo CONF; '
             'command -v curl >/dev/null 2>&1 && echo CURL; command -v jq >/dev/null 2>&1 && echo JQ; '
             '[ -r "$D/npm-api.conf" ] && sed -n "s/^[[:space:]]*\\(NGINX_IP\\|NGINX_PORT\\|API_USER\\)=\\(.*\\)$/\\1=\\2/p" "$D/npm-api.conf" | head -3')
    code, out = _run_remote(ssh, probe, timeout=15)
    if code == 255 or (ssh and code != 0 and not out.startswith(("EXEC", "NOEXEC", "MISSING"))):
        return [{"level": "bad", "text": f"machine {ssh} injoignable en SSH ({out[-120:] or 'sans réponse'}) : vérifier son accès dans Réglages → Machines"}]
    lines = out.splitlines()
    tips: list[dict] = []
    if "EXEC" in lines:
        tips.append({"level": "ok", "text": f"npm-api.sh trouvé et exécutable {where} ({path})"})
    elif "NOEXEC" in lines:
        tips.append({"level": "bad", "text": f"npm-api.sh existe {where} mais n'est pas exécutable : chmod +x {path}"})
    else:
        hint = ("le conteneur ne voit que ses dossiers /config et /data : installez le script sur une machine et choisissez-la ci-dessus, ou utilisez « Installer »"
                if not ssh else "utilisez « Installer npm-api.sh sur cette machine » ci-dessous, ou corrigez le chemin")
        return [{"level": "bad", "text": f"npm-api.sh introuvable {where} ({path}) : {hint}"}]
    tips.append({"level": "ok", "text": "npm-api.conf présent à côté du script"} if "CONF" in lines
                else {"level": "warn", "text": "pas de npm-api.conf à côté du script : il prendra ses valeurs par défaut (NPM en 127.0.0.1:81, compte d'exemple), ce qui ne marchera pas"})
    for name, key in (("curl", "CURL"), ("jq", "JQ")):
        tips.append({"level": "ok", "text": f"{name} présent {where}"} if key in lines
                    else {"level": "bad", "text": f"{name} absent {where} : le script en a besoin (apt install {name})"})
    seen = {l.split("=", 1)[0]: l.split("=", 1)[1].strip().strip("\"'") for l in lines if l.startswith(("NGINX_IP=", "NGINX_PORT=", "API_USER="))}
    if seen:
        tips.append({"level": "ok", "text": "configuration lue : NPM " + f"{seen.get('NGINX_IP', '?')}:{seen.get('NGINX_PORT', '81')}" + (f", compte {seen['API_USER']}" if seen.get("API_USER") else "")})
    return tips


_INSTALL = r"""set -e
IFS= read -r DIR
case "$DIR" in /*) ;; "~"/*) DIR="$HOME/${DIR#"~"/}" ;; *) DIR="$HOME/$DIR" ;; esac
mkdir -p "$DIR"
have() { command -v "$1" >/dev/null 2>&1; }
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
if have curl; then curl -fsSL --max-time 40 "$URL" -o "$TMP" </dev/null; elif have wget; then wget -q -T 40 -O "$TMP" "$URL" </dev/null; else echo "ERR ni curl ni wget sur la machine"; exit 2; fi
echo "$SHA  $TMP" | sha256sum -c - >/dev/null 2>&1 || { echo "ERR empreinte du script téléchargé différente de celle attendue : rien n'est installé"; exit 3; }
if have install; then install -m 755 "$TMP" "$DIR/npm-api.sh"; else cp "$TMP" "$DIR/npm-api.sh"; chmod 755 "$DIR/npm-api.sh"; fi
echo "OK $DIR/npm-api.sh"
if [ -e "$DIR/npm-api.conf" ]; then
  echo "KEEP npm-api.conf existant conservé"
else
  ( umask 077; cat > "$DIR/npm-api.conf" )
  chmod 600 "$DIR/npm-api.conf"
  echo "OK $DIR/npm-api.conf"
fi
have curl || echo "WARN curl absent"
have jq || echo "WARN jq absent"
"""


def _q(v: str) -> str:
    return "'" + v.replace("'", "'\\''") + "'"


def conf_text(ip: str, port: int, user: str, password: str) -> str:
    """Contenu de npm-api.conf, même présentation que le modèle du dépôt de npm-api.sh. Le script le lit avec `source` : les valeurs sont
    entre apostrophes (aucun $, guillemet ou accent grave du mot de passe n'est interprété)."""
    return ("# npm-api.conf (written by MyServices, mode 600)\n\n"
            "## Nginx Proxy Manager IP address and port\n"
            f"NGINX_IP={_q(ip)}\nNGINX_PORT={_q(str(port))}\n\n"
            "## Existing NPM user\n"
            f"API_USER={_q(user)}\nAPI_PASS={_q(password)}\n\n"
            "# Optional: data directory other than the script directory\n"
            "# DATA_DIR=\"/path/nginx_backup\"\n")


def install_script(ssh: str | None, directory: str, ip: str, port: int, user: str, password: str) -> dict:
    """Installe npm-api.sh (version figée, empreinte vérifiée) dans `directory` de la machine `ssh` et y écrit npm-api.conf (600) avec le
    compte NPM donné, SAUF si un npm-api.conf existe déjà (conservé). Le mot de passe passe par stdin : jamais dans une ligne de commande.
    Rend {"ok", "path" (chemin absolu), "lines"}."""
    if not _DIR_RE.match(directory or ""):
        raise NPMError("dossier : lettres, chiffres, . _ - / ~ seulement")
    if not re.match(r"^[A-Za-z0-9._-]{1,120}$", ip or ""):
        raise NPMError("adresse de NPM : une IP ou un nom, sans espace")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise NPMError("port de NPM invalide")
    if not _USER_RE.match(user or ""):
        raise NPMError("compte NPM : sans espace ni guillemet")
    if not password or "\n" in password or "\r" in password or len(password) > 200:
        raise NPMError("mot de passe NPM : une ligne, 200 caractères au plus")
    conf = conf_text(ip, port, user, password)
    script = f"URL={shlex.quote(SCRIPT_URL)}; SHA={SCRIPT_SHA256}; " + _INSTALL
    code, out = _run_remote(ssh, script, stdin=directory + "\n" + conf, timeout=90)
    lines = [l for l in out.splitlines() if l.strip()]
    if code != 0:
        err = next((l[4:] for l in lines if l.startswith("ERR ")), None) or (lines[-1] if lines else f"code {code}")
        raise NPMError(f"installation impossible : {err[:200]}")
    path = next((l[3:].strip() for l in lines if l.startswith("OK ") and l.endswith("npm-api.sh")), "")
    msgs = []
    for l in lines:
        if l.startswith("OK "):
            msgs.append(f"✓ {l[3:]}")
        elif l.startswith("KEEP "):
            msgs.append(f"= {l[5:]}")
        elif l.startswith("WARN "):
            msgs.append(f"⚠ {l[5:]} (apt install curl jq)")
    return {"ok": True, "path": path, "lines": msgs, "version": SCRIPT_VERSION}
