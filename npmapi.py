"""Lecture des instances Nginx Proxy Manager, en LECTURE SEULE (GET uniquement, après connexion).

Une instance = une entrée de config.json « npm », sous l'une de ces formes :
  {"name": "lan", "url": "http://192.168.1.10:81", "user": "admin@x", "password": "..."}
      API jointe en direct depuis le collecteur ;
  {"name": "vps", "ssh": "vps", "url": "http://127.0.0.1:81", "user": "...", "password": "..."}
      API jointe par curl sur la machine distante (alias ~/.ssh/config), pour un port d'admin non
      exposé ; mot de passe et jeton passent par stdin, jamais sur une ligne de commande ;
  {"name": "lan", "api": "/opt/npm-api/npm-api.sh"}
      via npm-api.sh (--json), configuré par son npm-api.conf.
« ip » (facultatif) : IP à laquelle les noms de cette instance doivent résoudre en LAN (contrôle
DNS) ; déduite sinon de l'URL, de la machine SSH ou du NGINX_IP de npm-api.conf.
L'ancienne clé npm_api (chemin de npm-api.sh) vaut une instance « api » nommée NPM.
"""
from __future__ import annotations

import json
import shlex
import socket
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Clé de résultat -> (point d'API, option npm-api.sh)
LISTS = {
    "hosts": ("nginx/proxy-hosts", "--host-list"),
    "redirects": ("nginx/redirection-hosts", "--redirect-host-list"),
    "dead": ("nginx/dead-hosts", "--dead-host-list"),
    "streams": ("nginx/streams", "--stream-host-list"),
    "acls": ("nginx/access-lists", "--access-list"),
}
TIMEOUT = 30


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
        if not (i.get("api") or (i.get("url") and i.get("user") and i.get("password"))):
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
    if inst.get("ip"):
        return inst["ip"]
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
            r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", inst["ssh"], shlex.join(curl)],
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


def _script(path: str, opt: str):
    cmd = f"npm-api.sh {opt}"
    try:
        r = subprocess.run([path, "--json", opt], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise NPMError(f"{cmd} : {e}") from e
    try:
        return json.loads(r.stdout)
    except ValueError as e:
        err = (r.stderr.strip() or r.stdout.strip() or "sortie vide")[-500:]
        raise NPMError(f"{cmd} a échoué (code {r.returncode}) : {err}") from e


def fetch(inst: dict) -> dict[str, list]:
    """{hosts, redirects, dead, streams, acls} bruts de l'API NPM ; NPMError si une lecture échoue."""
    if inst.get("api"):
        out = {k: _script(inst["api"], opt) for k, (_, opt) in LISTS.items()}
    else:
        token = _request(inst, "tokens", body={"identity": inst["user"], "secret": inst["password"]}).get("token")
        if not token:
            raise NPMError(f"NPM {inst['name']} : connexion refusée (identifiants ?)")
        out = {k: _request(inst, ep, token=token) for k, (ep, _) in LISTS.items()}
    for k, v in out.items():
        if not isinstance(v, list):  # {"error": {...}} renvoyé avec un code 200
            raise NPMError(f"NPM {inst['name']} {k} : {json.dumps(v)[:200]}")
    return out
