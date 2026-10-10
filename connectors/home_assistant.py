"""Home Assistant par son API REST (adresse + jeton d'accès longue durée), en lecture seule.

Rien d'autre que des GET : /api/config (version, nom du lieu, état), /api/states (entités : nombre, mises à jour
disponibles = entités update.* à l'état « on »). Aucun appel de service, aucun SSH.

Un jeton Home Assistant a les droits de son compte, il n'est pas « lecture seule » : le guide recommande un compte
dédié non administrateur. Les sauvegardes lues dans les mêmes données sont l'affaire du module backups.py
(connectors/backup_apis.py, fichier de secrets), pas de ce connecteur.
"""
from __future__ import annotations

import errno
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import Connector, ConnectorError, Field, Result

GUIDE = (
    "Créer un compte dédié : Paramètres → Personnes → onglet Utilisateurs → Ajouter un utilisateur (nom « myservices », "
    "sans les droits d'administrateur).",
    "Se connecter avec ce compte, ouvrir son profil (en bas à gauche), onglet Sécurité.",
    "« Jetons d'accès longue durée » → Créer un jeton (nom « MyServices »), puis le copier : il ne s'affiche qu'une fois.",
    "Coller le jeton ici. L'adresse est celle de Home Assistant, avec son port (8123 par défaut).",
)


def explain(e: Exception) -> str:
    """Cause lisible d'un échec de lecture, avec ce qu'il faut corriger. Jamais le jeton."""
    if isinstance(e, urllib.error.HTTPError):
        if e.code == 401:
            return "jeton refusé (401) : le copier de nouveau ; un jeton supprimé ou d'un autre Home Assistant ne marche pas"
        if e.code == 400:
            return "requête refusée (400) : Home Assistant refuse peut-être cette adresse (réglage http: use_x_forwarded_for / trusted_proxies)"
        if e.code == 404:
            return "adresse incorrecte (404) : ce n'est pas l'API de Home Assistant ; vérifier l'adresse et le port (8123)"
        return f"Home Assistant répond HTTP {e.code}"
    reason = getattr(e, "reason", e)
    if isinstance(reason, ssl.SSLError):
        return "certificat non reconnu : utiliser http:// sur le réseau local, ou un certificat reconnu (Let's Encrypt, autorité de l'entreprise)"
    if getattr(reason, "errno", None) in (errno.EHOSTUNREACH, errno.ENETUNREACH, errno.EHOSTDOWN):
        return "machine injoignable : adresse fausse ou Home Assistant éteint"
    if isinstance(reason, (ConnectionRefusedError,)):
        return "connexion refusée : Home Assistant n'écoute pas sur ce port ; vérifier l'adresse et le port (8123), et http / https"
    if isinstance(reason, TimeoutError) or "timed out" in str(reason):
        return "pas de réponse : Home Assistant est éteint ou l'adresse est fausse"
    if isinstance(e, ValueError):
        return "réponse inattendue : l'adresse ne mène pas à Home Assistant"
    return f"{reason}"[:160]


class HomeAssistantAPI(Connector):
    type = "home-assistant"
    label = "Home Assistant"
    kinds = ("status",)
    images = ("homeassistant/home-assistant", "ghcr.io/home-assistant/home-assistant")
    tested = ("2025", "2026")
    guide = GUIDE
    fields = (
        Field("url", "Adresse de Home Assistant", "url", required=True, help="http://<IP>:8123"),
        Field("token", "Jeton d'accès longue durée", "password", required=True, secret=True,
              help="créé dans le profil d'un compte dédié non administrateur (voir l'aide)"),
    )
    setup_fields = ("url", "token")

    def _get(self, path: str, timeout: float = 15):
        base = str(self.conf.get("url", "")).rstrip("/")
        if urllib.parse.urlsplit(base).scheme not in ("http", "https"):
            raise ConnectorError("adresse : http://<IP>:8123 attendu")
        req = urllib.request.Request(base + path, headers={"Authorization": "Bearer " + str(self.conf.get("token", ""))})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # certificat vérifié (https) : jamais désactivé
                return json.load(r)
        except (OSError, ValueError) as e:  # HTTPError, URLError, délai, JSON invalide
            raise ConnectorError(explain(e)) from None

    def version(self) -> str | None:
        v = self._get("/api/config").get("version")
        return str(v) if v else None

    def collect(self) -> dict:
        cfg = self._get("/api/config")
        states = self._get("/api/states")
        if not isinstance(states, list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Home Assistant")
        updates = [{"name": (s.get("attributes") or {}).get("friendly_name") or s["entity_id"],
                    "installed": (s.get("attributes") or {}).get("installed_version"),
                    "latest": (s.get("attributes") or {}).get("latest_version")}
                   for s in states if str(s.get("entity_id", "")).startswith("update.") and s.get("state") == "on"]
        return {"version": cfg.get("version"), "name": cfg.get("location_name"), "state": cfg.get("state"),
                "entities": len(states), "updates": sorted(updates, key=lambda u: u["name"].lower())}

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        n = len(d["updates"])
        return Result(True, f"{d['name'] or 'Home Assistant'} · {d['entities']} entités · "
                            + (f"{n} mise(s) à jour disponible(s)" if n else "à jour"), d["version"])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c == 8123), 8123)
        return {"url": f"http://{ip}:{web}"}
