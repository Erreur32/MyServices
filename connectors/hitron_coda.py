"""Hitron CODA (CODA-4x, CODA-5x cable modems and gateways of Rogers, Videotron, Cogeco, Eastlink, Cox, Optimum, Mediacom), read by the JSON pages of its web
interface (/data/*.asp). Read-only: only GET pages, the login and the logout are sent. Written from the hitron-exporter project (cfstras) and the Home Assistant
hitron_coda tracker, not tested on a real box.

Login: POST /goform/login answers « success » and sets the cookie « userid ». The form field names differ by provider and firmware (usr/pwd in the exporter,
user/pws or user/pwd in Home Assistant), so one single post carries all of them. The box locks an address after failed logins (« LoginProtect=n|min|s »): a refused
login is remembered in memory (address and a hash of the password, never the password) and not repeated until the settings change; no retry.
The session cookie needs the response headers, which Context.http does not give, so this connector keeps its own urllib opener with a cookie jar (like speedport.py).

Read: getSysInfo (firmware, WAN address, uptime), getCMInit (DOCSIS registration), dsinfo / usinfo (channels, power, SNR, into the facts), getConnectInfo (devices).
Not read: subscription rates (not on any page known), Wi-Fi state, temperature, current traffic (the counters are texts like « 815.00M Bytes »).
The uptime is the one of the modem. In bridge mode the WAN address is private and is not shown.
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import MAX_FACTS, StatusConnector, fact, num, rows

MAX_BYTES = 2_000_000
LOGIN_PATH = "goform/login"
LOGOUT_PATH = "goform/logout"
LOGIN_OK = "success"
LOGIN_LOCK = "LoginProtect="
SESSION_COOKIE = "userid"
USER_KEYS = ("usr", "user")   # form field names seen on the firmwares
SECRET_KEYS = ("pwd", "pws")
REFUSED = "identifiants refusés par le modem Hitron : vérifie l'utilisateur et le mot de passe (MyServices ne réessaie pas tant que les réglages ne changent pas)"
LOCKED = "le modem Hitron a bloqué la connexion un moment après des essais ratés : attends quelques minutes puis réessaie"
NOT_HITRON = "cet appareil ne ressemble pas à un modem Hitron CODA (pas de page /goform/login)"
UNREADABLE = "réponse illisible du modem Hitron (format non géré)"
SESSION_LOST = "le modem Hitron a fermé la session ou refuse la lecture : réessaie"
UPTIME_WORDS = {"day": 86400, "hour": 3600, "minute": 60, "second": 1}
# Memory of the process: address -> fingerprint of the password the box refused.
REFUSED_BY: dict[str, str] = {}


class Refused(ConnectorError):
    """The box does not accept these credentials."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def seconds_of(text) -> int | None:
    """« 04 Days,22 Hours,23 Minutes,48 Seconds » as seconds; None when no part is found."""
    found = re.findall(r"(\d+)\s*(day|hour|minute|second)", str(text or "").lower())
    return sum(int(n) * UPTIME_WORDS[w] for n, w in found) if found else None


def address_of(text) -> str | None:
    """The public address of « 84.12.34.56/21 » (mask dropped); None for a private or missing one."""
    return public_address(str(text or "").split("/")[0])


def signal_facts(down: list[dict], up: list[dict]) -> list[dict]:
    """Locked channels, mean power and worst SNR of the downstream, locked channels and mean power of the upstream."""
    out = []
    ds = [(num(r.get("signalStrength")), num(r.get("snr"))) for r in down]
    ds = [(p, s) for p, s in ds if p is not None]
    if ds:
        snrs = [s for _, s in ds if s is not None and s > 0]
        text = f"{len(ds)} canaux, {sum(p for p, _ in ds) / len(ds):.1f} dBmV".replace(".", ",")
        out.append(fact("Signal descendant", text + (f", SNR min {min(snrs):.0f} dB" if snrs else "")))
    us = [p for p in (num(r.get("signalStrength")) for r in up) if p is not None]
    if us:
        out.append(fact("Signal montant", f"{len(us)} canaux, {sum(us) / len(us):.1f} dBmV".replace(".", ",")))
    return out


class HitronCoda(StatusConnector):
    type = "hitron-coda"
    label = "Hitron CODA"
    fields = (
        Field("url", "Adresse du modem Hitron", "url", required=True, default="http://192.168.0.1", help="L'adresse de son interface web : http://192.168.0.1, ou http://192.168.100.1 en mode pont."),
        Field("username", "Utilisateur", "text", required=True, default="cusadmin", help="Le compte de l'interface web, souvent « cusadmin »."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Celui de l'interface web (souvent imprimé sous le modem, ou le mot de passe Wi-Fi par défaut)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé du modem"),
    )
    guide = ("Donne l'adresse du modem (http://192.168.0.1, ou http://192.168.100.1 s'il est en mode pont) et le compte de son interface web : MyServices lit son état comme les pages d'état, sans rien modifier.",
             "MyServices montre le firmware, l'état de l'enregistrement DOCSIS, l'adresse IP publique, la durée de fonctionnement, le nombre d'appareils et les niveaux de signal du câble (canaux, puissance, SNR). Les débits de l'abonnement ne sont pas lus.",
             "Des identifiants refusés arrêtent la lecture : le modem bloque un moment une adresse qui échoue, MyServices ne réessaie pas tant que les réglages ne changent pas.",
             "Modèles visés : Hitron CODA-4x et CODA-5x de Rogers, Vidéotron (Helix), Cogeco, Eastlink, Cox, Optimum, Mediacom. Non testé sur matériel.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            self._jar = http.cookiejar.CookieJar()
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar), urllib.request.HTTPSHandler(context=tls), NoRedirect())
        return self._op

    def cookie(self, name: str) -> str:
        return next((c.value or "" for c in getattr(self, "_jar", []) if c.name == name), "")

    def fetch(self, path: str, form: list[tuple[str, str]] | None = None) -> bytes:
        """One call of the session (POST when a form is given). ConnectorError « HTTP n » for an error status; never the credentials in a message."""
        data = None if form is None else urllib.parse.urlencode(form).encode()
        headers = {"Content-Type": "application/x-www-form-urlencoded"} if form is not None else {}
        req = urllib.request.Request(f"{self.base_url()}/{path}", data=data, headers=headers, method="GET" if form is None else "POST")
        try:
            with self.opener().open(req, timeout=self.ctx.timeout) as r:
                return r.read(MAX_BYTES)
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 429:
                raise RateLimited(f"HTTP {e.code}") from None
            raise ConnectorError(f"HTTP {e.code}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None

    def fingerprint(self) -> str:
        return hashlib.sha256(f"{self.conf.get('username', '')}:{self.conf.get('password', '')}".encode()).hexdigest()

    def login(self, base: str) -> None:
        """One attempt only. Raises Refused or LOCKED; never the credentials."""
        try:
            self.fetch("index.html")   # hands out the « preSession » cookie some firmwares want in the post
        except RateLimited:
            raise
        except ConnectorError:
            pass   # a box without that page may still take the post
        user, secret = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        form = [(k, user) for k in USER_KEYS] + [(k, secret) for k in SECRET_KEYS] + [("preSession", self.cookie("preSession"))]
        try:
            answer = self.fetch(LOGIN_PATH, form).decode("utf-8", "replace").strip()
        except ConnectorError as e:
            if str(e) == "HTTP 404":
                raise ConnectorError(NOT_HITRON) from None
            raise
        if LOGIN_LOCK in answer:
            raise ConnectorError(LOCKED)
        if answer != LOGIN_OK and not self.cookie(SESSION_COOKIE):
            REFUSED_BY[base] = self.fingerprint()
            raise Refused(REFUSED)

    def logout(self) -> None:
        try:
            self.fetch(LOGOUT_PATH, [("data", "byebye")])
        except ConnectorError:
            pass   # the session times out by itself

    def page(self, name: str, optional: bool = False) -> list[dict]:
        """The rows of /data/<name>.asp; [] for an optional page the box lacks or does not give."""
        try:
            text = self.fetch(f"data/{name}.asp").decode("utf-8", "replace")
            value = json.loads(text)
        except RateLimited:
            raise
        except ConnectorError as e:
            if optional and str(e) != "HTTP 302":
                return []
            raise ConnectorError(SESSION_LOST if str(e) in ("HTTP 302", "HTTP 401", "HTTP 403") else str(e)) from None
        except ValueError:
            if optional:
                return []
            raise ConnectorError(SESSION_LOST if text.lstrip()[:1] == "<" else UNREADABLE) from None
        return rows(value)

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        self.login(base)
        REFUSED_BY.pop(base, None)
        try:
            info = (self.page("getSysInfo") or [{}])[0]
            init = (self.page("getCMInit", optional=True) or [{}])[0]
            down, up = self.page("dsinfo", optional=True), self.page("usinfo", optional=True)
            hosts = self.page("getConnectInfo", optional=True)
        finally:
            self.logout()
        if not info:
            raise ConnectorError(UNREADABLE)
        registered = init.get("registration") or init.get("networkAccess")
        connected = None if not registered else str(init.get("registration", "Success")).lower() == "success" and str(init.get("networkAccess", "Permitted")).lower() == "permitted"
        card = box_card(Box(
            model="Hitron CODA", line="cable", connected=connected, public_ip=address_of(info.get("wanIp")), uptime_s=seconds_of(info.get("systemUptime")),
            firmware=str(info.get("swVersion") or "") or None, devices=sum(1 for h in hosts if str(h.get("online", "")).lower() == "active") if hosts else None))
        card["facts"] = (card["facts"] + signal_facts(down, up))[:MAX_FACTS]
        return card
