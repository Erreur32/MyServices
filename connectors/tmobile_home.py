"""T-Mobile Home Internet gateways (Arcadyan KVD21 / TMO-G4AR, Sagemcom Fast 5688W, Sercomm TMO-G4SE) by their local JSON API under /TMI/v1. Read-only.
Written from the sivel/tmhi, pytmhi (EdLeckert) and HINTControl sources, not tested on a real gateway.

Routes read: gateway?get=all (device: model / softwareVersion; signal: 4g and 5g with bars, rsrp, rsrq, sinr, bands, cid, plus generic.registration;
time.upTime), and with an account network/telemetry?get=clients (connected devices) and network/configuration/v2?get=ap (Wi-Fi radios).
The gateway state is first asked WITHOUT any account; only when the gateway answers 401/403 (or when an account is given, for the extra pages) the connector
logs in once (POST auth/login, JSON user + password, answer {"auth": {"token"}}) and sends the token as a Bearer header.
A refused login is remembered in memory (address and a hash of the password, never the password) and is not repeated until the settings change; no retry.
Nokia 5G21 gateways use another API and are not covered. No public address (the gateway does not give it), no temperature, no current traffic.
Context.http carries a header and a JSON body, which is all the Bearer token needs, so there is no own opener here; fetch() stays the one overridable call.
"""
from __future__ import annotations

import hashlib

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card
from connectors.status_kit import MAX_FACTS, StatusConnector, fact, num

LOGIN_PATH = "auth/login"
GATEWAY_PATH = "gateway?get=all"
CLIENTS_PATH = "network/telemetry?get=clients"
AP_PATH = "network/configuration/v2?get=ap"
USER_KEY, PASS_FIELD = "username", "password"   # protocol words of the login body, not a credential
REFUSED = "identifiant ou mot de passe refusé par la passerelle : vérifie le compte de son interface (MyServices ne réessaie pas tant que les réglages ne changent pas)"
NEEDS_LOGIN = "la passerelle demande un compte pour donner son état : renseigne l'identifiant et le mot de passe de son interface"
NOT_TMOBILE = "cet appareil ne ressemble pas à une passerelle T-Mobile Home Internet (pas d'API /TMI/v1)"
UNREADABLE = "réponse illisible de la passerelle (format non géré)"
# Memory of the process: address -> fingerprint of the password the gateway refused.
REFUSED_BY: dict[str, str] = {}


class Refused(ConnectorError):
    """The gateway does not accept this account."""


def count_clients(data) -> int | None:
    """Connected devices of get=clients: a flat list, or lists by interface (2.4ghz, 5.0ghz, ethernet)."""
    data = data.get("clients", data) if isinstance(data, dict) else data
    groups = list(data.values()) if isinstance(data, dict) else [data]
    lists = [g for g in groups if isinstance(g, list)]
    if not lists:
        return None
    return sum(1 for g in lists for c in g if isinstance(c, dict) and c.get("connected") is not False)


def wifi_on(ap) -> bool | None:
    radios = [ap[k] for k in ("2.4ghz", "5.0ghz") if isinstance(ap, dict) and isinstance(ap.get(k), dict) and "isRadioEnabled" in ap[k]]
    return any(r["isRadioEnabled"] is True for r in radios) if radios else None


def signal_fact(name: str, cell) -> dict | None:
    """« 4G » / « 5G » line: bars, RSRP, RSRQ, SINR, band, cell id; whatever is missing is left out."""
    if not isinstance(cell, dict) or not cell:
        return None
    bars = num(cell.get("bars"))
    bands = cell.get("bands")
    parts = [
        bars is not None and f"{bars:g} barre(s)",
        (rsrp := num(cell.get("rsrp"))) is not None and f"RSRP {rsrp:g} dBm",
        (rsrq := num(cell.get("rsrq"))) is not None and f"RSRQ {rsrq:g} dB",
        (sinr := num(cell.get("sinr"))) is not None and f"SINR {sinr:g} dB",
        isinstance(bands, list) and bands and "bande " + "/".join(str(b) for b in bands),
        (cid := cell.get("cid")) not in (None, "") and f"cellule {cid}",
    ]
    text = " · ".join(p for p in parts if p)
    return fact(f"Signal {name}", text, "bad" if bars == 0 else "warn" if bars is not None and bars < 2 else None) if text else None


class TMobileHome(StatusConnector):
    type = "tmobile-home-internet"
    label = "T-Mobile Home Internet"
    fields = (
        Field("url", "Adresse de la passerelle", "url", required=True, default="http://192.168.12.1", help="L'adresse de la passerelle T-Mobile, par défaut http://192.168.12.1."),
        Field("username", "Identifiant (facultatif)", "text", default="admin", help="Le compte de l'interface de la passerelle, souvent admin."),
        Field("password", "Mot de passe (facultatif)", "password", secret=True, help="Celui de l'interface de la passerelle (imprimé sous l'appareil). Sans lui : l'état seulement si la passerelle le donne sans compte ; avec lui : appareils connectés et Wi-Fi en plus."),
    )
    guide = ("Donne l'adresse de la passerelle T-Mobile Home Internet (Arcadyan, Sagemcom, Sercomm) : MyServices lit son état comme l'application officielle, sans rien modifier.",
             "Le compte est facultatif. Sans lui : modèle, firmware, signal 4G/5G et durée de fonctionnement si la passerelle répond sans compte ; avec lui : nombre d'appareils et Wi-Fi s'ajoutent.",
             "Un compte refusé arrête la lecture : MyServices ne réessaie pas tant que les réglages ne changent pas.",
             "Les passerelles Nokia ont une autre interface et ne sont pas gérées. Non testé sur matériel.")

    def fetch(self, path: str, token: str = "", body: dict | None = None):
        """One call of the local API (POST when a body is given); the token goes in a Bearer header, never in a message."""
        return self.ctx.http(f"{self.base_url()}/TMI/v1/{path}", method="GET" if body is None else "POST", body=body,
                             headers={"Authorization": f"Bearer {token}"} if token else None)

    def fingerprint(self) -> str:
        return hashlib.sha256(str(self.conf.get("password", "")).encode()).hexdigest()

    def login(self, base: str) -> str:
        """The token. One attempt only."""
        form = {USER_KEY: str(self.conf.get("username") or "admin"), PASS_FIELD: str(self.conf.get("password", ""))}
        try:
            answer = self.fetch(LOGIN_PATH, body=form)
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith(("HTTP 400", "HTTP 401", "HTTP 403")):
                REFUSED_BY[base] = self.fingerprint()
                raise Refused(REFUSED) from None
            raise ConnectorError(NOT_TMOBILE if str(e).startswith("HTTP 404") else str(e)) from None
        auth = answer.get("auth") if isinstance(answer, dict) else None
        token = auth.get("token") if isinstance(auth, dict) else None
        if not token:
            if isinstance(answer, dict) and "result" in answer:
                REFUSED_BY[base] = self.fingerprint()
                raise Refused(REFUSED)
            raise ConnectorError(UNREADABLE)
        return str(token)

    def collect(self) -> dict:
        base = self.base_url()
        token = ""
        if str(self.conf.get("password", "")):
            if REFUSED_BY.get(base) == self.fingerprint():
                raise ConnectorError(REFUSED)
            token = self.login(base)
            REFUSED_BY.pop(base, None)
        try:
            gw = self.fetch(GATEWAY_PATH, token)
        except RateLimited:
            raise
        except ConnectorError as e:
            code = str(e)[:8]
            raise ConnectorError(NEEDS_LOGIN if code in ("HTTP 401", "HTTP 403") else NOT_TMOBILE if code == "HTTP 404" else str(e)) from None
        if not isinstance(gw, dict) or not isinstance(gw.get("device"), dict):
            raise ConnectorError(NEEDS_LOGIN if isinstance(gw, dict) and "result" in gw else UNREADABLE)
        devices = wifi = None
        if token:
            for path in (CLIENTS_PATH, AP_PATH):
                try:
                    data = self.fetch(path, token)
                except RateLimited:
                    raise
                except ConnectorError:
                    continue   # extra pages: absent on some firmwares, never an error
                if path == CLIENTS_PATH:
                    devices = count_clients(data)
                else:
                    wifi = wifi_on(data)
        device, signal = gw["device"], gw.get("signal") if isinstance(gw.get("signal"), dict) else {}
        registration = str((signal.get("generic") or {}).get("registration") or "").lower() if isinstance(signal.get("generic"), dict) else ""
        uptime = num((gw.get("time") or {}).get("upTime")) if isinstance(gw.get("time"), dict) else None
        card = box_card(Box(
            model=str(device.get("model") or device.get("friendlyName") or "") or None, line="mobile",
            connected=None if not registration else registration == "registered",
            uptime_s=int(uptime) if uptime is not None and uptime >= 0 else None,
            firmware=str(device.get("softwareVersion") or "") or None, devices=devices, wifi=wifi))
        radio = [f for f in (signal_fact("5G", signal.get("5g")), signal_fact("4G", signal.get("4g"))) if f]
        card["facts"] = (card["facts"] + radio)[:MAX_FACTS]
        return card
