"""Dozzle : lien vers les journaux de chaque conteneur, depuis la page. Rien n'est lu dans les journaux.

Dozzle ouvre un conteneur par son nom : /show?name=<conteneur> (assets/pages/show.vue : le nom est
cherché parmi les conteneurs de tous ses hôtes et agents ; même nom sur plusieurs machines = vue
fusionnée). test() : GET /healthcheck (200 si Dozzle voit au moins un hôte Docker).
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import Connector, ConnectorError, Field, Result


class Dozzle(Connector):
    type = "dozzle"
    label = "Dozzle"
    kinds = ("logs",)
    images = ("amir20/dozzle",)
    tested = ()  # aucune API lue : seulement un lien
    fields = (Field("url", "URL de Dozzle", "url", required=True, help="ex. https://dozzle.lan, celle ouverte dans le navigateur ; "
                    "connexion Dozzle activée ou non : rien à saisir ici, on se connecte dans son navigateur en suivant le lien"),)
    setup_fields = ("url",)

    def link(self, container: str) -> str:
        return f"{self.conf['url'].rstrip('/')}/show?{urllib.parse.urlencode({'name': container})}"

    def collect(self) -> dict:
        r = self.test()
        if not r.ok:
            raise ConnectorError(r.message)
        return {"url": self.conf["url"].rstrip("/")}

    def version(self) -> str | None:
        """App version written by Dozzle in its page (<script id="config__json">: « version »)."""
        try:
            with urllib.request.urlopen(self.conf["url"].rstrip("/") + "/", timeout=self.ctx.timeout) as r:
                page = r.read(500_000).decode("utf-8", "replace")
        except (OSError, ValueError):
            return None
        m = re.search(r'id="config__json"[^>]*>(.*?)</script>', page, re.S)
        try:
            v = json.loads(m.group(1)).get("version") if m else None
        except ValueError:
            return None
        return str(v).lstrip("v") if v else None

    def test(self) -> Result:
        try:
            with urllib.request.urlopen(self.conf["url"].rstrip("/") + "/healthcheck", timeout=self.ctx.timeout) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        except (OSError, ValueError) as e:
            return Result(False, str(ConnectorError(f"injoignable ({getattr(e, 'reason', e)})")))
        if code == 200:
            return Result(True, "joignable : liens « journaux » ajoutés aux conteneurs")
        return Result(False, f"HTTP {code} sur /healthcheck (aucun hôte Docker vu par Dozzle ?)")

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 8080), None)
        return {"url": f"http://{ip}:{web}"} if web else None
