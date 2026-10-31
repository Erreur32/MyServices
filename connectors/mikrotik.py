"""MikroTik routers with RouterOS 7.1 or later, read through the REST API (/rest/..., HTTP Basic). Read-only: only GET requests are sent.
RouterOS 6 has no REST API and cannot be read.

Sources, used as documentation only (nothing copied, rewritten with ctx.http, no new dependency):
- MikroTik, "REST API" (help.mikrotik.com/docs/spaces/ROS/pages/47579162): REST from v7.1beta4, `www-ssl` or `www` (the latter since 7.9) must run, HTTP Basic,
  GET lists a menu (/rest/<menu path>), every value is a string, errors are JSON {"error": n, "message": ...}.
- MikroTik, "Resource", "Health", "DHCP", "RouterBOARD" pages of help.mikrotik.com and manual.mikrotik.com (property names: board-name, version, name/value/type of the
  health sensors, status/address of the DHCP client, status of a lease, model of the routerboard).
  Licence: the pages carry only "Copyright MikroTik" with no open licence; they are read, not reproduced.
Confirmed by those pages: the routes and property names above. Guessed, only a real router can confirm: the shape of /rest/system/resource (one object, or a list of one
as the REST page example shows: both are accepted), the `disabled` and `running` flags of /rest/interface/wifi and /rest/interface/wireless, and that a bound DHCP lease means a connected device (a lease outlives the device until it expires), the sensor name
`cpu-temperature` / `board-temperature1` (older 7.x versions answer one object {"temperature": ...}), and that an old RouterOS or a closed service answers 404.
Not given: current traffic (counters need two readings), the type of line, the uptime of the Internet connection and the RouterOS update (checking for it is not a GET).
The Internet side is a running PPPoE client (its address in /ip/address, on the same interface) or a DHCP client in the "bound" state; a static WAN leaves `connected` and the public address empty.
A refused login is remembered in memory (address, account and a hash of the password, never the password) and not repeated until the settings change.
"""
from __future__ import annotations

import base64
import hashlib

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num

API = "/rest"
REFUSED = "compte ou mot de passe refusé par le routeur : vérifie-les (MyServices ne réessaie pas tant que les réglages ne changent pas)"
NO_REST = "le routeur ne répond pas à l'API REST : il faut RouterOS 7.1 ou plus récent (RouterOS 6 n'a pas d'API REST) avec le service www-ssl ou www activé dans IP > Services"
NOT_ROUTEROS = "réponse inattendue : ce n'est pas l'API REST de RouterOS"
REFUSED_BY: dict[str, str] = {}   # address -> fingerprint of the account and password the router refused
WIFI_MENUS = ("/interface/wifi", "/interface/wireless")   # RouterOS 7.13+ "wifi" package, then the older "wireless" one
TEMPERATURES = ("cpu-temperature", "board-temperature1", "temperature")


def as_dict(value: object) -> dict:
    """A reply that is a list holds its first object (the REST page shows /system/resource that way)."""
    if isinstance(value, list):
        value = value[0] if value else {}
    return value if isinstance(value, dict) else {}


def flag(value: object) -> bool | None:
    """RouterOS sends booleans as the strings "true" and "false"."""
    if isinstance(value, bool):
        return value
    word = str(value).strip().lower() if value is not None else ""
    if word in ("true", "yes"):
        return True
    return False if word in ("false", "no") else None


def text(value: object) -> str | None:
    return str(value).strip() or None if value is not None else None


def rows(value: object) -> list[dict]:
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def temperature(health: object) -> float | None:
    """From [{name, value, type}, ...] (7.x current) or one object {"temperature": ...} (first 7.x versions); None when the router has no sensor."""
    sensors = {str(r.get("name")): r.get("value") for r in rows(health)}
    if not sensors and isinstance(health, dict):
        sensors = health
    for name in TEMPERATURES:
        if (value := num(sensors.get(name))) is not None:
            return value
    return None


def wan_of(clients: list[dict], pppoe: list[dict], addresses: list[dict]) -> tuple[bool | None, str | None]:
    """(connected, public address): connected when a PPPoE client runs or a DHCP client is bound, None with neither configured (static WAN)."""
    if not clients and not pppoe:
        return None, None
    tunnels = {p.get("name") for p in pppoe if flag(p.get("running")) is True and flag(p.get("disabled")) is not True}
    bound = [c for c in clients if str(c.get("status") or "").lower() == "bound" and flag(c.get("disabled")) is not True]
    found = [a.get("address") for a in addresses if a.get("interface") in tunnels] + [c.get("address") for c in bound]
    public = [ip for ip in (public_address(str(a or "").split("/")[0]) for a in found) if ip]
    return bool(tunnels or bound), public[0] if public else None


class MikroTik(StatusConnector):
    type = "mikrotik"
    label = "MikroTik RouterOS"
    fields = (
        Field("url", "Adresse du routeur", "url", required=True, default="https://192.168.88.1", help="L'adresse de son interface web : souvent https://192.168.88.1 (réglage d'usine MikroTik)."),   # NOSONAR S1313: the factory address of MikroTik routers, a default the user can change
        Field("username", "Compte", "text", required=True, default="mikrotik-lecture", help="Un compte dédié à la lecture (voir le guide), pas admin."),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="à laisser décoché : le certificat du routeur est auto-signé"),
    )
    guide = ("Il faut RouterOS 7.1 ou plus récent : RouterOS 6 n'a pas d'API REST et ne peut pas être lu.",
             "Dans le routeur, active le service www-ssl (HTTPS, recommandé) dans IP > Services ; le service www (HTTP simple) n'existe qu'à partir de RouterOS 7.9 et est déconseillé. Limite-le à l'adresse du serveur MyServices.",
             "Crée un groupe d'utilisateurs qui n'a que les droits read et api (System > Users > Groups), puis un compte de ce groupe : MyServices ne fait que des lectures (GET).",
             "Le routeur ne donne pas ici le débit en cours, le type de ligne ni les mises à jour. L'état de la connexion et l'adresse publique viennent du client PPPoE ou DHCP : une adresse fixe ne les donne pas.",
             "Non testé sur un vrai routeur.")

    def fingerprint(self) -> str:
        return hashlib.sha256(f"{self.conf.get('username', '')}\0{self.conf.get('password', '')}".encode()).hexdigest()

    def call(self, path: str, required: bool = False) -> object:
        """GET one menu; None when it is missing (older package, no sensor) unless `required`. A refused login and a rate limit always raise."""
        account = f"{self.conf.get('username', '')}:{self.conf.get('password', '')}".encode()
        headers = {"Authorization": "Basic " + base64.b64encode(account).decode()}
        try:
            return self.ctx.http(self.base_url() + API + path, headers=headers, verify_tls=self.tls())
        except RateLimited:
            raise
        except ConnectorError as e:
            message = str(e)
            if message.startswith(("HTTP 401", "HTTP 403")):
                REFUSED_BY[self.base_url()] = self.fingerprint()
                raise ConnectorError(REFUSED) from None
            if required and message.startswith("HTTP 404"):
                raise ConnectorError(NO_REST) from None
            if required:
                raise
            return None

    def wifi_on(self) -> bool | None:
        """True when a radio is enabled and running; the first menu that answers decides, None when neither exists."""
        for menu in WIFI_MENUS:
            radios = rows(self.call(menu))
            if radios:
                enabled = [r for r in radios if flag(r.get("disabled")) is False]
                return any(flag(r.get("running")) is not False for r in enabled)
        return None

    def read(self) -> Box:
        resource = self.call("/system/resource", required=True)
        res = as_dict(resource)
        if not res:
            raise ConnectorError(NOT_ROUTEROS)
        board = as_dict(self.call("/system/routerboard"))
        pppoe = rows(self.call("/interface/pppoe-client"))
        addresses = rows(self.call("/ip/address")) if pppoe else []
        connected, address = wan_of(rows(self.call("/ip/dhcp-client")), pppoe, addresses)
        leases = self.call("/ip/dhcp-server/lease")
        bound = [r for r in rows(leases) if str(r.get("status") or "").lower() == "bound"]
        return Box(model=text(board.get("model")) or text(res.get("board-name")), connected=connected, public_ip=address,
                   firmware=text(res.get("version")), devices=len(bound) if isinstance(leases, list) else None,
                   wifi=self.wifi_on(), temperature=temperature(self.call("/system/health")))

    def collect(self) -> dict:
        if REFUSED_BY.get(self.base_url()) == self.fingerprint():
            raise ConnectorError(REFUSED)
        box = self.read()
        REFUSED_BY.pop(self.base_url(), None)
        return box_card(box)
