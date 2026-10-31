"""OpenWrt routers, through the JSON-RPC ubus interface of uhttpd (package uhttpd-mod-ubus, enabled by default at /ubus) and rpcd. Read-only: the login, two reads and
the logout are sent, nothing that changes the router.

Sources, used as documentation only (nothing copied, no dependency added):
- openwrt.org/docs/techref/ubus and /docs/guide-developer/ubus/session and /system: request format, session.login / session.destroy, status codes (CC BY-SA 4.0);
- rpcd, session.c (github.com/openwrt/rpcd, ISC licence): a wrong password or an unknown user gives status 6 (permission denied) with no payload;
- the OpenWrt (ubus) integration of Home Assistant (Apache 2.0) only for the idea of a read-only account; it relies on the openwrt-ubus-rpc library (GPL v2),
  which was not read nor reused.

Protocol: POST /ubus {"jsonrpc": "2.0", "id": 1, "method": "call", "params": [session, object, method, {args}]}. The first session is 32 zeros; session.login
{username, password} answers result [0, {"ubus_rpc_session": ...}]; every answer is result [status, payload], status 0 = OK. Read: system.board (model, release),
network.interface dump (the WAN interface: up, uptime in seconds, ipv4-address, default route). session.destroy ends the session.
Confirmed by the documentation: the request and answer shapes, status 6, the session methods, `system board`. Guessed from forum posts and a test mock of the OpenWrt
packages feed, not from a reference: the exact keys of the interface dump (interface, up, uptime, ipv4-address[address], route[target, mask]), the key
release.description, and that a refused call of a live session shows as JSON-RPC error -32002 (an expired session looks the same as a missing ACL).
Not read, because no source documents the answer: connected devices and Wi-Fi (luci-rpc getHostHints and hostapd answers), so those fields stay None; also line type,
rates, temperature and updates, which OpenWrt does not give in a standard way.
A refused login is remembered in memory (address, user and a hash of the password, never the password) and not repeated until the settings change.
"""
from __future__ import annotations

import hashlib

from connectors.base import ConnectorError, Field
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num

NULL_SESSION = "0" * 32
PERMISSION_DENIED = 6   # UBUS_STATUS_PERMISSION_DENIED
EXPIRED = -32002        # JSON-RPC error of uhttpd when the session is not allowed
REFUSED = "compte ou mot de passe refusé par le routeur : vérifie-les (MyServices ne réessaie pas tant que les réglages ne changent pas)"
SESSION_LOST = "le routeur refuse la lecture : session expirée ou droits de lecture manquants pour ce compte (voir le guide)"
NOT_UBUS = "réponse inattendue : ce n'est pas l'interface ubus d'OpenWrt (paquet uhttpd-mod-ubus)"
LOGIN_FAILED = "connexion refusée par le routeur (code {}) : le compte doit exister dans /etc/config/rpcd"
READ_FAILED = "lecture refusée par le routeur (code {}) : ajoute les droits de lecture au compte (voir le guide)"
REFUSED_BY: dict[str, str] = {}   # address -> fingerprint of the account and password the router refused


def as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def is_default_route(route: object) -> bool:
    item = as_dict(route)
    return item.get("target") == "0.0.0.0" and num(item.get("mask")) == 0   # NOSONAR S1313: the wildcard target of an IPv4 default route, not a host


def pick_wan(interfaces: object) -> dict:
    """The WAN interface: the one named wan, else the first with an IPv4 default route; {} when none."""
    items = [as_dict(i) for i in interfaces] if isinstance(interfaces, list) else []
    named = [i for i in items if i.get("interface") == "wan"]
    routed = [i for i in items if any(is_default_route(r) for r in i.get("route") or [])]
    return (named or routed or [{}])[0]


def first_address(wan: dict) -> str | None:
    addresses = wan.get("ipv4-address")
    first = as_dict(addresses[0]) if isinstance(addresses, list) and addresses else {}
    return public_address(first.get("address"))


class OpenWrt(StatusConnector):
    type = "openwrt"
    label = "OpenWrt"
    fields = (
        Field("url", "Adresse du routeur", "url", required=True, default="http://192.168.1.1", help="L'adresse de son interface web LuCI, souvent http://192.168.1.1 (https:// si le routeur l'impose)."),   # NOSONAR S1313: the factory address of OpenWrt, a default the user can change
        Field("username", "Compte", "text", required=True, default="root", help="De préférence un compte dédié en lecture seule (voir le guide), pas root."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Celui de ce compte sur le routeur."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="à laisser décoché si le routeur a un certificat auto-signé (sans effet en http)"),
    )
    guide = ("Donne l'adresse du routeur et un compte : MyServices ne fait que lire (modèle, version, état et adresse de la connexion Internet) et ferme sa session après chaque lecture.",
             "Prévois un compte dédié, en lecture seule : sur le routeur, crée un fichier /usr/share/rpcd/acl.d/myservices.json contenant "
             '{"myservices": {"description": "MyServices", "read": {"ubus": {"system": ["board"], "network.interface": ["dump"]}}}}, '
             "puis ajoute dans /etc/config/rpcd une section « config login » avec option username, option password (« $p$ » suivi du nom d'un utilisateur système, ou un hash) et « list read 'myservices' », "
             "et relance rpcd (/etc/init.d/rpcd restart). Le paquet uhttpd-mod-ubus doit être installé (c'est le cas par défaut).",
             "Le routeur n'indique pas ici les appareils connectés, le Wi-Fi, les débits ni la température.",
             "Après une erreur de mot de passe, MyServices ne réessaie pas tant que les réglages ne changent pas.")

    def fingerprint(self) -> str:
        secret = f"{self.conf.get('username', '')}\0{self.conf.get('password', '')}"
        return hashlib.sha256(secret.encode()).hexdigest()

    def rpc(self, session: str, obj: str, method: str, args: dict) -> tuple[int, dict]:
        """(status, payload) of one ubus call; a JSON-RPC error or an unreadable answer raises."""
        body = {"jsonrpc": "2.0", "id": 1, "method": "call", "params": [session, obj, method, args]}
        answer = as_dict(self.ctx.http(self.base_url() + "/ubus", method="POST", body=body, verify_tls=self.tls()))
        if as_dict(answer.get("error")).get("code") == EXPIRED:
            raise ConnectorError(SESSION_LOST)
        result = answer.get("result")
        if not isinstance(result, list) or not result or not isinstance(result[0], int):
            raise ConnectorError(NOT_UBUS)
        return result[0], as_dict(result[1]) if len(result) > 1 else {}

    def login(self, base: str) -> str:
        args = {"username": str(self.conf.get("username", "")), "password": str(self.conf.get("password", ""))}
        status, payload = self.rpc(NULL_SESSION, "session", "login", args)
        if status == PERMISSION_DENIED:
            REFUSED_BY[base] = self.fingerprint()
            raise ConnectorError(REFUSED)
        if status != 0:
            raise ConnectorError(LOGIN_FAILED.format(status))
        session = payload.get("ubus_rpc_session")
        if not isinstance(session, str) or not session:
            raise ConnectorError(NOT_UBUS)
        return session

    def read_one(self, session: str, obj: str, method: str, args: dict | None = None) -> dict:
        status, payload = self.rpc(session, obj, method, args or {})
        if status != 0:
            raise ConnectorError(READ_FAILED.format(status))
        return payload

    def read(self, session: str) -> Box:
        board = self.read_one(session, "system", "board")
        wan = pick_wan(self.read_one(session, "network.interface", "dump").get("interface"))
        up = wan.get("up")
        uptime = num(wan.get("uptime"))
        release = as_dict(board.get("release"))
        return Box(model=str(board.get("model") or "") or None, connected=up if isinstance(up, bool) else None,
                   public_ip=first_address(wan), uptime_s=int(uptime) if uptime is not None and uptime >= 0 else None,
                   firmware=str(release.get("description") or release.get("version") or "") or None)

    def collect(self) -> dict:
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        session = self.login(base)
        REFUSED_BY.pop(base, None)
        try:
            return box_card(self.read(session))
        finally:
            try:
                self.rpc(session, "session", "destroy", {"ubus_rpc_session": session})
            except ConnectorError:
                pass   # the router drops the session by itself after its timeout (5 minutes by default)
