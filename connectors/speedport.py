"""Telekom Speedport (Smart 3/4, Pro, W 724V, Neo), read by the JSON pages of its web interface (data/*.json). Read-only: only GET pages and the login are sent.
Written from the speedport-api library (Andre0512), not tested on a real box.

Pages are lists of {varid, varvalue} records, plain on the older firmwares and AES-CCM encrypted (hex of ciphertext + 16-byte tag, nonce = the first 8 bytes of the key)
on the recent ones. Status.json (model, firmware, DSL rates, online state, Wi-Fi) is read WITHOUT any account, plain or decrypted with the key every box shares.
With a password the connector also logs in (challenge, then sha256 of « challenge:password », the challenge being the key of the session) to read IPData.json
(public address) and DeviceList.json (connected devices). Without a password those two stay None.

The box locks an address that fails the login: a refused login is remembered in memory (address and a hash of the password, never the password) and is not repeated
until the settings change; no retry, also not when the box announces a short lock. The session cookie needs the response headers, which Context.http does not give,
so this connector keeps its own urllib opener with a cookie jar (like vodafone_station.py); those calls are not in the request counters.
Not read: current traffic (the unit of inet_download is not documented), hybrid (DSL + LTE) detection, temperature. The uptime is the one of the Internet connection.
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

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESCCM

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num

MAX_BYTES = 2_000_000
# The key every Speedport uses for what is read before the login (published by the library, not a secret).
SHARED_KEY = "cdc0cac1280b516e674f0057e4929bca84447cca8425007e33a88a5cf598a190"
LOGIN_PAGE = "html/login/index.html"   # carries the « httoken » the posts need
LOGIN_OK = "success"
FORM_ASK_CHALLENGE = "getChallenge=1"
FORM_LOGIN_PREFIX = "showpw=0&password="   # protocol words of the login form, not a credential
REFUSED = "mot de passe refusé par le Speedport : vérifie le mot de passe de l'appareil (MyServices ne réessaie pas tant que les réglages ne changent pas)"
LOCKED = "le Speedport a bloqué la connexion un moment après des essais ratés : attends quelques minutes puis réessaie"
NOT_SPEEDPORT = "cet appareil ne ressemble pas à un Speedport (pas de page data/Status.json)"
UNREADABLE = "réponse illisible du Speedport (format ou chiffrement non géré)"
SESSION_LOST = "le Speedport a fermé la session : réessaie"
# Memory of the process: address -> fingerprint of the password the box refused.
REFUSED_BY: dict[str, str] = {}


class Refused(ConnectorError):
    """The box does not accept this password."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def seal(key: str, text: str) -> str:
    """Hex of ciphertext + tag, as the box expects its posts."""
    raw = bytes.fromhex(key)
    return AESCCM(raw, tag_length=16).encrypt(raw[:8], text.encode(), None).hex()


def unseal(key: str, hexa: str) -> bytes:
    raw = bytes.fromhex(key)
    return AESCCM(raw, tag_length=16).decrypt(raw[:8], bytes.fromhex(hexa), None)


def records(obj) -> dict:
    """[{varid, varvalue}, …] as a dict; a list value becomes a list of such dicts."""
    out: dict = {}
    for item in obj if isinstance(obj, list) else []:
        if not isinstance(item, dict) or "varid" not in item:
            continue
        value = item.get("varvalue")
        if isinstance(value, list):
            out.setdefault(item["varid"], []).append({s["varid"]: s.get("varvalue") for s in value if isinstance(s, dict) and "varid" in s})
        else:
            out[item["varid"]] = value
    return out


def decode(raw: bytes, *keys: str) -> dict:
    """A page, plain or encrypted with the first of the keys that opens it."""
    text = (raw or b"").decode("utf-8", "replace").strip()
    if text[:1] in ("[", "{"):
        try:
            return records(json.loads(text))
        except ValueError:
            raise ConnectorError(UNREADABLE) from None
    for key in keys:
        try:
            return records(json.loads(unseal(key, text)))
        except (ValueError, InvalidTag):
            continue   # not this key (bad hex, bad tag or bad JSON)
    raise ConnectorError(UNREADABLE)


def kbit(raw) -> int | None:
    n = num(raw)
    return int(n * 1000) if n and n > 0 else None


def online(state) -> bool | None:
    word = str(state or "").strip().lower()
    return True if word == "online" else False if word in ("offline", "disconnected") else None


def count_devices(page: dict) -> int | None:
    lists = [page[k] for k in ("addmdevice", "addmlandevice", "addmwlandevice", "addmwlan5device") if isinstance(page.get(k), list)]
    if not lists:
        return None
    seen = {d.get("mdevice_mac") or id(d) for rows in lists for d in rows if isinstance(d, dict) and str(d.get("mdevice_connected")) == "1"}
    return len(seen)


class Speedport(StatusConnector):
    type = "speedport"
    label = "Telekom Speedport"
    fields = (
        Field("url", "Adresse du Speedport", "url", required=True, default="http://speedport.ip", help="L'adresse de son interface web : http://speedport.ip ou http://192.168.2.1."),
        Field("password", "Mot de passe de l'appareil (facultatif)", "password", secret=True, help="Celui de l'interface web (souvent le code imprimé sous le Speedport). Sans lui : modèle, firmware, débits de ligne et Wi-Fi seulement ; avec lui : adresse IP publique et appareils en plus."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Donne l'adresse du Speedport (http://speedport.ip ou http://192.168.2.1) : MyServices lit son état comme la page d'accueil de l'interface, sans rien modifier.",
             "Le mot de passe est facultatif. Sans lui, MyServices montre le modèle, le firmware, les débits de ligne et le Wi-Fi ; avec lui, l'adresse IP publique et le nombre d'appareils s'ajoutent.",
             "Un mot de passe refusé arrête la lecture : le Speedport bloque un moment une adresse qui échoue, MyServices ne réessaie pas tant que les réglages ne changent pas.",
             "Modèles visés : Speedport Smart 3, Smart 4, Pro, W 724V, Neo. Non testé sur matériel.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.HTTPSHandler(context=tls), NoRedirect())
        return self._op

    def fetch(self, path: str, body: str | None = None, referer: str = "") -> bytes:
        """One call of the session (POST when a body is given). ConnectorError « HTTP n » for an error status; never the credentials in a message."""
        headers = {"Referer": f"{self.base_url()}/{referer}"} if referer else {}
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(f"{self.base_url()}/{path}", data=None if body is None else body.encode(), headers=headers, method="GET" if body is None else "POST")
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
        return hashlib.sha256(str(self.conf.get("password", "")).encode()).hexdigest()

    def token(self) -> str:
        """The « httoken » of the login page, appended to every post; empty when the page has none."""
        try:
            found = re.search(r"httoken = (\d+)", self.fetch(LOGIN_PAGE).decode("utf-8", "replace"))
        except RateLimited:
            raise
        except ConnectorError:
            return ""
        return found[1] if found else ""

    def post(self, path: str, form: str, key: str, token: str) -> dict:
        extra = f"&httoken={token}" if token else ""
        return decode(self.fetch(path, seal(key, form + extra), LOGIN_PAGE), key, SHARED_KEY)

    def login(self, base: str) -> str:
        """The session key (the challenge). One attempt only."""
        token = self.token()
        challenge = str(self.post("data/Login.json", FORM_ASK_CHALLENGE, SHARED_KEY, token).get("challenge") or "")
        try:
            bytes.fromhex(challenge)
            valid = len(challenge) in (32, 48, 64)
        except ValueError:
            valid = False
        if not valid:
            raise ConnectorError(UNREADABLE)
        proof = hashlib.sha256(f"{challenge}:{self.conf.get('password', '')}".encode()).hexdigest()
        answer = self.post("data/Login.json", FORM_LOGIN_PREFIX + proof, SHARED_KEY, token)
        if answer.get("login") != LOGIN_OK:
            if num(answer.get("login_locked"), 0):
                raise ConnectorError(LOCKED)
            REFUSED_BY[base] = self.fingerprint()
            raise Refused(REFUSED)
        return challenge

    def read(self, path: str, *keys: str, referer: str = "") -> dict:
        return decode(self.fetch(path, referer=referer), *keys, SHARED_KEY)

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        password = str(self.conf.get("password", ""))
        if password and REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        try:
            status = self.read("data/Status.json")
        except ConnectorError as e:
            raise ConnectorError(NOT_SPEEDPORT if str(e) in ("HTTP 404", "HTTP 403") else str(e)) from None
        public, devices = None, None
        if password:
            key = self.login(base)
            REFUSED_BY.pop(base, None)
            try:
                public = public_address(self.read("data/IPData.json", key, referer="html/content/internet/con_ipdata.html").get("public_ip_v4"))
                devices = count_devices(self.read("data/DeviceList.json", key))
            except RateLimited:
                raise
            except ConnectorError as e:
                if str(e) == "HTTP 401":
                    raise ConnectorError(SESSION_LOST) from None
                raise   # no logout page is known: the session times out by itself
        dsl_down, dsl_up = kbit(status.get("dsl_downstream")), kbit(status.get("dsl_upstream"))
        seconds = num(status.get("inet_uptime"))
        wlan = status.get("use_wlan")
        return box_card(Box(
            model=str(status.get("device_name") or "") or None, line="dsl" if dsl_down or dsl_up else None, connected=online(status.get("onlinestatus")),
            line_down_bps=dsl_down, line_up_bps=dsl_up, public_ip=public, uptime_s=int(seconds) if seconds is not None and seconds >= 0 else None,
            firmware=str(status.get("firmware_version") or "") or None, devices=devices, wifi=None if wlan in (None, "") else str(wlan) == "1"))
