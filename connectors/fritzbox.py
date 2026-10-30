"""AVM FRITZ!Box (also sold under their own name by 1&1, Vodafone, Telekom and others), read by TR-064: the SOAP interface the box offers to applications, on port 49000
(49443 with TLS). Read-only: only Get* actions are ever sent. The box asks a user and a password (HTTP digest) for almost everything; it locks an address that tries
a wrong password again and again, so a refused login stops the reading at its first call.

TR-064 says nothing of the temperature, and the connected devices need a long list to walk: those fields stay None. The control addresses of the description are only
used on the host of the box, and the XML goes through defusedxml (see upnp_box.py, whose helpers are reused).
"""
from __future__ import annotations

import re
import urllib.parse
from typing import NamedTuple

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num
from connectors.upnp_box import control_url, is_up, local_name, parse_xml, positive, soap

PORTS = {"http": 49000, "https": 49443}
SERVICE = re.compile(r"urn:dslforum-org:service:([\w-]+):(\d+)")
# « Ethernet » is whatever sits behind the port, fibre included: never guessed. The values are the ones of AVM's WANCommonInterfaceConfig description.
LINES = {"DSL": "dsl", "X_AVM-DE_Fiber": "fibre", "X_AVM-DE_Cable": "cable", "X_AVM-DE_UMTS": "mobile", "X_AVM-DE_LTE": "mobile", "X_AVM-DE_Mobile": "mobile"}
WIFI_BANDS = (1, 2)   # WLANConfiguration:1 and :2 are the 2.4 and 5 GHz networks, :3 is the guest one
WAN_CONNECTIONS = (("WANIPConnection", 1), ("WANPPPConnection", 1))
DEVICE, USER_UI, COMMON, WLAN = ("DeviceInfo", 1), ("UserInterface", 1), ("WANCommonInterfaceConfig", 1), "WLANConfiguration"


class Service(NamedTuple):
    type: str
    url: str


def services_of(root, base: str) -> dict[tuple[str, int], Service]:
    """The TR-064 services of a description, by (name, instance): « WLANConfiguration:2 » is the second network, not a version."""
    host, out = urllib.parse.urlsplit(base).hostname, {}
    for el in root.iter():
        if local_name(el.tag) == "service":
            info = {local_name(c.tag): (c.text or "").strip() for c in el}
            kind, url = SERVICE.fullmatch(info.get("serviceType", "")), control_url(base, info.get("controlURL", ""), host)
            if kind and url:
                out.setdefault((kind[1], int(kind[2])), Service(info["serviceType"], url))
    return out


def bits(bytes_per_second) -> int | None:
    """Bit/s of a rate the box gives in bytes/s; 0 is a real rate, a missing one is None."""
    n = num(bytes_per_second)
    return None if n is None else round(n * 8)


class FritzBox(StatusConnector):
    type = "fritzbox"
    label = "FRITZ!Box"
    fields = (
        Field("url", "Adresse de la FRITZ!Box", "url", default="http://fritz.box",
              help="http://fritz.box, ou son IP si ce nom ne se résout pas depuis le serveur. Port 49000 en HTTP, 49443 en HTTPS (ajouté tout seul)."),
        Field("username", "Utilisateur", "text", required=True, help="Un utilisateur de la FRITZ!Box dédié à MyServices (avant FRITZ!OS 7.24 : dslf-config)."),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Dans la FRITZ!Box, Réseau domestique > Réseau > Paramètres réseau : coche « Autoriser l'accès pour les applications » et « Transmettre les informations d'état par UPnP ».",
             "Système > Utilisateurs FRITZ!Box : crée un utilisateur pour MyServices, avec un mot de passe fort et le droit « Paramètres de la FRITZ!Box ». MyServices ne fait que lire.",
             "Une mauvaise adresse ou un mauvais mot de passe bloquent la box un moment : teste d'abord le compte dans l'interface de la box.",
             "TR-064 ne dit ni la température ni le nombre d'appareils connectés : ces informations ne sont pas montrées.")

    def address(self) -> str:
        url = str(self.conf.get("url") or "http://fritz.box").strip().rstrip("/")
        try:
            parts = urllib.parse.urlsplit(url if "//" in url else f"http://{url}")
            host, port = parts.hostname, parts.port
        except ValueError:
            raise ConnectorError("adresse : http://<IP> ou https://<IP> attendu") from None
        if parts.scheme not in PORTS or not host:
            raise ConnectorError("adresse : http://<IP> ou https://<IP> attendu")
        return f"{parts.scheme}://{f'[{host}]' if ':' in host else host}:{port or PORTS[parts.scheme]}"

    def ask(self, services: dict, key: tuple[str, int], action: str) -> dict:
        """The New* values of an answer; {} when the box lacks this action or this service, or refuses it to this account (it answers 500)."""
        service = services.get(key)
        if service is None:
            return {}
        try:
            return soap(self.ctx, service.type, service.url, action, verify_tls=self.tls(), digest=(str(self.conf.get("username", "")), str(self.conf.get("password", ""))))
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith("HTTP 401"):
                raise ConnectorError("utilisateur ou mot de passe refusé par la FRITZ!Box : vérifie le compte et son droit « Paramètres de la FRITZ!Box »") from None
            return {}

    def description(self, base: str):
        try:
            return parse_xml(self.ctx.http(f"{base}/tr64desc.xml", binary=True, headers={"Accept": "text/xml"}, verify_tls=self.tls()))
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith("HTTP 404"):
                raise ConnectorError("TR-064 est coupé sur la FRITZ!Box : coche « Autoriser l'accès pour les applications » dans Réseau domestique > Réseau > Paramètres réseau") from None
            raise

    def connection(self, services: dict) -> tuple[tuple[str, int] | None, dict]:
        """The connection in use: a box can declare both IP and PPP, and only one of them is connected."""
        read = [(k, self.ask(services, k, "GetStatusInfo")) for k in WAN_CONNECTIONS if k in services]
        return next((r for r in read if r[1].get("NewConnectionStatus") == "Connected"), read[0] if read else (None, {}))

    def wifi(self, services: dict) -> bool | None:
        """On when one of the two main networks is on; None when the box does not say (the guest network does not count)."""
        states = [self.ask(services, (WLAN, n), "GetInfo").get("NewEnable") for n in WIFI_BANDS]
        known = [s for s in states if s in ("0", "1")]
        return any(s == "1" for s in known) if known else None

    def collect(self) -> dict:
        base = self.address()
        services = services_of(self.description(base), base)
        if not services:
            raise ConnectorError("cet appareil n'annonce aucun service TR-064")
        info = self.ask(services, DEVICE, "GetInfo")   # the first call with the login: a refused one stops here
        link, addon = self.ask(services, COMMON, "GetCommonLinkProperties"), self.ask(services, COMMON, "GetAddonInfos")
        wan, state = self.connection(services)
        if not (info or link or state):
            raise ConnectorError("la FRITZ!Box répond mais refuse la lecture : vérifie le droit « Paramètres de la FRITZ!Box » du compte")
        ui = self.ask(services, USER_UI, "GetInfo")
        update = ui["NewUpgradeAvailable"] == "1" if "NewUpgradeAvailable" in ui else None
        return box_card(Box(
            model=info.get("NewModelName") or None, line=LINES.get(link.get("NewWANAccessType", "")), connected=is_up(state.get("NewConnectionStatus"), link.get("NewPhysicalLinkStatus")),
            down_bps=bits(addon.get("NewByteReceiveRate")), up_bps=bits(addon.get("NewByteSendRate")),
            line_down_bps=positive(link.get("NewLayer1DownstreamMaxBitRate")), line_up_bps=positive(link.get("NewLayer1UpstreamMaxBitRate")),
            public_ip=public_address(self.ask(services, wan, "GetExternalIPAddress").get("NewExternalIPAddress")) if wan else None, uptime_s=positive(state.get("NewUptime")),
            firmware=info.get("NewSoftwareVersion") or None, update_available=update, latest_firmware=(ui.get("NewX_AVM-DE_Version") or None) if update else None, wifi=self.wifi(services)))
