"""Liberty Global cable gateways with the LG-RDK firmware and its REST API under /rest/v1: Virgin Media Hub 5 (Sagemcom F5685LGB/LGE), Ziggo SmartWifi
(Sagemcom F3896LG/F3897LG), and the sister brands (UPC, Sunrise, Yallo...). Read-only: the login, GET pages and the logout are sent, nothing else.
Written from the liberty-global-gateway library (MIT, github.com/AboveColin/liberty-global-gateway); only the Sagemcom F3896LG of Ziggo was tested by its author on a
real box, the other models are expected to share the API. The older Compal CH7465LG (Virgin Hub 3, UPC Connect Box) is a different protocol: see connect_box.py.

Protocol, as in the library: GET /user/login (no account) tells the lockout time; POST /user/login {"password": ...} gives created.token and created.userId; every call then
carries `Authorization: Bearer <token>`; DELETE /user/<id>/token/<token> frees the single session slot (HTTP 503 "session busy" when another session holds it).
Read: system/info, cablemodem/state (status, uptime), cablemodem/serviceflows (rate caps of the plan), system/gateway/provisioning (WAN address), network/hosts, wifi/<band>/state.
Guessed, only a real box can confirm: the values of the `direction` of a service flow (matched on the words down/up), and the unit of upTime (seconds, as the library tests show).
Not given: current traffic and the firmware update (the library reads only a status word), so those fields stay None.
The box locks the login after a few wrong passwords: the lockout is read first, and a refused login is remembered in memory (address and a hash of the password, never the
password) and not repeated until the settings change.
"""
from __future__ import annotations

import hashlib

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num

API = "/rest/v1"
HOSTS_TIMEOUT = 60   # the library gives the host table a long timeout of its own: it is built on demand
BANDS = ("band2g", "band5g")
REFUSED = "mot de passe refusé par la box : vérifie-le dans son interface web (MyServices ne réessaie pas tant que les réglages ne changent pas)"
BUSY = "la box a déjà une session ouverte (une seule à la fois) : ferme son interface web puis réessaie"
LOCKED = "connexion verrouillée par la box après des erreurs de mot de passe : réessaie dans {} s"
SESSION_LOST = "la box a fermé la session : réessaie"
NOT_A_BOX = "réponse inattendue : ce n'est pas une box Liberty Global (LG-RDK)"
REFUSED_BY: dict[str, str] = {}   # address -> fingerprint of the password the box refused


def as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def flag(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    word = str(value).strip().lower() if value is not None else ""
    return True if word in ("true", "1", "yes", "up", "enabled") else False if word in ("false", "0", "no", "down", "disabled") else None


def rates(flows: object) -> tuple[int | None, int | None]:
    """(down, up) in bit/s: the highest provisioned cap of each direction; a direction not recognised is ignored."""
    best: dict[str, int] = {}
    for item in flows if isinstance(flows, list) else []:
        flow = as_dict(as_dict(item).get("serviceFlow")) or as_dict(item)
        cap, way = num(flow.get("maxTrafficRate")), str(flow.get("direction") or "").lower()
        key = "down" if "down" in way else "up" if way.startswith("up") else ""
        if key and cap and cap > best.get(key, 0):
            best[key] = int(cap)
    return best.get("down"), best.get("up")


class LibertyGateway(StatusConnector):
    type = "liberty-gateway"
    label = "Virgin Media Hub 5 / Ziggo SmartWifi"
    fields = (
        Field("url", "Adresse de la box", "url", required=True, default="https://192.168.0.1", help="L'adresse de son interface web : souvent https://192.168.0.1 (Virgin Media) ou https://192.168.178.1 (Ziggo)."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Celui de l'interface web de la box (pas de nom d'utilisateur)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="à laisser décoché : la box a un certificat auto-signé"),
    )
    guide = ("Donne l'adresse de la box (celle qui ouvre son interface web depuis le serveur) et son mot de passe : MyServices ne fait que lire.",
             "La box n'accepte qu'une session à la fois : si tu es connecté à son interface en même temps, MyServices est refusé. Après quelques erreurs de mot de passe, elle verrouille la connexion un moment ; MyServices ne réessaie pas.",
             "Pour les Virgin Media Hub 5, Ziggo SmartWifi et les box du même firmware. La Hub 3 (Compal) se branche avec « Connect Box ».",
             "La box ne donne pas ici le débit en cours ni l'état des mises à jour.")

    def fingerprint(self) -> str:
        return hashlib.sha256(str(self.conf.get("password", "")).encode()).hexdigest()

    def call(self, path: str, token: str = "", method: str = "GET", body: dict | None = None, timeout: float | None = None) -> object:
        headers = {"Authorization": f"Bearer {token}"} if token else None
        try:
            return self.ctx.http(self.base_url() + API + path, method=method, body=body, headers=headers, verify_tls=self.tls(), timeout=timeout)
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith("HTTP 401") and token:
                raise ConnectorError(SESSION_LOST) from None
            raise

    def login(self, base: str) -> tuple[str, object]:
        """(token, user id); the lockout is read first, so a locked box is not tried again."""
        details = as_dict(as_dict(self.call("/user/login")).get("loginDetails"))
        wait = num(details.get("lockoutTime"), 0)
        if wait and wait > 0:
            raise ConnectorError(LOCKED.format(int(wait)))
        try:
            answer = as_dict(self.call("/user/login", method="POST", body={"password": str(self.conf.get("password", ""))}))
        except ConnectorError as e:
            if str(e).startswith("HTTP 503"):
                raise ConnectorError(BUSY) from None
            if str(e).startswith(("HTTP 4", "HTTP 5")):
                REFUSED_BY[base] = self.fingerprint()
                raise ConnectorError(REFUSED) from None
            raise
        created = as_dict(answer.get("created"))
        if not created.get("token"):
            raise ConnectorError(NOT_A_BOX)
        return str(created["token"]), created.get("userId")

    def optional(self, path: str, token: str, timeout: float | None = None) -> dict:
        """A page that some models lack: {} when missing; an expired session or a rate limit still raise."""
        try:
            return as_dict(self.call(path, token, timeout=timeout))
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e) == SESSION_LOST:
                raise
            return {}

    def read(self, token: str) -> Box:
        info = as_dict(self.optional("/system/info", token).get("info"))
        modem = as_dict(self.optional("/cablemodem/state", token).get("cablemodem"))
        wan = as_dict(self.optional("/system/gateway/provisioning", token).get("provisioning"))
        flows = self.optional("/cablemodem/serviceflows", token).get("serviceFlows")
        down, up = rates(flows)
        hosts = as_dict(as_dict(self.optional("/network/hosts?connectedOnly=true", token, HOSTS_TIMEOUT).get("hosts"))).get("hosts")
        radios = [flag(as_dict(self.optional(f"/wifi/{band}/state", token).get("state")).get("status")) for band in BANDS]
        status = str(modem.get("status") or "").lower()
        uptime = num(modem.get("upTime"))
        return Box(model=str(info.get("modelName") or "") or None, line="cable" if modem else None, connected=status == "operational" if status else None,
                   line_down_bps=down, line_up_bps=up, public_ip=public_address(as_dict(wan.get("ipv4")).get("address")),
                   uptime_s=int(uptime) if uptime is not None and uptime >= 0 else None, firmware=str(info.get("softwareVersion") or "") or None,
                   devices=sum(1 for h in hosts if isinstance(h, dict)) if isinstance(hosts, list) else None,
                   wifi=any(r for r in radios) if any(r is not None for r in radios) else None)

    def collect(self) -> dict:
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        token, user_id = self.login(base)
        REFUSED_BY.pop(base, None)
        try:
            return box_card(self.read(token))
        finally:
            try:
                self.call(f"/user/{user_id}/token/{token}", token, method="DELETE")   # frees the single session slot at once
            except ConnectorError:
                pass   # the slot is freed by the box after its idle time
