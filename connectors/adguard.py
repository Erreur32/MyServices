"""AdGuard Home : réécritures DNS et règles perso, en lecture seule, pour le contrôle DNS des hosts NPM.

Deux accès :
  SSH  {"ssh": alias, "target": conteneur | chemin de AdGuardHome.yaml}  (machine de services-meta)
       AdGuardHome.yaml (root 600) lu par docker exec, ou cat / sudo -n cat pour une installation
       native ; le YAML contient aussi les comptes : seules les deux listes en sont extraites.
  API  {"url", "user", "password"}  : AdGuard d'une box ou de Home Assistant, sans SSH. API REST
       officielle (/control, authentification basique) : /status (version), /rewrite/list,
       /filtering/status (user_rules). Vérifié sur openapi.yaml d'AdGuard Home v0.107.79.
"""
from __future__ import annotations

import base64
import shlex
import urllib.parse
import re

from connectors.base import Connector, ConnectorError, Field

CONF_IN_CONTAINER = "/opt/adguardhome/conf/AdGuardHome.yaml"


def _scalar(v: str) -> str:
    v = v.strip()
    return v[1:-1].replace("''", "'") if len(v) > 1 and v[0] == v[-1] and v[0] in "'\"" else v


def parse_yaml(text: str) -> dict:
    """{rewrites, user_rules} d'un AdGuardHome.yaml, sans bibliothèque YAML (sections lues à la main)."""
    rewrites, rules, section, base = [], [], None, 0
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if section and (indent < base or indent == base and not s.startswith("- ")):
            section = None
        m = re.match(r"(rewrites|user_rules):\s*(\[\])?$", s)
        if m:
            section, base = (None if m.group(2) else m.group(1)), indent
            continue
        if section == "user_rules" and s.startswith("- "):
            rules.append(_scalar(s[2:]))
        elif section == "rewrites":
            if s.startswith("- "):
                rewrites.append({})
                s = s[2:]
            k, _, v = s.partition(":")
            if rewrites:
                rewrites[-1][k.strip()] = _scalar(v)
    return normalize(rewrites, rules)


def normalize(rewrites: list, rules: list) -> dict:
    """Même forme quel que soit l'accès : domaines en minuscules, enabled booléen, commentaires retirés."""
    def on(v) -> bool:
        return v not in (False, "false")
    return {"rewrites": [{"domain": str(x.get("domain", "")).lower(), "answer": str(x.get("answer", "")),
                          "enabled": on(x.get("enabled", True))} for x in rewrites],
            "user_rules": [x for x in rules if x and not x.startswith("!")]}


class AdGuard(Connector):
    type = "adguard"
    label = "AdGuard Home"
    kinds = ("dns",)
    images = ("adguard/adguardhome",)
    tested = ("v0.107",)
    fields = (
        Field("url", "Adresse de l'interface d'AdGuard Home", "url", help="ex. http://192.168.1.1:3000"),
        Field("user", "Compte AdGuard Home"),
        Field("password", "Mot de passe", "password", secret=True),
        Field("ssh", "Machine d'AdGuard Home (accès SSH)", help="MyServices s'y connecte avec sa clé"),
        Field("target", "Conteneur, ou chemin de AdGuardHome.yaml", help="ex. adguardhome, ou /opt/AdGuardHome/AdGuardHome.yaml"),
        Field("ip", "IP du serveur DNS", help="interrogée pour le contrôle DNS ; déduite de l'adresse si vide"),
    )
    # Two ways to read it: the page shows only the fields of the one chosen (same rule as mode_of)
    modes = (
        {"id": "direct", "label": "API d'AdGuard Home", "fields": ["url", "user", "password", "ip"], "required": ["url", "user", "password"],
         "help": "MyServices lit l'API d'AdGuard Home (compte de l'interface web), en lecture seule : réécritures DNS et règles perso. Sans SSH."},
        {"id": "ssh", "label": "Par SSH", "fields": ["ssh", "target", "ip"], "required": ["ssh", "target", "ip"],
         "help": "MyServices lit AdGuardHome.yaml sur la machine (docker exec, ou le fichier d'une installation native), sans compte AdGuard. "
                 "Une machine suivie dans Réglages → Machines peut aussi le déclarer elle-même (champ « conteneur AdGuard »)."},
    )
    setup_fields = ("url", "user", "password")

    def __init__(self, conf: dict, ctx):
        if not conf.get("ip") and conf.get("url"):   # the DNS server is usually the interface's own address
            host = urllib.parse.urlsplit(str(conf["url"])).hostname
            conf = {**conf, "ip": host} if host else conf
        super().__init__(conf, ctx)

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        missing = super().validate(conf)
        if not ((conf.get("ssh") and conf.get("target")) or (conf.get("url") and conf.get("user") and conf.get("password"))):
            missing.append("« ssh » + « target », ou « url » + « user » + « password » requis")
        if not conf.get("ip") and not (conf.get("url") and urllib.parse.urlsplit(str(conf["url"])).hostname):
            missing.append("« IP du serveur DNS » requise")
        return missing

    def _api(self, path: str) -> object:
        auth = base64.b64encode(f"{self.conf['user']}:{self.conf['password']}".encode()).decode()
        return self.ctx.http(self.conf["url"].rstrip("/") + "/control/" + path, headers={"Authorization": f"Basic {auth}"})

    def version(self) -> str | None:
        if not self.conf.get("url"):
            # SSH: not in AdGuardHome.yaml; a container says it in its image label (docker inspect, read only), an install on the host does not
            t = str(self.conf.get("target") or "")
            if t.startswith("/") or not t:
                return None
            try:
                v = self.ctx.ssh(self.conf["ssh"], f"docker inspect -f '{{{{index .Config.Labels \"org.opencontainers.image.version\"}}}}' {shlex.quote(t)}", timeout=15).strip()
            except ConnectorError:
                return None
            return v.lstrip("v") if v and v != "<no value>" else None
        return (self._api("status") or {}).get("version")

    def collect(self) -> dict:
        if self.conf.get("url"):
            rewrites = self._api("rewrite/list")
            rules = (self._api("filtering/status") or {}).get("user_rules") or []
            if not isinstance(rewrites, list):
                raise ConnectorError("réponse inattendue de /control/rewrite/list")
            return normalize(rewrites, rules)
        t = self.conf["target"]
        sh = (f"cat {t} 2>/dev/null || sudo -n cat {t}" if t.startswith("/")
              else f"docker exec {t} cat {CONF_IN_CONTAINER}")
        return parse_yaml(self.ctx.ssh(self.conf["ssh"], sh, timeout=20))

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c in (3000, 80)), None)
        return {"url": f"http://{ip}:{web}", "ip": ip} if web else {"ip": ip}
