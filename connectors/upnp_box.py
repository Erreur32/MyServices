"""Any Internet box that speaks UPnP IGD: found by SSDP (or from its description address), then read with the SOAP queries of the standard. Read-only: only
Get* actions are ever sent, none of the port mapping ones. No login exists on this protocol.

SSDP answers come from anyone on the LAN: the description is only fetched from the device that answered, the SOAP addresses only on the host of the
description, and the XML goes through defusedxml. UPnP says nothing of fibre, firmware, Wi-Fi or temperature: those fields stay None.
"""
from __future__ import annotations

import ipaddress
import re
import socket
import time
import urllib.parse
from typing import NamedTuple

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num

SSDP = ("239.255.255.250", 1900)   # NOSONAR S1313 ; the multicast group of SSDP, fixed by the standard
SEARCH_TARGETS = ("urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:device:InternetGatewayDevice:2")
SEARCH_S = 3            # s, how long a box may take to answer
LOCATION_TTL = 600      # s, a box may move its UPnP port when it restarts
SAMPLE_S = 1            # s, between the two readings of the traffic counters
COMMON, IP_CONN, PPP_CONN = "WANCommonInterfaceConfig", "WANIPConnection", "WANPPPConnection"
SERVICE = re.compile(rf"urn:schemas-upnp-org:service:({COMMON}|{IP_CONN}|{PPP_CONN}):\d+")
LINES = {"DSL": "dsl", "Cable": "cable"}   # « Ethernet » is whatever sits behind the port, fibre included: never guessed
ENVELOPE = ('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
            '<s:Body><u:{action} xmlns:u="{service}"/></s:Body></s:Envelope>')


class Service(NamedTuple):
    kind: str
    type: str
    url: str


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_xml(raw: bytes):
    # Imported here like msv/core/avatars.py: defusedxml is in the image, not on the host that runs the hooks
    from defusedxml import DefusedXmlException
    from defusedxml.ElementTree import ParseError, fromstring
    try:
        return fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (DefusedXmlException, ParseError):
        raise ConnectorError("réponse XML illisible") from None


def on_host(url: str, host: str | None) -> bool:
    """An http(s) address on this host; a malformed address, as a LAN device may send, is simply not one."""
    try:
        parts = urllib.parse.urlsplit(url)
        return parts.scheme in ("http", "https") and parts.hostname == host
    except ValueError:
        return False


def location_of(answer: bytes, sender: str) -> str | None:
    """The description address of an SSDP answer, None unless it comes from a gateway (a media server answers too, whatever is searched) on the private
    address that answered."""
    lines = answer.decode("latin-1", "replace").split("\r\n")
    head = {k.strip().lower(): v.strip() for k, v in (line.split(":", 1) for line in lines if ":" in line)}
    url = head.get("location", "")
    return url if head.get("st") in SEARCH_TARGETS and on_host(url, sender) and ipaddress.ip_address(sender).is_private else None


def search(wait: float = SEARCH_S) -> str:
    """The description address of the first box that answers on the LAN."""
    end = time.monotonic() + wait
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            for target in SEARCH_TARGETS:
                s.sendto(f'M-SEARCH * HTTP/1.1\r\nHOST: {SSDP[0]}:{SSDP[1]}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: {target}\r\n\r\n'.encode(), SSDP)
            while (left := end - time.monotonic()) > 0:
                s.settimeout(left)
                answer, sender = s.recvfrom(4096)
                if found := location_of(answer, sender[0]):
                    return found
    except TimeoutError:
        pass
    except OSError as e:
        raise ConnectorError(f"recherche UPnP impossible ({e.strerror})") from None
    raise ConnectorError("aucune box UPnP trouvée : active UPnP sur la box, ou donne son adresse de description")


def control_url(base: str, path: str, host: str | None) -> str | None:
    """Where to post for a service. Another host is refused: the device does not choose where MyServices posts."""
    try:
        url = urllib.parse.urljoin(base, path)
    except ValueError:
        return None
    return url if path and on_host(url, host) else None


def services_of(root, location: str) -> list[Service]:
    """The WAN services of a description."""
    base = next((el.text.strip() for el in root.iter() if _local(el.tag) == "URLBase" and el.text), location)
    host, out = urllib.parse.urlsplit(location).hostname, []
    for el in root.iter():
        if _local(el.tag) == "service":
            info = {_local(c.tag): (c.text or "").strip() for c in el}
            kind, url = SERVICE.fullmatch(info.get("serviceType", "")), control_url(base, info.get("controlURL", ""), host)
            if kind and url:
                out.append(Service(kind[1], info["serviceType"], url))
    return out


def model_of(root) -> str | None:
    """Maker and model of the root device (the first ones in the document); its serial number and UDN are left where they are."""
    first = {}
    for el in root.iter():
        if _local(el.tag) in ("manufacturer", "modelName") and el.text:
            first.setdefault(_local(el.tag), el.text.strip())
    return " ".join(first[k] for k in ("manufacturer", "modelName") if k in first) or None


def positive(v) -> int | None:
    """A figure of the box, None when missing or 0: these boxes say 0 for what they do not measure."""
    return int(n) if (n := num(v)) else None


def is_up(status: str | None, physical: str | None) -> bool | None:
    """The connection's own word first, else the state of the line."""
    if status:
        return status == "Connected"
    return physical == "Up" if physical else None


def per_second(first: float | None, second: float | None, elapsed: float) -> int | None:
    """Bit/s between two byte counters. None when a box does not count (both 0) or the counter went back (32 bits on old boxes: it wraps within minutes)."""
    if first is None or second is None or second < first or not (first or second):
        return None
    return round((second - first) * 8 / elapsed)


class UPnPBox(StatusConnector):
    type = "upnp-box"
    label = "Box internet (UPnP IGD)"
    fields = (
        Field("url", "Adresse de description", "url", help="Vide : la box est cherchée sur le réseau local. Sinon par exemple http://<IP>:49000/igddesc.xml"),
    )
    guide = ("Active UPnP sur la box (souvent dans Réseau, NAT ou Partage de ports). MyServices ne fait que lire : il n'ouvre aucun port et ne change aucun réglage.",
             "Laisse l'adresse vide : MyServices cherche la box sur le réseau local. Cette recherche demande le réseau de l'hôte (network_mode: host), celui du compose fourni.",
             "Rien n'est trouvé, ou plusieurs appareils répondent : colle l'adresse de description de la box. La commande upnpc -l, lancée sur une machine du réseau, l'affiche.",
             "UPnP ne dit ni le type de fibre, ni le firmware, ni le Wi-Fi, ni la température : ces informations ne sont pas montrées.")

    def location(self) -> str:
        return self.base_url() if self.conf.get("url") else self.ctx.cached(f"upnp-box-{self.name}", LOCATION_TTL, search)

    def ask(self, service: Service | None, action: str) -> dict:
        """The New* values of an answer; {} when the box lacks this action or this service, the case of many of them."""
        if service is None:
            return {}
        try:
            raw = self.ctx.http(service.url, method="POST", binary=True, payload=ENVELOPE.format(action=action, service=service.type).encode(), headers={
                "Accept": "text/xml", "Content-Type": 'text/xml; charset="utf-8"', "SOAPAction": f'"{service.type}#{action}"'})
            return {_local(el.tag): (el.text or "").strip() for el in parse_xml(raw).iter() if _local(el.tag).startswith("New")}
        except RateLimited:
            raise
        except ConnectorError:
            return {}

    def _counters(self, common: Service | None) -> tuple[float | None, float | None]:
        return (num(self.ask(common, "GetTotalBytesReceived").get("NewTotalBytesReceived")), num(self.ask(common, "GetTotalBytesSent").get("NewTotalBytesSent")))

    def _traffic(self, common: Service | None) -> tuple[int | None, int | None]:
        """The current rates (down, up), from two readings a moment apart: the box only gives totals."""
        before, t0 = self._counters(common), time.monotonic()
        if before == (None, None):
            return None, None
        time.sleep(SAMPLE_S)
        after, elapsed = self._counters(common), time.monotonic() - t0
        return per_second(before[0], after[0], elapsed), per_second(before[1], after[1], elapsed)

    def _connection(self, wans: list[Service]) -> tuple[Service | None, dict]:
        """The connection in use: a box can declare both IP and PPP, and only one of them is connected."""
        read = [(w, self.ask(w, "GetStatusInfo")) for w in wans]
        return next((r for r in read if r[1].get("NewConnectionStatus") == "Connected"), read[0] if read else (None, {}))

    def collect(self) -> dict:
        location = self.location()
        root = parse_xml(self.ctx.http(location, binary=True, headers={"Accept": "text/xml"}))
        services = services_of(root, location)
        common = next((s for s in services if s.kind == COMMON), None)
        wans = [s for s in services if s.kind != COMMON]
        if not services:
            raise ConnectorError("cet appareil n'annonce aucune connexion Internet UPnP")
        link = self.ask(common, "GetCommonLinkProperties")
        wan, state = self._connection(wans)
        if not (link or state):
            raise ConnectorError("la box refuse les requêtes UPnP : vérifie que UPnP est actif et non limité à la lecture de sa description")
        down, up = self._traffic(common)
        return box_card(Box(
            model=model_of(root), line=LINES.get(link.get("NewWANAccessType", "")), connected=is_up(state.get("NewConnectionStatus"), link.get("NewPhysicalLinkStatus")), down_bps=down, up_bps=up,
            line_down_bps=positive(link.get("NewLayer1DownstreamMaxBitRate")), line_up_bps=positive(link.get("NewLayer1UpstreamMaxBitRate")),
            public_ip=public_address(self.ask(wan, "GetExternalIPAddress").get("NewExternalIPAddress")), uptime_s=positive(state.get("NewUptime"))))
