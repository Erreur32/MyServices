"""Vodafone Station (Technicolor and Sercomm/Compal firmwares, cable boxes of Vodafone Germany, Spain, Portugal, Italy…), read by the web interface of the box:
a login with a hashed password, a session kept by cookie, then the JSON pages the interface itself reads. Read-only: nothing but GET pages and the login are sent.
Written from the aiovodafone library (the one of the Home Assistant integration), not tested on a real box.

Handled, as in the library, with the standard library only:
- Technicolor ("api/v1", the new interface): salt + PBKDF2-HMAC-SHA256 login, sta_status (model, firmware, uptime, WAN state) and host/hostTbl (devices).
- Sercomm ("data/*.json", the older Compal-like interface): HMAC-SHA256 login (or SHA256 with a challenge), user_data / overview (firmware, uptime, WAN state, devices).
NOT handled: Homeware (UK Ultra Hub, SRP-6 login) and the Ultra Hub web UI (AES-CCM login, which the standard library cannot do): they are recognised and refused with a clear
message. The Wi-Fi state of a Sercomm is an AES-CCM blob and the Technicolor gives none: wifi stays None. No traffic counters, no public address and no line rates are
offered by these pages: those fields stay None. The uptime is the one of the box, not of the connection.

The box lets one user in at a time and locks an address that tries a wrong password again and again: a refused login is remembered in memory (by address and a hash of the
credentials, never the password) and not repeated until the settings change. The session cookie needs the response headers, which Context.http does not give, so this
connector keeps its own urllib opener with a cookie jar (like dozzle.py); the calls are not in the request counters.
"""
from __future__ import annotations

import hashlib
import hmac
import http.cookiejar
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card
from connectors.status_kit import StatusConnector, num

HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0", "Accept-Language": "en-GB,en;q=0.5", "X-Requested-With": "XMLHttpRequest"}
MAX_BYTES = 2_000_000
TECHNICOLOR_BUSY = "MSG_LOGIN_150"   # the answer of a box that already has a session
DOWN_WORDS = ("down", "disconnect", "offline", "not ", "error", "fail")
UP_WORDS = ("operational", "connected", "up", "online")
SALT_REQUEST = "seeksalthash"   # the word the Technicolor login takes in place of the password to give its salt: a protocol constant, not a secret
REFUSED = "identifiants refusés par la Vodafone Station : vérifie l'utilisateur et le mot de passe dans son interface web (MyServices ne réessaie pas tant que les réglages ne changent pas)"
BUSY = "la Vodafone Station a déjà une session ouverte (un seul utilisateur à la fois) : ferme son interface web puis réessaie"
SESSION_LOST = "la Vodafone Station a fermé la session : réessaie"
UNSUPPORTED = "ce modèle de Vodafone Station (Homeware ou Ultra Hub) n'est pas géré : seules les interfaces Technicolor et Sercomm le sont"
UNKNOWN = "cet appareil ne ressemble pas à une Vodafone Station gérée (ni interface Technicolor, ni Sercomm)"
# Memory of the process: (address -> fingerprint of the credentials the box refused), (address -> Sercomm login variant that worked).
REFUSED_BY: dict[str, str] = {}
VARIANT: dict[str, bool] = {}


class Busy(ConnectorError):
    """Another session is open on the box."""


class Refused(ConnectorError):
    """The box does not accept these credentials."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):   # a redirect to the login page is the box saying « not logged »
        return None


def jload(raw: bytes):
    try:
        return json.loads(raw or b"null")
    except ValueError:
        raise ConnectorError("réponse illisible de la Vodafone Station") from None


def data_of(raw: bytes) -> dict:
    """The « data » object of a Technicolor answer."""
    obj = jload(raw)
    data = obj.get("data") if isinstance(obj, dict) else None
    if not isinstance(data, dict):
        raise ConnectorError("réponse inattendue de la Vodafone Station")
    return data


def flat(raw: bytes) -> dict:
    """A Sercomm page: an object, or a list of one-key objects (merged)."""
    obj = jload(raw)
    if isinstance(obj, list):
        return {k: v for item in obj if isinstance(item, dict) for k, v in item.items()}
    return obj if isinstance(obj, dict) else {}


def link_up(*states) -> bool | None:
    """True or False when the words of the box say so, None when they do not (the exact words of these firmwares are not documented)."""
    words = [str(s).strip().lower() for s in states if s not in (None, "")]
    if not words:
        return None
    if any(d in w for w in words for d in DOWN_WORDS):
        return False
    return True if any(w in UP_WORDS for w in words) else None


def uptime_s(raw) -> int | None:
    """Seconds (Technicolor) or « days:hours:minutes » (Sercomm)."""
    if isinstance(raw, str) and re.fullmatch(r"\d+:\d+:\d+", raw.strip()):
        d, h, m = (int(x) for x in raw.strip().split(":"))
        return d * 86400 + h * 3600 + m * 60
    n = num(raw)
    return int(n) if n is not None and n >= 0 else None


def hmac_hex(key: str, message: str) -> str:
    return hmac.new(key.encode("latin-1"), message.encode("latin-1"), hashlib.sha256).hexdigest()


def pbkdf2(secret: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", secret.encode(), salt.encode(), 1000).hex()[:32]  # NOSONAR 1000 iterations are imposed by the station login protocol, the client must derive the same key


class VodafoneStation(StatusConnector):
    type = "vodafone-station"
    label = "Vodafone Station"
    fields = (
        Field("url", "Adresse de la Vodafone Station", "url", required=True, default="http://192.168.0.1", help="L'adresse de son interface web, souvent http://192.168.0.1 ou http://192.168.100.1."),
        Field("username", "Utilisateur", "text", required=True, default="vodafone", help="Celui de la page de connexion de la box (souvent « vodafone »)."),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Donne l'adresse de la box (celle qui ouvre son interface web depuis le serveur) et le compte de sa page de connexion : MyServices ne fait que lire.",
             "La box n'accepte qu'une session à la fois : si tu es connecté à son interface en même temps, MyServices est refusé. Une erreur de mot de passe peut bloquer la box un moment, MyServices ne réessaie pas.",
             "Gérées : les interfaces Technicolor et Sercomm. Les Vodafone Station UK (Homeware, Ultra Hub) ne le sont pas.",
             "La box ne donne ni les débits, ni l'adresse IP publique, ni l'état du Wi-Fi : ces informations ne sont pas montrées.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a box
            self._jar = http.cookiejar.CookieJar()
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar), urllib.request.HTTPSHandler(context=tls), NoRedirect())
        return self._op

    def fetch(self, method: str, path: str, form: dict | None = None, query: dict | None = None, csrf: str = "") -> bytes:
        """One call of the session. ConnectorError « HTTP n » for an error status (401 also for a redirect to the login page); never the credentials in a message."""
        q = {"_": int(time.time()), "csrf_token": csrf} if query is None else query
        url = f"{self.base_url()}/{path}" + (f"?{urllib.parse.urlencode(q)}" if q else "")
        req = urllib.request.Request(url, data=None if form is None else urllib.parse.urlencode(form).encode(), headers=HEADERS, method=method)
        try:
            with self.opener().open(req, timeout=self.ctx.timeout) as r:
                return r.read(MAX_BYTES)
        except urllib.error.HTTPError as e:
            e.close()
            if e.code == 429:
                raise RateLimited(f"HTTP {e.code}") from None
            raise ConnectorError("HTTP 401" if e.code in (301, 302, 303, 307, 401, 403) else f"HTTP {e.code}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None

    def probe(self, path: str, query: dict | None = None) -> bytes | None:
        """A page for the detection: None when the box has no such page."""
        try:
            return self.fetch("GET", path, query=query)
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith("HTTP"):
                return None
            raise

    def family(self) -> tuple[str, dict]:
        """('technicolor', login_conf data) or ('sercomm', {'page': login.html}); anything else is an error."""
        raw = self.probe("api/v1/login_conf", {})
        if raw:
            try:
                if "ModelName" in data_of(raw):
                    return "technicolor", data_of(raw)
            except ConnectorError:
                pass
        page = self.probe("login.html", {})
        if page and b"var csrf_token = " in page:
            return "sercomm", {"page": page.decode("utf-8", "replace")}
        homeware = self.probe("login.lp", {"getSessionStatus": "true"})
        if homeware and b'"alive"' in homeware.replace(b" ", b""):
            raise ConnectorError(UNSUPPORTED)
        for fields in ("X_VODAFONE_ServiceStatus_1", "X_VODAFONE_WebUI_Language"):
            hub = self.probe("api/config/details.jst", {"X_INTERNAL_FIELDS": fields})
            if hub and fields.encode() in hub:
                raise ConnectorError(UNSUPPORTED)
        raise ConnectorError(UNKNOWN)

    def remember_refusal(self, base: str) -> Refused:
        REFUSED_BY[base] = self.fingerprint()
        return Refused(REFUSED)

    def fingerprint(self) -> str:
        return hashlib.sha256(f"{self.conf.get('username', '')}\0{self.conf.get('password', '')}".encode()).hexdigest()

    # Technicolor

    def technicolor_login(self, base: str) -> None:
        user, password = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        step = jload(self.fetch("POST", "api/v1/session/login", {"username": user, "password": SALT_REQUEST}))
        step = step if isinstance(step, dict) else {}
        if "salt" not in step:
            if step.get("message") == TECHNICOLOR_BUSY:
                raise Busy(BUSY)
            raise self.remember_refusal(base)
        hashed = pbkdf2(pbkdf2(password, str(step["salt"])), str(step.get("saltwebui", "")))
        done = jload(self.fetch("POST", "api/v1/session/login", {"username": user, "password": hashed}))
        if isinstance(done, dict) and done.get("error") == "error":
            if done.get("message") == TECHNICOLOR_BUSY:
                raise Busy(BUSY)
            raise self.remember_refusal(base)
        self.fetch("GET", "api/v1/session/menu")   # the next calls fail without it

    def technicolor_read(self, login_conf: dict) -> Box:
        status = data_of(self.fetch("GET", "api/v1/sta_status"))
        try:
            hosts = data_of(self.fetch("GET", "api/v1/host/hostTbl")).get("hostTbl")
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e) == "HTTP 401":
                raise
            hosts = None
        devices = sum(1 for h in hosts if isinstance(h, dict) and h.get("active") == "true") if isinstance(hosts, list) else None
        operational = status.get("operational")
        return Box(model=str(login_conf.get("ModelName") or status.get("hardwaretype") or "") or None, line="cable" if status.get("CMStatus", operational) else None,
                   connected=link_up(status.get("WANStatus", operational), status.get("CMStatus", operational)), uptime_s=uptime_s(status.get("uptime")),
                   firmware=str(status.get("firmwareversion") or "") or None, devices=devices)

    def technicolor_logout(self) -> None:
        try:
            self.fetch("POST", "api/v1/session/logout", {})
        except ConnectorError:
            pass   # the session ends by itself; the reading is done

    # Sercomm

    def sercomm_login(self, base: str, page: str) -> str:
        """The CSRF token of the session."""
        token = re.search(r"csrf_token\s*=\s*'([^']*)'", page)
        csrf = token[1] if token else ""
        lang = flat(self.fetch("GET", "data/user_lang.json", csrf=csrf))
        key = str(lang.get("encryption_key") or "")
        self.opener()
        host = urllib.parse.urlsplit(base).hostname or ""
        self._jar.set_cookie(http.cookiejar.Cookie(0, "login_uid", "1", None, False, host, True, False, "/", True, False, None, False, None, None, {}))
        self.fetch("POST", "data/reset.json", {"chk_sys_busy": ""}, csrf=csrf)
        user, password = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        if not key:
            challenge = str(flat(self.fetch("GET", "data/login.json", csrf=csrf)).get("challenge") or "")
            self.sercomm_post(base, {"LoginName": user, "LoginPWD": hashlib.sha256((password + challenge).encode()).hexdigest(), "challenge": challenge}, csrf)
            return csrf
        # Two variants exist (username hashed or plain): tried in turn once, then the one that worked is remembered so a wrong password costs a single attempt.
        known = VARIANT.get(base)
        for hashed_user in ([known] if known is not None else [True, False]):
            payload = {"LoginName": hmac_hex(key, hmac_hex("$1$SERCOMM$", user)) if hashed_user else user, "LoginPWD": hmac_hex(key, hmac_hex("$1$SERCOMM$", password))}
            try:
                self.sercomm_post(base, payload, csrf)
            except Refused:
                if hashed_user and known is None:
                    REFUSED_BY.pop(base, None)   # the first variant is not yet the box's final word
                    continue
                raise
            VARIANT[base] = hashed_user
            return csrf
        raise self.remember_refusal(base)

    def sercomm_post(self, base: str, payload: dict, csrf: str) -> None:
        code = str(jload(self.fetch("POST", "data/login.json", payload, csrf=csrf))).strip()
        if code == "1":
            return
        if code == "2":
            raise Busy(BUSY)
        if code in ("3", "4", "5", "7"):
            raise self.remember_refusal(base)
        raise ConnectorError("réponse de connexion inattendue de la Vodafone Station")

    def sercomm_read(self, csrf: str) -> Box:
        page = {}
        overview = flat(self.fetch("GET", "data/overview.json", csrf=csrf))
        page.update(flat(self.fetch("GET", "data/user_data.json", csrf=csrf)))
        for extra in ("data/statussupportstatus.json", "data/statussupportrestart.json"):
            try:
                page.update(flat(self.fetch("GET", extra, csrf=csrf)))
            except RateLimited:
                raise
            except ConnectorError as e:
                if str(e) == "HTTP 401":
                    raise
        page |= overview
        lists = [str(page.get(k) or "").split(";") for k in ("wifi_user", "wifi_guest", "ethernet")] if any(k in page for k in ("wifi_user", "wifi_guest", "ethernet")) else None
        devices = None if lists is None else sum(1 for rows, kind in zip(lists, ("wifi", "wifi", "eth")) for r in rows if r.strip() and (kind == "eth" or r.split("|")[0] == "on"))
        return Box(model=str(page.get("sys_hardware_version") or "") or None, line="cable" if page.get("cm_status") else None, connected=link_up(page.get("wan_status"), page.get("cm_status")),
                   uptime_s=uptime_s(page.get("sys_uptime")), firmware=str(page.get("sys_firmware_version") or "") or None, devices=devices)

    # Reading

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        kind, info = self.family()
        try:
            if kind == "technicolor":
                self.technicolor_login(base)
                try:
                    box = self.technicolor_read(info)
                finally:
                    self.technicolor_logout()
            else:
                box = self.sercomm_read(self.sercomm_login(base, info["page"]))   # no logout page is known: the session times out by itself
        except ConnectorError as e:
            if str(e) == "HTTP 401":
                raise ConnectorError(SESSION_LOST) from None
            raise
        REFUSED_BY.pop(base, None)
        return box_card(box)
