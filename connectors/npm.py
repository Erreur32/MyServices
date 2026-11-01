"""Nginx Proxy Manager : proxy hosts, redirections, hôtes morts, streams et listes d'accès (lecture seule).

Lecture déléguée à npmapi.py (API directe, curl par SSH pour un admin non exposé, ou npm-api.sh) : même
résultat que la version d'avant les connecteurs. Version : GET /api/ (sans authentification).
"""
from __future__ import annotations

from msv.remote import npmapi
from connectors.base import Connector, ConnectorError, Field, Result


class NPM(Connector):
    type = "npm"
    label = "Nginx Proxy Manager"
    kinds = ("services",)
    images = ("jc21/nginx-proxy-manager",)
    tested = ("2.12", "2.13", "2.14", "2.15", "2.16")
    fields = (
        Field("url", "URL de l'admin de NPM", "url", help="ex. http://192.168.1.10:81"),
        Field("user", "Compte NPM (e-mail)"),
        Field("password", "Mot de passe NPM", "password", secret=True),
        Field("ssh", "Machine de NPM (accès SSH)", help="MyServices s'y connecte avec sa clé"),
        Field("ip", "IP de ce NPM vue du LAN", help="pour le contrôle DNS ; déduite de l'URL ou de la machine si vide"),
        Field("api", "Chemin de npm-api.sh sur cette machine", help="ex. /home/vous/npm-api/npm-api.sh"),
        Field("agent", "IP de la machine de NPM (celle de son agent)", help="agent installé avec MSV_NPM=<chemin de npm-api.sh> ou MSV_NPM=install"),
    )
    # Trois façons de lire NPM : la page ne montre que les champs utiles à celle choisie, et marque ceux qui sont requis
    modes = (
        {"id": "direct", "label": "API directe", "fields": ["url", "user", "password", "ip"], "required": ["url", "user", "password"],
         "help": "MyServices joint l'admin de NPM (port 81) depuis le conteneur, avec le compte NPM. Le plus simple si ce port est joignable."},
        {"id": "ssh", "label": "API par SSH", "fields": ["ssh", "url", "user", "password", "ip"], "required": ["ssh", "url", "user", "password"],
         "help": "Le port 81 de NPM n'est pas joignable depuis le conteneur : MyServices lance curl sur la machine de NPM (URL vue de cette machine, "
                 "souvent http://127.0.0.1:81)."},
        {"id": "script", "label": "Script npm-api.sh", "fields": ["ssh", "api", "ip"], "required": ["api"],
         "help": "MyServices lance npm-api.sh (--json) sur la machine où il est installé (le script et son npm-api.conf gardent le compte NPM). "
                 "Le conteneur n'a pas ce script : choisissez la machine, ou installez-le d'ici."},
        {"id": "agent", "label": "Par l'agent de la machine", "fields": ["agent", "ip"], "required": ["agent"],
         "help": "L'agent de la machine lance npm-api.sh et envoie les listes dans son relevé : ni SSH, ni compte NPM dans MyServices. "
                 "Installez l'agent avec MSV_NPM=<chemin de npm-api.sh> après « sudo env », ou MSV_NPM=install pour que l'installation pose le script."},
    )
    setup_fields = ("url", "user", "password")

    @staticmethod
    def mode_of(conf: dict) -> str:
        for key, mode in (("agent", "agent"), ("api", "script"), ("ssh", "ssh")):
            if conf.get(key):
                return mode
        return "direct"

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        mode = next(m for m in cls.modes if m["id"] == cls.mode_of(conf))
        labels = {f.name: f.label for f in cls.fields}
        return [f"« {labels[k]} » requis" for k in mode["required"] if not conf.get(k)]

    def version(self) -> str | None:
        if self.conf.get("api") or self.conf.get("ssh") or self.conf.get("agent"):
            return None  # npm-api.sh / admin non exposé : version non lue
        v = (self.ctx.http(self.conf["url"].rstrip("/") + "/api/", timeout=5) or {}).get("version") or {}
        return ".".join(str(v[k]) for k in ("major", "minor", "revision") if k in v) or None

    def collect(self) -> dict:
        try:
            return npmapi.fetch(self.conf)
        except npmapi.NPMError as e:
            raise ConnectorError(str(e)) from None

    def test(self) -> Result:
        try:
            got = self.collect()
            v = self.version()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{len(got['hosts'])} proxy hosts, {len(got['redirects'])} redirections, "
                            f"{len(got['streams'])} streams", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        admin = next((h for h, c in ports if c == 81), None)
        return {"url": f"http://{ip}:{admin}"} if admin else None

    def lan_ip(self, machines: dict) -> str | None:
        return npmapi.instance_ip(self.conf, machines)
