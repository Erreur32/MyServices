"""Bouygues Telecom Bbox, read by the local API of the box (/api/v1/…, JSON). Read-only. Since the firmware 23.7.8 the box asks its password: POST /api/v1/login (form,
`password`) answers a session cookie (BBOX_ID) that the next calls carry. Context.http keeps no cookie and gives no answer header, so this connector holds its own cookie
jar (urllib only, no dependency). A box that has no login route (an old firmware) is read without one. The box locks an address that tries a wrong password again and
again, so a refused login stops the reading at its first call and the password never appears in a message.
Written from the bboxpy and aiobbox libraries, not tested on a real box: the units of the rates and the Wi-Fi answer are not confirmed.
"""
from __future__ import annotations

import http.cookiejar
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num
from connectors.upnp_box import positive

MAX_ANSWER = 2_000_000
LINES = (("ftth", "fibre"), ("vdsl", "dsl"), ("adsl", "dsl"))   # the flags of device.using


def dig(data, *path):
    """A value of a nested answer, None when a step is missing or is not what is expected."""
    for key in path:
        data = data.get(key) if isinstance(data, dict) else None
    return data


def first(answer) -> dict:
    """The box answers a list of one object."""
    answer = answer[0] if isinstance(answer, list) and answer else answer
    return answer if isinstance(answer, dict) else {}


def kbit(v, zero: bool = False) -> int | None:
    """shortcut: the rates of /wan/ip/stats are taken as kbit/s (bboxpy docs), to confirm on a real box. zero: 0 is a real current rate, not an absent figure."""
    n = num(v) if zero else positive(v)
    return None if n is None else round(n * 1000)


def line_of(using) -> str | None:
    return next((name for flag, name in LINES if isinstance(using, dict) and using.get(flag) in (True, 1, "1")), None)


def wifi_state(wireless: dict) -> bool | None:
    """On when one radio is on; None when the box does not say."""
    radios = dig(wireless, "wireless", "radio")
    states = [r.get("enable", r.get("state")) for r in radios.values() if isinstance(r, dict)] if isinstance(radios, dict) else []
    known = [s for s in states if s in (0, 1, "0", "1", True, False)]
    return any(s in (1, "1", True) for s in known) if known else None


class BouyguesBbox(StatusConnector):
    type = "bbox"
    label = "Bbox Bouygues"
    fields = (
        Field("url", "Adresse de la Bbox", "url", required=True, default="http://192.168.1.254", help="http://192.168.1.254 ou https://mabbox.bytel.fr (si ce nom se résout depuis le serveur)."),
        Field("password", "Mot de passe", "password", secret=True, help="Le mot de passe de l'interface de la Bbox (obligatoire depuis le firmware 23.7.8)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Donne l'adresse de la Bbox (souvent http://192.168.1.254) et le mot de passe qui ouvre son interface web : depuis le firmware 23.7.8, la box le demande.",
             "MyServices ne fait que lire. Un mauvais mot de passe bloque la box un moment : teste d'abord le mot de passe dans l'interface de la box.",
             "La box ne donne pas la température ni la durée de connexion : ces informations ne sont pas montrées.")
    _opener = None

    def opener(self):
        if self._opener is None:
            context = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.HTTPSHandler(context=context))
        return self._opener

    def fetch(self, path: str, form: dict | None = None):
        """The JSON answer of a route, with the session cookie; ConnectorError (HTTP code only) otherwise."""
        base = self.base_url()
        req = urllib.request.Request(f"{base}/api/v1/{path}", data=urllib.parse.urlencode(form).encode() if form else None, method="POST" if form else "GET",
                                     headers={"Accept": "application/json", "User-Agent": "myservices", "Referer": base, "Origin": base})
        try:
            with self.opener().open(req, timeout=getattr(self.ctx, "timeout", 15)) as r:
                raw = r.read(MAX_ANSWER)
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 429:
                raise RateLimited("HTTP 429", None) from None
            raise ConnectorError(f"HTTP {e.code}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
        try:
            return json.loads(raw or b"null")
        except ValueError:
            raise ConnectorError("réponse qui n'est pas du JSON") from None

    def login(self) -> None:
        password = str(self.conf.get("password") or "")
        if not password:
            raise ConnectorError("mot de passe attendu : la Bbox le demande depuis le firmware 23.7.8")
        try:
            self.fetch("login", {"password": password, "remember": "1"})
        except RateLimited:
            raise ConnectorError("la Bbox limite les connexions : attends quelques minutes avant de réessayer") from None
        except ConnectorError as e:
            if str(e) == "HTTP 404":
                return   # an old firmware without login
            if str(e).startswith("HTTP 40"):
                raise ConnectorError("mot de passe refusé par la Bbox : vérifie-le dans son interface (trop d'essais ratés la bloquent)") from None
            raise

    def read(self, path: str, optional: bool = True) -> dict:
        try:
            return first(self.fetch(path))
        except RateLimited:
            raise ConnectorError("la Bbox limite les appels : attends quelques minutes avant de réessayer") from None
        except ConnectorError as e:
            if str(e).startswith("HTTP 401"):
                raise ConnectorError("session refusée par la Bbox : vérifie le mot de passe") from None
            if optional:
                return {}
            raise

    def collect(self) -> dict:
        self.login()   # a refused login stops here, before any other call
        device = self.read("device", optional=False)
        wan, stats = self.read("wan/ip"), self.read("wan/ip/stats")
        hosts = dig(self.read("hosts"), "hosts", "list")
        info = device.get("device") if isinstance(device.get("device"), dict) else {}
        if not info:
            raise ConnectorError("la Bbox répond, mais pas comme une Bbox : vérifie l'adresse")
        state = dig(wan, "wan", "ip", "state")
        rx, tx = dig(stats, "wan", "ip", "stats", "rx"), dig(stats, "wan", "ip", "stats", "tx")
        return box_card(Box(
            model=info.get("modelname") or None, line=line_of(info.get("using")), connected=(str(state).lower() == "up") if state else None,
            down_bps=kbit(dig(rx, "bandwidth"), True), up_bps=kbit(dig(tx, "bandwidth"), True),
            line_down_bps=kbit(dig(rx, "maxBandwidth")), line_up_bps=kbit(dig(tx, "maxBandwidth")),
            public_ip=public_address(dig(wan, "wan", "ip", "address")), firmware=dig(info, "main", "version") or None,
            devices=sum(1 for h in hosts if isinstance(h, dict) and h.get("active") in (True, 1, "1")) if isinstance(hosts, list) else None,
            wifi=wifi_state(self.read("wireless"))))
