"""Dockhand : gestionnaire Docker (environnements, conteneurs, mises à jour d'images en attente), en lecture seule, par son API REST.

Jeton d'API « dh_… » (Profil → API tokens) en en-tête Authorization: Bearer ; sans jeton si l'authentification de Dockhand est coupée.
Routes lues (GET seulement), d'après l'intégration Home Assistant de Dockhand (raetha/ha-dockhand) :
  GET /api/host                                   test d'accès (passe par l'authentification, contrairement à /health)
  GET /api/environments                           environnements Docker (local, agents Hawser…)
  GET /api/dashboard/stats                        compteurs par environnement (conteneurs, piles, images, volumes…)
  GET /api/containers/pending-updates?env=<id>    conteneurs dont l'image a une mise à jour
  GET /api/changelog                              journal des versions, intégré au build : la 1re entrée est la version qui tourne
L'API de Dockhand n'est pas figée : lecture tolérante champ par champ.
"""
from __future__ import annotations

import urllib.parse

from connectors.base import Connector, ConnectorError, Field, Result


def _list(v) -> list:
    if isinstance(v, dict):
        for k in ("environments", "items", "result", "data"):
            if isinstance(v.get(k), list):
                return v[k]
    return v if isinstance(v, list) else []


class Dockhand(Connector):
    type = "dockhand"
    label = "Dockhand"
    kinds = ("containers",)
    images = ("fnsys/dockhand", "finsys/dockhand")
    tested = ()
    fields = (
        Field("url", "URL de Dockhand", "url", required=True, help="ex. http://192.168.1.10:3000"),
        Field("token", "Jeton d'API (dh_…), vide si l'authentification est coupée", "password", secret=True,
              help="Dockhand → Profil → API tokens."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True),
    )
    setup_fields = ("url", "token")
    guide = (
        "Dans Dockhand : Profil → API tokens → créer un jeton nommé « MyServices ».",
        "Copier le jeton (dh_…) tout de suite. Sans authentification activée dans Dockhand, laisser le champ vide.",
    )

    def version(self) -> str | None:
        """No version route: the changelog is bundled with each build, its first entry is the running version."""
        try:
            log = self._get("/api/changelog")
        except ConnectorError:
            return None
        first = log[0] if isinstance(log, list) and log and isinstance(log[0], dict) else {}
        v = first.get("version")
        return str(v).lstrip("v") if v else None

    def _get(self, path: str):
        h = {"Authorization": f"Bearer {self.conf['token']}"} if self.conf.get("token") else {}
        try:
            return self.ctx.http(self.conf["url"].rstrip("/") + path, headers=h, verify_tls=self.conf.get("verify_tls", True) is not False)
        except ConnectorError as e:
            if str(e).startswith("HTTP 401"):
                raise ConnectorError("jeton refusé (jeton dh_… ?)") from None
            raise

    def collect(self) -> dict:
        self._get("/api/host")
        envs = _list(self._get("/api/environments"))
        stats = {str(s.get("id")): s for s in _list(self._get("/api/dashboard/stats")) if isinstance(s, dict)}
        out = []
        for e in envs:
            if not isinstance(e, dict) or e.get("id") is None:
                continue
            s = stats.get(str(e["id"]), {})
            c = s.get("containers") if isinstance(s.get("containers"), dict) else {}
            try:
                pend = _list(self._get(f"/api/containers/pending-updates?env={urllib.parse.quote(str(e['id']), safe='')}"))
            except ConnectorError:
                pend = []  # environnement hors ligne ou sans vérification de mises à jour
            out.append({"id": e["id"], "name": e.get("name"), "host": e.get("host"), "agent": e.get("hawserAgentName") or None,
                        "containers": {k: c.get(k) for k in ("total", "running", "stopped", "paused", "unhealthy") if isinstance(c.get(k), int)},
                        "updates": [{"container": p.get("containerName") or p.get("name"), "image": p.get("image"),
                                     "newer": p.get("newerVersion")} for p in pend if isinstance(p, dict) and p.get("hasUpdate", True)]})
        return {"environments": out, "updates": sum(len(e["updates"]) for e in out)}

    def test(self) -> Result:
        try:
            data = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        n = data["updates"]
        return Result(True, f"{len(data['environments'])} environnement(s)" + (f", {n} mise(s) à jour d'image" if n else ""))

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 3000), None)
        return {"url": f"http://{ip}:{web}"} if web else None
