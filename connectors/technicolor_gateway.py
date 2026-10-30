"""Technicolor / Vantiva gateways with the Homeware web interface (TG789, DJA0231, CGA…, sold by Vodafone UK/Spain/Portugal, Telenet, Proximus, Sky, MEO, NOS, TIM, Orange Spain…),
read by the pages of their web interface. Read-only: the login and GET pages only.

Written from the pytechnicolor library (the SRP-6 login: POST /authenticate with A, then M; the pages /modals/gateway-modal.lp, broadband-modal.lp, device-modal.lp, scraped by
their English labels) and a public scraper of the same pages. Not tested on a real box. The login is the SRP-6 of that library, with the standard library only (pow, hashlib):
N is the 2048-bit group of RFC 5054 with g = 2, H is SHA-256 and k is the fixed value the library found in the box (an SRP-6 box, not SRP-6a). The server proof is checked too.
Uncertain: the labels of the pages vary with the firmware (they are English), the order of the two line rates (upstream first, as in the library), the page of the public
address (modals/internet-modal.lp, optional), and the Wi-Fi state (not read). The old « login.lp » Technicolor firmwares without SRP are not handled.

The box locks an address that tries a wrong password again and again: a refused login stops the reading at its first call, is remembered in memory (address plus a hash of the
credentials, never the password) and is not repeated until the settings change. The session cookie needs the response headers, which Context.http does not give, so this
connector keeps its own urllib opener with a cookie jar (like vodafone_station.py); its calls are not in the request counters.
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector
from connectors.vodafone_station import link_up

HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0", "Accept-Language": "en-GB,en;q=0.5"}
MAX_BYTES = 2_000_000
AUTH_PATH = "authenticate"   # protocol word, not a secret
N_HEX = ("AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50E8083969EDB767B0CF60"
         "95179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF747359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B907"
         "8717461A5B9D32E688F87748544523B524B0D57D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DB"
         "FBB694B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73")
N, G = int(N_HEX, 16), 2
K = int("05b9e8ef059c6b32ea59fc1d322d37f04aa30bae5aa9003b8321e21ddb04e300", 16)   # fixed multiplier of the box, as in the library
REFUSED = "identifiants refusés par la passerelle Technicolor : vérifie l'utilisateur et le mot de passe dans son interface web (MyServices ne réessaie pas tant que les réglages ne changent pas)"
SESSION_LOST = "la passerelle Technicolor a fermé la session : réessaie"
UNKNOWN = "cet appareil ne ressemble pas à une passerelle Technicolor Homeware gérée (page de connexion avec jeton CSRF et /authenticate attendus)"
BAD_PROOF = "la passerelle Technicolor n'a pas confirmé la connexion (preuve SRP invalide) : firmware non géré ?"
# Memory of the process: address -> fingerprint of the credentials the box refused.
REFUSED_BY: dict[str, str] = {}


def raw(n: int) -> bytes:
    """Big-endian bytes without leading zeros, as the box computes them."""
    return n.to_bytes((n.bit_length() + 7) // 8, "big")


def h_int(*parts: int | str) -> int:
    d = hashlib.sha256()
    for p in parts:
        d.update(raw(p) if isinstance(p, int) else p.encode("latin-1", "replace"))
    return int.from_bytes(d.digest(), "big")


def srp_public(a: int) -> int:
    return pow(G, a, N)


def srp_proof(user: str, password: str, a: int, salt: bytes, server_b: bytes) -> tuple[bytes, bytes]:
    """(M, expected server proof) from the box challenge (salt, B); ConnectorError when B is degenerate."""
    big_a, s, b = srp_public(a), int.from_bytes(salt, "big"), int.from_bytes(server_b, "big")
    u = h_int(big_a, b)
    if b % N == 0 or u == 0:
        raise ConnectorError(BAD_PROOF)
    x = h_int(s, h_int(f"{user}:{password}"))
    key = hashlib.sha256(raw(pow(b - K * pow(G, x, N), a + u * x, N))).digest()
    xor = bytes(p ^ q for p, q in zip(hashlib.sha256(raw(N)).digest(), hashlib.sha256(raw(G)).digest()))
    m = hashlib.sha256(xor + hashlib.sha256(user.encode("latin-1", "replace")).digest() + raw(s) + raw(big_a) + raw(b) + key).digest()
    return m, hashlib.sha256(raw(big_a) + m + key).digest()


class Page(HTMLParser):
    """The text nodes of a page in order, and its CSRF token (the meta tag of the login page)."""

    def __init__(self, content: bytes):
        super().__init__(convert_charrefs=True)
        self.nodes: list[str] = []
        self.token = ""
        self._skip = 0
        self.feed(content.decode("utf-8", "replace"))

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name") == "CSRFtoken":
            self.token = a.get("content") or ""
        self._skip += tag in ("script", "style")

    def handle_endtag(self, tag):
        self._skip -= tag in ("script", "style") and self._skip > 0

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.nodes.append(" ".join(data.split()))

    def after(self, label: str, size: int = 8) -> list[str]:
        """The nodes that follow the first node worth `label` (case and trailing colon ignored); empty when the label is absent."""
        for i, n in enumerate(self.nodes):
            if n.lower().rstrip(": ") == label.lower():
                return self.nodes[i + 1:i + 1 + size]
        return []

    def value(self, *labels: str) -> str | None:
        return next((w[0] for w in map(self.after, labels) if w), None)

    def rates(self, label: str) -> tuple[int | None, int | None]:
        """(upstream, downstream) in bit/s of a « label  x Mbps  y Mbps » row."""
        found = re.findall(r"(\d+(?:\.\d+)?)\s*([KkMmGg])bps", " ".join(self.after(label)))[:2]
        bps = [round(float(v) * {"k": 1e3, "m": 1e6, "g": 1e9}[u.lower()]) for v, u in found]
        return (bps[0] if bps else None, bps[1] if len(bps) > 1 else None)


def uptime_of(text: str | None) -> int | None:
    """« 2 days 3 hours 4 minutes 5 seconds » or « 2d 3h… » or « 3:04:05 » in seconds."""
    if not text:
        return None
    units = re.findall(r"(\d+)\s*(d|h|m|s)", text.lower())
    if units:
        return sum(int(v) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[u] for v, u in units)
    clock = re.fullmatch(r"(?:(\d+):)?(\d+):(\d+)", text.strip())
    return int(clock[1] or 0) * 3600 + int(clock[2]) * 60 + int(clock[3]) if clock else None


class TechnicolorGateway(StatusConnector):
    type = "technicolor-gateway"
    label = "Passerelle Technicolor (Homeware)"
    fields = (
        Field("url", "Adresse de la passerelle", "url", required=True, default="http://192.168.0.1", help="L'adresse de son interface web, souvent http://192.168.0.1 ou http://192.168.1.1."),
        Field("username", "Utilisateur", "text", required=True, default="admin", help="Celui de la page de connexion de la passerelle (souvent « admin »)."),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Donne l'adresse de la passerelle (celle qui ouvre son interface web depuis le serveur) et le compte de sa page de connexion : MyServices ne fait que lire.",
             "Gérées : les passerelles Technicolor ou Vantiva à interface Homeware (TG789, DJA0231, CGA…) de Vodafone, Telenet, Proximus, Sky, MEO, NOS, TIM, Orange Espagne. Non testé sur matériel.",
             "Un mauvais mot de passe peut bloquer la passerelle un moment : MyServices ne réessaie pas, teste d'abord le mot de passe dans son interface.",
             "La passerelle ne donne ni les débits en cours, ni l'état du Wi-Fi : ces informations ne sont pas montrées. Les débits de ligne ne sont lus que sur une ligne DSL.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.HTTPSHandler(context=tls))
        return self._op

    def fetch(self, method: str, path: str, form: dict | None = None) -> bytes:
        """One call of the session. ConnectorError « HTTP n » for an error status; never the credentials in a message."""
        req = urllib.request.Request(f"{self.base_url()}/{path}", data=None if form is None else urllib.parse.urlencode(form).encode(), headers=HEADERS, method=method)
        try:
            with self.opener().open(req, timeout=self.ctx.timeout) as r:
                return r.read(MAX_BYTES)
        except urllib.error.HTTPError as e:
            e.close()
            raise (RateLimited(f"HTTP {e.code}") if e.code == 429 else ConnectorError(f"HTTP {e.code}")) from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None

    def fingerprint(self) -> str:
        return hashlib.sha256(f"{self.conf.get('username', '')}\0{self.conf.get('password', '')}".encode()).hexdigest()

    def refuse(self, base: str) -> ConnectorError:
        REFUSED_BY[base] = self.fingerprint()
        return ConnectorError(REFUSED)

    def step(self, base: str, form: dict) -> dict:
        """One POST of the SRP exchange; a refusal (error answer, 401/403) is remembered and stops everything."""
        try:
            answer = json.loads(self.fetch("POST", AUTH_PATH, form) or b"null")
        except ConnectorError as e:
            if str(e) in ("HTTP 401", "HTTP 403"):
                raise self.refuse(base) from None
            raise
        except ValueError:
            raise ConnectorError(UNKNOWN) from None
        if not isinstance(answer, dict):
            raise ConnectorError(UNKNOWN)
        if "error" in answer:
            raise self.refuse(base)
        return answer

    def login(self, base: str) -> None:
        token = Page(self.fetch("GET", "")).token
        if not token:
            raise ConnectorError(UNKNOWN)
        user, password = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        a = int.from_bytes(os.urandom(32), "big") | (1 << 255)
        try:
            first = self.step(base, {"CSRFtoken": token, "I": user, "A": raw(srp_public(a)).hex()})
            m, expected = srp_proof(user, password, a, bytes.fromhex(first["s"]), bytes.fromhex(first["B"]))
        except (KeyError, TypeError, ValueError):
            raise ConnectorError(UNKNOWN) from None
        last = self.step(base, {"CSRFtoken": token, "M": m.hex()})
        try:
            ok = bytes.fromhex(last["M"]) == expected
        except (KeyError, TypeError, ValueError):
            ok = False
        if not ok:
            raise ConnectorError(BAD_PROOF)

    def page(self, path: str, optional: bool = False) -> Page | None:
        try:
            page = Page(self.fetch("GET", f"modals/{path}"))
        except RateLimited:
            raise
        except ConnectorError:
            if optional:
                return None
            raise
        if page.token:   # the login page came back: no session
            raise ConnectorError(SESSION_LOST)
        return page

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        self.login(base)
        gateway = self.page("gateway-modal.lp")
        model = gateway.value("Product Name")
        if not model and not gateway.value("Software Version", "Firmware Version"):
            raise ConnectorError(UNKNOWN)
        dsl = self.page("broadband-modal.lp", optional=True)
        net = self.page("internet-modal.lp", optional=True)
        macs = set()
        for name in ("device-modal.lp", "ipv6devices-modal.lp"):
            devices = self.page(name, optional=True)
            macs = {m.lower() for m in re.findall(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", " ".join(devices.nodes))} if devices else set()
            if macs:
                break
        REFUSED_BY.pop(base, None)
        up, down = dsl.rates("Line Rate") if dsl else (None, None)
        status = dsl.value("DSL Status") if dsl else None
        kind = " ".join(filter(None, (dsl.value("DSL Mode"), dsl.value("DSL Type")))) if dsl else ""
        return box_card(Box(
            model=model, line="dsl" if "dsl" in kind.lower() else None, connected=link_up(status) if status else None, line_down_bps=down, line_up_bps=up,
            public_ip=public_address(net.value("WAN IP Address", "IP Address")) if net else None, uptime_s=uptime_of(dsl.value("DSL Uptime")) if dsl else None,
            firmware=gateway.value("Software Version", "Firmware Version"), devices=len(macs) if macs else None))
