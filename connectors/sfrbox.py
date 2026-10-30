"""SFR Box (NB6, NB7, NB8…), read by the local API of the box (/api/1.0/?method=namespace.getInfo, answers in XML). Read-only and without any account: the system,
WAN and DSL readings answer without a token, so no password is asked, kept or sent. The Wi-Fi reading needs a login and its answer carries the Wi-Fi key: it is never
called, the Wi-Fi state is not shown. The box gives no traffic counters, no connected devices and no firmware on offer: those fields stay None.
The answer goes through defusedxml (see upnp_box.py, whose helpers are reused). Written from the sfrbox-api library, not tested on a real box.
"""
from __future__ import annotations

import re

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num
from connectors.upnp_box import local_name, parse_xml, positive

LINES = {"ftth": "fibre", "adsl": "dsl", "vdsl": "dsl"}   # « fttb » and the others are not guessed
HOT_LIMITS = (-30, 120)   # °C, what a sensor of a box can say: outside it the figure is not one


def line_of(infra: str | None) -> str | None:
    """The line type of an « infra » word (adsl, adsl2+, vdsl2, ftth…)."""
    return LINES.get(re.sub(r"[^a-z].*", "", (infra or "").lower()))


def celsius(raw) -> float | None:
    """The box gives thousandths of a degree (27560 is 27,56 °C). shortcut: a figure over 200 is taken as thousandths, an older firmware that gives degrees is read as is."""
    n = num(raw)
    if n is None:
        return None
    n = n / 1000 if n > 200 else n
    return n if HOT_LIMITS[0] <= n <= HOT_LIMITS[1] else None


def bits(kbit_per_second) -> int | None:
    n = positive(kbit_per_second)
    return None if n is None else n * 1000


class SFRBox(StatusConnector):
    type = "sfrbox"
    label = "SFR Box"
    fields = (
        Field("url", "Adresse de la SFR Box", "url", required=True, default="http://192.168.1.1", help="L'adresse de son interface web, souvent http://192.168.1.1."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Aucun compte : MyServices lit l'état de la SFR Box comme la page d'accueil de son interface, sur le réseau local.",
             "Donne l'adresse de la box (souvent http://192.168.1.1) : celle qui ouvre son interface web depuis le serveur.",
             "La box ne donne pas les débits en cours, le firmware à jour, les appareils ni la clé Wi-Fi : ces informations ne sont pas montrées, et MyServices ne demande jamais le mot de passe.")

    def call(self, method: str, optional: bool = False) -> dict:
        """The attributes of the answer to a getInfo method; {} when the box lacks an optional one."""
        try:
            root = parse_xml(self.ctx.http(f"{self.base_url()}/api/1.0/?method={method}", binary=True, headers={"Accept": "text/xml"}, verify_tls=self.tls()))
            if root.get("stat") != "ok":
                raise ConnectorError("la SFR Box refuse cette lecture : vérifie l'adresse (celle de son interface web)")
            element = next((e for e in root if local_name(e.tag) == method.split(".")[0]), None)
            return dict(element.attrib) if element is not None else {}
        except RateLimited:
            raise
        except ConnectorError:
            if optional:
                return {}
            raise

    def collect(self) -> dict:
        system = self.call("system.getInfo")
        wan = self.call("wan.getInfo", optional=True)
        line = line_of(system.get("net_infra") or wan.get("infra"))
        dsl = self.call("dsl.getInfo", optional=True) if line == "dsl" else {}
        return box_card(Box(
            model=system.get("product_id") or None, line=line, connected=wan["status"] == "up" if wan.get("status") else None,
            line_down_bps=bits(dsl.get("rate_down")), line_up_bps=bits(dsl.get("rate_up")), public_ip=public_address(wan.get("ip_addr")),
            uptime_s=positive(wan.get("uptime")), firmware=system.get("version_mainfirmware") or None, temperature=celsius(system.get("temperature"))))
