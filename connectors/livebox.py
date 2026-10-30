"""Orange Livebox (3 to 7), read by « sysbus », the local API of the box: POST http://<ip>/ws, JSON calls {service, method, parameters}. No official documentation: written from the
aiosysbus, pyLiveboxPlay and Home Assistant orange_livebox libraries, not tested on a real box. Read-only: only getters are called. The login is one createContext call
with the user and the password; the box limits its open sessions and locks an address that tries a wrong password again and again, so a refused login stops the reading at that call
(nothing is retried) and the session is released at the end. The password never goes in a message. Not read: the temperature, the connected devices and the connection uptime.
"""
from __future__ import annotations

import json
import re

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector
from connectors.upnp_box import positive

CONTENT_TYPE = "application/x-sah-ws-4-call+json"
APPLICATION = "myservices"
LINES = {"ftth": "fibre", "gpon": "fibre", "fibre": "fibre", "dsl": "dsl", "adsl": "dsl", "vdsl": "dsl"}   # « ethernet » is whatever sits behind the port: never guessed
REFUSED = "identifiant ou mot de passe refusé par la Livebox : vérifie le compte dans son interface (admin et le mot de passe imprimé sous la box, ou celui que tu as choisi)"


def line_of(link_type) -> str | None:
    return LINES.get(re.sub(r"[^a-z].*", "", str(link_type or "").lower()))


def body(answer) -> dict:
    """The useful dict of a sysbus answer: the getters put it under result.data or result.status depending on the service."""
    if not isinstance(answer, dict):
        return {}
    result = answer.get("result") if isinstance(answer.get("result"), dict) else answer.get("status") if isinstance(answer.get("status"), dict) else None   # DeviceInfo.get answers {"status": {...}}
    if result is None:
        return {}
    return next((v for v in (result.get("data"), result.get("status")) if isinstance(v, dict)), result)


def kbit(value) -> int | None:
    n = positive(value)
    return None if n is None else n * 1000


class Livebox(StatusConnector):
    type = "livebox"
    label = "Livebox"
    fields = (
        Field("url", "Adresse de la Livebox", "url", default="http://192.168.1.1", help="L'adresse de son interface web, souvent http://192.168.1.1 (ou http://livebox.home)."),
        Field("username", "Utilisateur", "text", required=True, default="admin", help="admin sauf si tu l'as changé."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Celui de l'interface de la Livebox (imprimé sous la box au départ)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("MyServices lit l'état de la Livebox par son API locale, avec le compte de son interface web (admin) : il ne fait que lire.",
             "Donne l'adresse de la box (souvent http://192.168.1.1) : celle qui ouvre son interface web depuis le serveur.",
             "Une mauvaise adresse ou un mauvais mot de passe bloquent la box un moment : teste d'abord le compte dans l'interface de la box.",
             "La box ne donne pas ici la température ni les appareils connectés, et la Livebox ne permet que quelques sessions à la fois.")

    def call(self, service: str, method: str, parameters: dict | None = None, context: str | None = None, optional: bool = False) -> dict:
        """The answer to a sysbus call; {} when the box lacks an optional one (older model, other firmware)."""
        headers = {"Content-Type": CONTENT_TYPE, "Authorization": f"X-Sah {context}" if context else "X-Sah-Login", **({"X-Context": context} if context else {})}
        payload = json.dumps({"service": service, "method": method, "parameters": parameters or {}}).encode()
        try:
            answer = self.ctx.http(f"{self.base_url()}/ws", method="POST", payload=payload, headers=headers, verify_tls=self.tls())
            if not isinstance(answer, dict) or answer.get("errors"):
                raise ConnectorError("la Livebox refuse cette lecture")
            return answer
        except RateLimited:
            raise
        except ConnectorError:
            if optional:
                return {}
            raise

    def login(self) -> str:
        user, password = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        try:
            answer = self.call("sah.Device.Information", "createContext", {"applicationName": APPLICATION, "username": user, "password": password})
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError(REFUSED) from None
            if str(e).startswith("HTTP 404"):
                raise ConnectorError("la Livebox ne répond pas à /ws : vérifie l'adresse (celle de son interface web)") from None
            raise ConnectorError("la Livebox refuse la connexion : vérifie l'adresse, l'utilisateur et le mot de passe") from None
        data = answer.get("data") if isinstance(answer.get("data"), dict) else {}
        context = data.get("contextID")
        if not context or not isinstance(context, str):
            raise ConnectorError(REFUSED)
        return context

    def logout(self, context: str) -> None:
        """Best effort: the box keeps few sessions, but a failed release must not fail the reading."""
        try:
            self.call("sah.Device.Information", "releaseContext", {"applicationName": APPLICATION}, context=context, optional=True)
        except ConnectorError:
            pass

    def collect(self) -> dict:
        context = self.login()   # the first call with the login: a refused one stops here
        try:
            wan = body(self.call("NMC", "getWANStatus", context=context, optional=True))
            info = body(self.call("DeviceInfo", "get", context=context, optional=True))
            if not (wan or info):
                raise ConnectorError("la Livebox répond mais refuse la lecture : vérifie les droits du compte")
            line = line_of(wan.get("LinkType"))
            dsl = {}
            if line == "dsl":
                mib = body(self.call("NeMo.Intf.data", "getMIBs", {"mibs": "dsl"}, context=context, optional=True)).get("dsl")
                dsl = next((v for v in mib.values() if isinstance(v, dict)), {}) if isinstance(mib, dict) else {}
            wifi = body(self.call("NMC.Wifi", "get", context=context, optional=True)).get("Enable")
        finally:
            self.logout(context)
        state = wan.get("WanState") or wan.get("LinkState")
        return box_card(Box(
            model=info.get("ProductClass") or None, line=line, connected=(state == "up" and wan.get("ConnectionState", "Bound") == "Bound") if state else None,
            line_down_bps=kbit(dsl.get("DownstreamCurrRate")), line_up_bps=kbit(dsl.get("UpstreamCurrRate")), public_ip=public_address(wan.get("IPAddress")),
            firmware=info.get("SoftwareVersion") or None, wifi=wifi if isinstance(wifi, bool) else None))
