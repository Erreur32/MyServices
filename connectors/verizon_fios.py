"""Verizon Fios routers, read by the web interface they serve. Read-only: only GET pages, the login and the logout are sent.
Written from the quantum-gateway library (cisasteelersfan, the one behind the Home Assistant « quantum_gateway » integration) and verizon-router-client (Brishen,
CR1000A), not tested on a real box. Two families, told apart by the page loginStatus.cgi (404 on the G1100):

* Fios Router G3100 and CR1000A (Askey/Arris, LuCI): GET loginStatus.cgi gives a loginToken; POST login.cgi with luci_username = sha512(md5(« admin »)) and
  luci_password = sha512(loginToken + sha512(md5(password))); the session is the cookie. cgi/cgi_status.js (addROD records) gives the uptime and the WAN addresses,
  cgi/cgi_owl.js the known devices (activity 1 = connected). The session is closed with logout.cgi (the box limits the number of sessions).
* Quantum Gateway G1100 (Actiontec): GET api/login gives passwordSalt; POST api/login with sha512(password + salt); the XSRF-TOKEN cookie is sent back in the
  X-XSRF-TOKEN header. Only api/devices is documented: connected devices count. The rest stays None.

The box blocks an address that fails the login: a refused login is remembered in memory (address and a hash of the password, never the password) and is not repeated
until the settings change; no retry. Session cookies need the response headers, which Context.http does not give, so this connector keeps its own urllib opener with a
cookie jar (like speedport.py); those calls are not in the request counters.
Not read: model and firmware (no known page), current traffic, temperature. Uncertain: whether « uptime » is the router's or the connection's.
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
from connectors.status_kit import StatusConnector, num

MAX_BYTES = 2_000_000
ADMIN = "admin"   # the fixed account of the G3100 family
FORM_ACCOUNT, FORM_PASS, FORM_NONCE = "luci_username", "luci_password", "luci_token"   # protocol words of the login form, not credentials
JSON_PASS = "password"   # key of the G1100 login body
REFUSED = "mot de passe refusé par le routeur Fios : vérifie le mot de passe de l'appareil (MyServices ne réessaie pas tant que les réglages ne changent pas)"
SESSIONS_FULL = "le routeur Fios a atteint son nombre maximal de sessions ouvertes : ferme celles de l'interface web puis réessaie"
UNREADABLE = "réponse illisible du routeur Fios (format non géré)"
# Memory of the process: address -> fingerprint of the password the box refused.
REFUSED_BY: dict[str, str] = {}
ROD = re.compile(r'addROD\("(?P<key>[^"]+)",\s*(?P<val>.*?)\);\s*', re.DOTALL)


class Refused(ConnectorError):
    """The box does not accept this password."""


class HttpStatus(ConnectorError):
    """An HTTP error status; the body is kept for the callers, never put in the message."""

    def __init__(self, code: int, body: bytes = b""):
        super().__init__(f"HTTP {code}")
        self.code, self.body = code, body


def md5_sha512(text: str) -> str:
    """The box's browser code hashes the low 8 bits of each character."""
    raw = bytes(ord(c) & 0xFF for c in text)
    return hashlib.sha512(hashlib.md5(raw).hexdigest().encode()).hexdigest()


def luci_password(password: str, token: str) -> str:
    inner = md5_sha512(password)
    return hashlib.sha512((token + inner).encode()).hexdigest() if token else inner


def js_records(text: str) -> dict:
    """addROD("key", value); records as a dict; a quoted value loses its quotes, a number stays a string."""
    out: dict = {}
    for m in ROD.finditer(text or ""):
        value = m["val"].strip()
        out[m["key"]] = value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'" else value
    return out


def known_devices(text: str) -> int | None:
    """Number of devices with activity 1 in the known_device_list record; None when the page has none or it does not parse."""
    start = (text or "").find('addROD("known_device_list",')
    brace = text.find("{", start) if start >= 0 else -1
    if brace < 0:
        return None
    try:
        data, _ = json.JSONDecoder().raw_decode(text[brace:])
    except ValueError:
        return None
    rows = data.get("known_devices") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return None
    return sum(1 for d in rows if isinstance(d, dict) and str(d.get("activity")) == "1")


def g1100_devices(raw: bytes) -> int | None:
    try:
        rows = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        raise ConnectorError(UNREADABLE) from None
    if not isinstance(rows, list):
        raise ConnectorError(UNREADABLE)
    return sum(1 for d in rows if isinstance(d, dict) and d.get("status"))


def seconds(value) -> int | None:
    n = num(value)
    return int(n) if n is not None and n >= 0 else None


class VerizonFios(StatusConnector):
    type = "verizon-fios"
    label = "Verizon Fios Router"
    fields = (
        Field("url", "Adresse du routeur", "url", required=True, default="https://192.168.1.1", help="L'adresse de son interface web : https://192.168.1.1 (G3100, CR1000A) ou https://myfiosgateway.com (G1100)."),
        Field("password", "Mot de passe de l'appareil", "password", secret=True, required=True, help="Celui de l'interface web (souvent imprimé sous le routeur). MyServices ne l'utilise que pour lire."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="Le routeur présente un certificat auto-signé : à cocher seulement si tu en as installé un valable."),
    )
    guide = ("Donne l'adresse du routeur Fios (https://192.168.1.1, ou https://myfiosgateway.com pour le G1100) et son mot de passe : MyServices lit l'état comme l'interface web, sans rien modifier.",
             "G3100 et CR1000A : adresse IP publique, durée et appareils connectés. G1100 : nombre d'appareils connectés seulement.",
             "Un mot de passe refusé arrête la lecture : le routeur bloque un moment une adresse qui échoue, MyServices ne réessaie pas tant que les réglages ne changent pas.",
             "Non testé sur matériel.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            self._jar = http.cookiejar.CookieJar()
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar), urllib.request.HTTPSHandler(context=tls))
        return self._op

    def cookie(self, name: str) -> str | None:
        self.opener()
        return next((c.value for c in self._jar if c.name == name), None)

    def fetch(self, path: str, body: bytes | None = None, headers: dict | None = None) -> bytes:
        """One call of the session (POST when a body is given). HttpStatus for an error status; never the credentials in a message."""
        req = urllib.request.Request(f"{self.base_url()}/{path}", data=body, headers=headers or {}, method="GET" if body is None else "POST")
        try:
            with self.opener().open(req, timeout=self.ctx.timeout) as r:
                return r.read(MAX_BYTES)
        except urllib.error.HTTPError as e:
            try:
                data = e.read(4096)
            except OSError:
                data = b""
            e.close()
            if e.code == 429:
                raise RateLimited(f"HTTP {e.code}") from None
            raise HttpStatus(e.code, data) from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None

    def fingerprint(self) -> str:
        return hashlib.sha256(str(self.conf.get("password", "")).encode()).hexdigest()

    def refuse(self, base: str):
        REFUSED_BY[base] = self.fingerprint()
        raise Refused(REFUSED)

    def json_page(self, path: str) -> dict:
        try:
            data = json.loads(self.fetch(path).decode("utf-8", "replace"))
        except ValueError:
            raise ConnectorError(UNREADABLE) from None
        if not isinstance(data, dict):
            raise ConnectorError(UNREADABLE)
        return data

    def collect_g3100(self, base: str, status: dict) -> Box:
        token = str(status.get("loginToken") or "")
        password = str(self.conf.get("password", ""))
        form = {FORM_ACCOUNT: md5_sha512(ADMIN), FORM_PASS: luci_password(password, token), "luci_view": "Mobile", "luci_keep_login": "0"}
        if token:
            form[FORM_NONCE] = token
        try:
            self.fetch("login.cgi", urllib.parse.urlencode(form).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
        except HttpStatus as e:
            if e.code == 403:
                try:
                    full = json.loads(e.body.decode("utf-8", "replace")).get("flag") == 2
                except (ValueError, AttributeError):
                    full = False
                if full:
                    raise ConnectorError(SESSIONS_FULL) from None
                self.refuse(base)
            raise
        after = self.json_page("loginStatus.cgi")
        if str(after.get("islogin")) != "1":
            self.refuse(base)
        REFUSED_BY.pop(base, None)
        try:
            rod = js_records(self.fetch("cgi/cgi_status.js").decode("utf-8", "replace"))
            devices = None
            try:
                devices = known_devices(self.fetch("cgi/cgi_owl.js").decode("utf-8", "replace"))
            except HttpStatus:
                pass   # the device list is a bonus
        finally:
            try:
                self.fetch("logout.cgi", urllib.parse.urlencode({"token": after.get("token", "")}).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
            except ConnectorError:
                pass   # the session times out by itself
        public = public_address(rod.get("get_wan4_ip"))
        return Box(model="Fios Router G3100 / CR1000A", line="fibre", public_ip=public, uptime_s=seconds(rod.get("uptime")), devices=devices)

    def collect_g1100(self, base: str) -> Box:
        salt = str(self.json_page("api/login").get("passwordSalt") or "")
        if not salt:
            raise ConnectorError(UNREADABLE)
        proof = hashlib.sha512((str(self.conf.get("password", "")) + salt).encode()).hexdigest()
        try:
            self.fetch("api/login", json.dumps({JSON_PASS: proof}).encode(), {"Content-Type": "application/json"})
        except HttpStatus as e:
            if e.code in (401, 403):
                self.refuse(base)
            raise
        xsrf = self.cookie("XSRF-TOKEN")
        if not xsrf:
            self.refuse(base)
        try:
            raw = self.fetch("api/devices", headers={"X-XSRF-TOKEN": xsrf})
        except HttpStatus as e:
            if e.code in (401, 403):
                self.refuse(base)
            raise
        REFUSED_BY.pop(base, None)
        return Box(model="Fios Quantum Gateway G1100", line="fibre", devices=g1100_devices(raw))

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        try:
            status = self.json_page("loginStatus.cgi")
        except HttpStatus as e:
            if e.code != 404:
                raise
            return box_card(self.collect_g1100(base))   # the G1100 has no loginStatus.cgi
        if "loginToken" not in status:
            raise ConnectorError(UNREADABLE)
        return box_card(self.collect_g3100(base, status))
