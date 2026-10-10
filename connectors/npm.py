"""Nginx Proxy Manager : proxy hosts, redirections, hôtes morts, streams et listes d'accès (lecture seule).

Lecture déléguée à npmapi.py (API directe, curl par SSH pour un admin non exposé, ou npm-api.sh) : même
résultat que la version d'avant les connecteurs. Version : GET /api/ (sans authentification).
"""
from __future__ import annotations

import npmapi
from connectors.base import Connector, ConnectorError, Field, Result


class NPM(Connector):
    type = "npm"
    label = "Nginx Proxy Manager"
    kinds = ("services",)
    images = ("jc21/nginx-proxy-manager",)
    tested = ("2.12", "2.13", "2.14", "2.15", "2.16")
    fields = (
        Field("url", "URL de l'admin", "url", help="ex. http://192.168.1.10:81"),
        Field("user", "Compte (e-mail)"),
        Field("password", "Mot de passe", "password", secret=True),
        Field("ssh", "Alias SSH (admin non exposé)", help="l'API est jointe par curl sur cette machine"),
        Field("ip", "IP de ce NPM vue du LAN", help="contrôle DNS ; déduite de l'URL sinon"),
        Field("api", "Chemin de npm-api.sh (ancien mode)"),
    )
    setup_fields = ("url", "user", "password")

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        if conf.get("api") or (conf.get("url") and conf.get("user") and conf.get("password")):
            return []
        return ["« url » + « user » + « password » requis (ou « api » : chemin de npm-api.sh)"]

    def version(self) -> str | None:
        if self.conf.get("api") or self.conf.get("ssh"):
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
