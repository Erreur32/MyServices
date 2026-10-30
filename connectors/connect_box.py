"""Compal Connect Box (Vodafone Germany / Kabel Deutschland, Ziggo Connect Box, UPC Connect Box in Switzerland, Poland, Slovakia…), read by the XML web service of the box
(/xml/getter.xml, one « fun » number per page). Read-only: only getter pages, the login (fun 15) and the logout (fun 16) are sent.
Written from the connect-box library (the one of the Home Assistant upc_connect integration), not tested on a real box.

Protocol, as in the library: GET /common_page/login.html gives the `sessionToken` cookie; POST /xml/setter.xml (`token=…&fun=15&Username=NULL&Password=…`) logs in with the
password alone (no user name); every call then carries the token first and `fun` second in the form body, and every answer renews the token in the same cookie.
Read: fun 1 (software version), 144 (cable modem status and service flows: line rates), 2 (network access), 107 (WAN address), 123 (devices), 136 (temperature, °F).
No traffic counters, no uptime and no Wi-Fi state are known: those fields stay None. The box lets one user in at a time and blocks an address that tries a wrong password
again and again: a refused login is remembered in memory (by address and a hash of the password, never the password) and not repeated until the settings change.
The cookie needs the response headers, which Context.http does not give, so this connector keeps its own urllib opener with a cookie jar (like vodafone_station.py).
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import ssl
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num
from connectors.upnp_box import parse_xml

HEADERS = {"X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36"}
MAX_BYTES = 2_000_000
LOGIN_PAGE, GETTER, SETTER = "common_page/login.html", "xml/getter.xml", "xml/setter.xml"
FUN_SETTINGS, FUN_CM_INFO, FUN_WAN, FUN_DEVICES, FUN_TEMPERATURE, FUN_CM_STATUS = 1, 2, 107, 123, 136, 144
FUN_LOGIN, FUN_LOGOUT = 15, 16
NO_USER = "NULL"   # the value the box wants in the Username field: a protocol constant, not a secret
REFUSED = "mot de passe refusé par la Connect Box : vérifie-le dans son interface web (MyServices ne réessaie pas tant que les réglages ne changent pas, la box bloque après des essais ratés)"
LOCKED = "la Connect Box refuse la connexion pour l'instant (un autre utilisateur est connecté ou la box est verrouillée) : attends quelques minutes puis réessaie"
SESSION_LOST = "la Connect Box a fermé la session : réessaie"
UNKNOWN = "cet appareil ne ressemble pas à une Connect Box (pas de jeton de session) : vérifie l'adresse"
UNREADABLE = "réponse illisible de la Connect Box"
# Memory of the process: address -> fingerprint of the password the box refused.
REFUSED_BY: dict[str, str] = {}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):   # a redirect is the box saying « not logged »
        return None


def text_of(root, tag: str) -> str | None:
    el = root.find(f".//{tag}")
    return (el.text or "").strip() or None if el is not None else None


def celsius(fahrenheit) -> float | None:
    """The box gives °F as an integer; an absurd value is not a reading."""
    n = num(fahrenheit)
    c = None if n is None else (n - 32) * 5 / 9
    return round(c, 1) if c is not None and 0 <= c <= 150 else None


def link_up(access: str | None, provisioning: str | None) -> bool | None:
    """cm_network_access is « Allowed » or « Denied »; provisioning_st « Online » when the modem is ranged and provisioned."""
    if access:
        return access.strip().lower() == "allowed"
    if provisioning:
        return provisioning.strip().lower().startswith("online") or None
    return None


def flow_rates(root) -> tuple[int | None, int | None]:
    """Highest max traffic rate of the service flows per direction (1 down, 2 up). shortcut: taken as bit/s, to confirm on a real box."""
    best: dict[str, int] = {}
    for flow in root.iter("serviceflow"):
        rate = num(text_of(flow, "pMaxTrafficRate"))
        direction = text_of(flow, "direction")
        if direction in ("1", "2") and rate and rate > 0:
            best[direction] = max(best.get(direction, 0), int(rate))
    return best.get("1"), best.get("2")


class ConnectBox(StatusConnector):
    type = "connect-box"
    label = "Compal Connect Box"
    fields = (
        Field("url", "Adresse de la Connect Box", "url", required=True, default="http://192.168.0.1", help="L'adresse de son interface web, souvent http://192.168.0.1."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Le mot de passe de l'interface web de la box (pas d'utilisateur)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Donne l'adresse de la box (celle qui ouvre son interface web depuis le serveur) et le mot de passe de sa page de connexion : MyServices ne fait que lire.",
             "La box n'accepte qu'une session à la fois : si tu es connecté à son interface en même temps, MyServices est refusé. Une erreur de mot de passe peut bloquer la box un moment, MyServices ne réessaie pas.",
             "Vodafone Allemagne (Kabel Deutschland), Ziggo, UPC : la Connect Box donne l'état du câble, les débits de l'abonnement, l'adresse IP publique, le nombre d'appareils et la température.",
             "Elle ne donne ni le trafic en cours, ni la durée de connexion, ni l'état du Wi-Fi : ces informations ne sont pas montrées.")
    token = ""

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._jar = http.cookiejar.CookieJar()
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar), urllib.request.HTTPSHandler(context=tls), NoRedirect())
        return self._op

    def fetch(self, path: str, form: str | None = None) -> bytes:
        """One call of the session (GET, or POST of a raw form body); keeps the renewed token. ConnectorError « HTTP n » for an error status; never the password in a message."""
        base = self.base_url()
        req = urllib.request.Request(f"{base}/{path}", data=None if form is None else form.encode(), headers={**HEADERS, "Referer": f"{base}/index.html"}, method="GET" if form is None else "POST")
        try:
            with self.opener().open(req, timeout=self.ctx.timeout) as r:
                raw = r.read(MAX_BYTES)
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 429:
                raise RateLimited(f"HTTP {e.code}") from None
            raise ConnectorError(f"HTTP {e.code}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
        self.token = next((c.value for c in self._jar if c.name == "sessionToken"), self.token)
        return raw

    def page(self, fun: int):
        """The XML root of a getter page; the token goes first and « fun » second, the firmware answers an error otherwise."""
        return parse_xml(self.fetch(GETTER, f"token={self.token}&fun={fun}"))

    def optional(self, fun: int):
        """A page that may be absent on this firmware: None for any error but a lost session or a rate limit."""
        try:
            return self.page(fun)
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e) == "HTTP 401":
                raise
            return None

    def fingerprint(self) -> str:
        return hashlib.sha256(str(self.conf.get("password", "")).encode()).hexdigest()

    def login(self, base: str) -> None:
        password = str(self.conf.get("password") or "")
        if not password:
            raise ConnectorError("mot de passe attendu")
        self.token = ""
        self.fetch(LOGIN_PAGE)
        if not self.token:
            raise ConnectorError(UNKNOWN)
        try:
            body = self.fetch(SETTER, f"token={self.token}&fun={FUN_LOGIN}&Username={NO_USER}&Password={urllib.parse.quote(password, safe='')}")
        except RateLimited:
            raise ConnectorError(LOCKED) from None
        except ConnectorError as e:
            if str(e).startswith("HTTP") and str(e) not in ("HTTP 404", "HTTP 500", "HTTP 502", "HTTP 503"):
                REFUSED_BY[base] = self.fingerprint()
                raise ConnectorError(REFUSED) from None
            raise
        if b"incorrect" in body.lower():
            REFUSED_BY[base] = self.fingerprint()
            raise ConnectorError(REFUSED)
        if b"lockout" in body.lower():
            raise ConnectorError(LOCKED)

    def logout(self) -> None:
        try:
            self.fetch(SETTER, f"token={self.token}&fun={FUN_LOGOUT}")
        except ConnectorError:
            pass   # the session ends by itself; the reading is done

    def read(self) -> Box:
        settings = self.page(FUN_SETTINGS)   # the one required page: it says whether this is a Connect Box we are logged in to
        if settings.find(".//AccessLevel") is None and settings.find(".//SwVersion") is None:
            raise ConnectorError(UNKNOWN)
        status, info = self.optional(FUN_CM_STATUS), self.optional(FUN_CM_INFO)
        wan, devices, temp = self.optional(FUN_WAN), self.optional(FUN_DEVICES), self.optional(FUN_TEMPERATURE)
        down, up = flow_rates(status) if status is not None else (None, None)
        access = text_of(info, "cm_network_access") if info is not None else None
        access = access or (text_of(status, "cm_network_access") if status is not None else None)
        docsis = text_of(status, "cm_docsis_mode") if status is not None else None
        return Box(model=f"Connect Box ({docsis})" if docsis else "Connect Box", line="cable", connected=link_up(access, text_of(status, "provisioning_st") if status is not None else None),
                   line_down_bps=down, line_up_bps=up, public_ip=public_address(text_of(wan, "WanIP")) if wan is not None else None,
                   firmware=text_of(settings, "SwVersion") or (text_of(status, "FileName") if status is not None else None),
                   devices=None if devices is None else sum(1 for _ in devices.iter("MACAddr")), temperature=celsius(text_of(temp, "Temperature")) if temp is not None else None)

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        self.login(base)
        try:
            box = self.read()
        except ConnectorError as e:
            if str(e) == "HTTP 401":
                raise ConnectorError(SESSION_LOST) from None
            raise
        finally:
            self.logout()
        REFUSED_BY.pop(base, None)
        return box_card(box)
