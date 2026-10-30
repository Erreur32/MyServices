"""Arris / CommScope SURFboard cable modems (SB8200, S33, S34, SB6190 and look-alikes), read from the web interface of the modem (192.168.100.1). Read-only.
Written from the arris-modem-status library (HNAP), the modem-scraper and modem_status projects (SB8200 pages) and a real SB8200 page capture; not tested on a real modem.

Three ways in, tried in this order so that the cheapest and safest one wins:
1. The open status page (/cmconnectionstatus.html, then /RgConnect.asp), no account, when the modem still serves it: channels, startup procedure, and /cmswinfo.html for firmware and uptime.
2. HNAP (S33, S34, recent SB8200 firmwares), only with a password: POST /HNAP1/ with a JSON body, challenge then login (private key = HMAC-SHA256(publicKey + password, challenge),
   login password = HMAC-SHA256(privateKey, challenge), every call signed by HNAP_AUTH = HMAC-SHA256(privateKey, timestamp + SOAPAction URI)), cookies uid and PrivateKey.
3. The « credential » token of the Comcast SB8200 firmware, only with a password: HTTP Basic plus the account in the query of the status page, the answer being the token sent back as a cookie.
Not tested here: the SB6141 and SB6183 pages (other layout, the table reader is header driven and may read them), the md5 flavour of HNAP on old firmwares, a logout call for HNAP (the session times out).

The modem refuses an address that fails to log in: a refused login is remembered in memory (address and a hash of the password, never the password) and not repeated until the settings change; no retry.
The calls need request headers and cookies of our own, so this connector keeps its own urllib opener (like speedport.py); those calls are not in the request counters.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html.parser
import json
import re
import ssl
import time
import urllib.error
import urllib.request

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card
from connectors.status_kit import MAX_FACTS, StatusConnector, fact, num

MAX_BYTES = 2_000_000
PAGES = ("cmconnectionstatus.html", "RgConnect.asp")   # the open status pages, in order
INFO_PAGE = "cmswinfo.html"
LOGOUT_PAGE = "logout.html"
NO_KEY = "withoutloginkey"   # what the page script signs with before the login (not a secret)
SOAP_ROOT = "http://purenetworks.com/HNAP1/"
LOGIN_ACTION = "Login"
LOGIN_OK = ("OK", "SUCCESS")
CHANNEL_SEP, FIELD_SEP = "|+|", "^"
POWER_LIMITS = (-8.0, 8.0)   # dBmV on a downstream channel, outside it the signal is out of the DOCSIS comfort range
SNR_WARN, SNR_BAD = 33.0, 30.0   # dB, QAM256 needs about 30
REFUSED = "mot de passe refusé par le modem : vérifie le compte de son interface (MyServices ne réessaie pas tant que les réglages ne changent pas)"
LOCKED = "le modem a bloqué la connexion un moment après des essais ratés : attends quelques minutes puis réessaie"
NEEDS_LOGIN = "ce modem demande un compte pour montrer son état : renseigne le mot de passe de son interface (souvent admin, ou celui imprimé sous le modem)"
NOT_ARRIS = "cet appareil ne ressemble pas à un modem Arris SURFboard (ni page d'état, ni HNAP)"
UNREADABLE = "réponse illisible du modem (firmware non géré)"
REDIRECTED = "le modem redirige vers une autre adresse : essaie https://192.168.100.1 (ou http://192.168.100.1 pour un ancien modèle)"
SESSION_LOST = "le modem a fermé la session : réessaie"
# Memory of the process: address -> fingerprint of the password the modem refused.
REFUSED_BY: dict[str, str] = {}


class Refused(ConnectorError):
    """The modem does not accept this account."""


class NotHnap(ConnectorError):
    """The modem does not speak HNAP."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def sign(key: str, message: str) -> str:
    return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest().upper()


def hnap_auth(private_key: str | None, action: str, stamp: int | None = None) -> str:
    """The HNAP_AUTH header of a call: « HASH TIMESTAMP »."""
    stamp = int(time.time() * 1000) % 2_000_000_000_000 if stamp is None else stamp
    return f"{sign(private_key or NO_KEY, f'{stamp}\"{SOAP_ROOT}{action}\"')} {stamp}"


def login_keys(public_key: str, password: str, challenge: str) -> tuple[str, str]:
    """(private key, login password) of the HNAP login."""
    private = sign(public_key + password, challenge)
    return private, sign(private, challenge)


class Tables(html.parser.HTMLParser):
    """The rows of every table of a page, flat, each tagged with the last title row (a row made of one header cell) met before it."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[str, list[str]]] = []
        self.section, self._row, self._cell, self._head = "", None, None, False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._flush()
            self._row = []
        elif tag in ("td", "th"):
            self._close_cell()
            self._row = [] if self._row is None else self._row
            self._cell, self._head = [], tag == "th"

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self._close_cell()
        elif tag == "tr":
            self._flush()

    def _close_cell(self):
        if self._cell is not None and self._row is not None:
            text = " ".join("".join(self._cell).split())
            self._row.append(text)
            if self._head and len(self._row) == 1:
                self.section = text
        self._cell = None

    def _flush(self):
        self._close_cell()
        if self._row:
            self.rows.append((self.section, self._row))
        self._row = None


def parse_page(raw: bytes) -> dict:
    """What a status page says: {down, up, startup, info, model}; down and up are lists of channels, empty when the page has none."""
    text = (raw or b"").decode("utf-8", "replace")
    parser = Tables()
    parser.feed(text)
    parser.close()
    out: dict = {"down": [], "up": [], "startup": {}, "info": {}, "model": (re.search(r'id="thisModelNumberIs">([^<]+)<', text) or [None, None])[1]}
    header: list[str] = []
    for section, cells in parser.rows:
        low = section.lower()
        if len(cells) == 1:
            continue
        if "channel id" in (c.lower() for c in cells):
            header = [c.lower() for c in cells]
        elif "downstream" in low or "upstream" in low:
            row = dict(zip(header, cells))
            if row:
                out["down" if "downstream" in low else "up"].append({
                    "lock": row.get("lock status", ""), "power": num(re.sub(r"[^0-9.+-]", "", row.get("power", ""))),
                    "snr": num(re.sub(r"[^0-9.+-]", "", next((v for k, v in row.items() if k.startswith("snr")), ""))),
                    "corrected": num(row.get("corrected")), "uncorrected": num(row.get("uncorrectables"))})
        elif "startup" in low and len(cells) >= 2:
            out["startup"][cells[0]] = cells[1:]
        elif len(cells) == 2:
            out["info"][cells[0].lower()] = cells[1]
    return out


def hnap_channels(down: str, up: str) -> tuple[list[dict], list[dict]]:
    """The channel strings of HNAP (« ID^Status^Modulation^^Frequency^Power^SNR^Corrected^Uncorrected », « ID^Status^Type^^^Frequency^Power »)."""
    def split(raw: str) -> list[list[str]]:
        return [e.split(FIELD_SEP) for e in str(raw or "").split(CHANNEL_SEP) if e.strip()]

    def at(fields: list[str], i: int):
        return fields[i] if i < len(fields) else None
    return ([{"lock": at(f, 1) or "", "power": num(at(f, 5)), "snr": num(at(f, 6)), "corrected": num(at(f, 7)), "uncorrected": num(at(f, 8))} for f in split(down)],
            [{"lock": at(f, 1) or "", "power": num(at(f, 6)), "snr": None, "corrected": None, "uncorrected": None} for f in split(up)])


def uptime_s(text) -> int | None:
    """« 1 days 14h:12m:38s.00 », « 27 day(s) 10h:12m:37s » or « 7 days 14:23:56 » in seconds."""
    found = re.search(r"(?:(\d+)\s*d\D*?)?(\d+)\s*h?:\s*(\d+)\s*m?:\s*(\d+)", str(text or ""))
    return None if not found else int(found[1] or 0) * 86400 + int(found[2]) * 3600 + int(found[3]) * 60 + int(found[4])


def locked(channels: list[dict]) -> int:
    return sum(1 for c in channels if c["lock"].strip().lower() == "locked")


def signal_facts(down: list[dict], up: list[dict]) -> tuple[list[dict], list[str]]:
    """The signal figures of the card and what does not go well."""
    if not down and not up:
        return [], []
    facts, problems = [], []
    bad = len(down) - locked(down)
    facts.append(fact("Canaux descendants", f"{locked(down)} verrouillés sur {len(down)}", "warn" if bad else "ok"))
    if bad:
        problems.append(f"{bad} canal(aux) descendant(s) non verrouillé(s)")
    if up:
        facts.append(fact("Canaux montants", f"{locked(up)} verrouillés sur {len(up)}", "warn" if len(up) > locked(up) else "ok"))
    powers = [c["power"] for c in down if c["power"] is not None]
    if powers:
        off = min(powers) < POWER_LIMITS[0] or max(powers) > POWER_LIMITS[1]
        facts.append(fact("Puissance descendante", f"{min(powers):.1f} à {max(powers):.1f} dBmV".replace(".", ","), "warn" if off else None))
        if off:
            problems.append("puissance descendante hors de la plage conseillée (-8 à 8 dBmV)")
    snrs = [c["snr"] for c in down if c["snr"] is not None]
    if snrs:
        low = min(snrs)
        facts.append(fact("SNR minimal", f"{low:.1f} dB".replace(".", ","), "bad" if low < SNR_BAD else "warn" if low < SNR_WARN else None))
        if low < SNR_WARN:
            problems.append("rapport signal/bruit faible sur au moins un canal descendant")
    errors = [c["uncorrected"] for c in down if c["uncorrected"] is not None]
    if errors:
        facts.append(fact("Erreurs non corrigées", f"{int(sum(errors))}"))
    upw = [c["power"] for c in up if c["power"] is not None]
    if upw:
        facts.append(fact("Puissance montante", f"{min(upw):.1f} à {max(upw):.1f} dBmV".replace(".", ",")))
    return facts, problems


class ArrisSurfboard(StatusConnector):
    type = "arris-surfboard"
    label = "Arris SURFboard"
    fields = (
        Field("url", "Adresse du modem", "url", required=True, default="https://192.168.100.1", help="L'adresse de son interface web : https://192.168.100.1 (S33, S34, SB8200 récent) ou http://192.168.100.1 (anciens modèles)."),
        Field("username", "Identifiant (facultatif)", "text", default="admin", help="Celui de l'interface du modem, presque toujours admin."),
        Field("password", "Mot de passe du modem (facultatif)", "password", secret=True, help="Celui de l'interface du modem (souvent imprimé sous le modem). Inutile si la page d'état du modem s'ouvre sans compte."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="à laisser décoché : le certificat du modem est auto-signé et souvent périmé"),
    )
    guide = ("Donne l'adresse du modem (https://192.168.100.1 en général, http://192.168.100.1 pour un ancien modèle) : MyServices lit sa page d'état comme le ferait ton navigateur, sans rien modifier.",
             "Si la page d'état s'ouvre sans compte, le mot de passe est inutile. Sinon (S33, S34, SB8200 récent) renseigne celui de l'interface du modem.",
             "MyServices montre le modèle, le firmware, la durée de fonctionnement, les canaux verrouillés, la puissance, le rapport signal/bruit et les erreurs.",
             "Un mot de passe refusé arrête la lecture : le modem bloque un moment une adresse qui échoue, MyServices ne réessaie pas tant que les réglages ne changent pas. Non testé sur matériel.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            tls = None
            if not self.tls():
                tls = ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a modem
                try:
                    tls.set_ciphers("DEFAULT:@SECLEVEL=0")   # shortcut: the modems keep an old certificate and old ciphers, only for this opt-in context
                except ssl.SSLError:
                    pass
            self._op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=tls), NoRedirect())
        return self._op

    def fetch(self, path: str, body: str | None = None, headers: dict | None = None) -> bytes:
        """One call (POST when a body is given). ConnectorError « HTTP n » for an error status; never the credentials in a message."""
        req = urllib.request.Request(f"{self.base_url()}/{path}", data=None if body is None else body.encode(), headers=headers or {}, method="GET" if body is None else "POST")
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

    def refuse(self, base: str):
        REFUSED_BY[base] = self.fingerprint()
        raise Refused(REFUSED)

    def open_pages(self) -> tuple[dict | None, bool]:
        """(the parsed open status page or None, whether some page answered at all)."""
        answered = False
        for path in PAGES:
            try:
                page = parse_page(self.fetch(path))
            except RateLimited:
                raise
            except ConnectorError as e:
                if str(e).startswith("HTTP 30"):
                    raise ConnectorError(REDIRECTED) from None
                if str(e).startswith("HTTP 4"):
                    answered = answered or str(e) != "HTTP 404"
                    continue
                raise
            answered = True
            if page["down"] or page["up"]:
                return page, True
        return None, answered

    def optional_info(self, headers: dict | None = None) -> dict:
        try:
            return parse_page(self.fetch(INFO_PAGE, headers=headers))["info"]
        except RateLimited:
            raise
        except ConnectorError:
            return {}

    # HNAP -------------------------------------------------------------------------------------------------

    def call(self, action: str, request: dict, key: str | None = None, uid: str | None = None) -> dict:
        headers = {"Content-Type": "application/json", "SOAPAction": f'"{SOAP_ROOT}{action}"', "HNAP_AUTH": hnap_auth(key, action),
                   "Referer": f"{self.base_url()}/Login.html"}
        if uid:
            headers["Cookie"] = f"uid={uid}" + (f"; PrivateKey={key}" if key else "")
        try:
            data = json.loads(self.fetch("HNAP1/", json.dumps(request), headers))
        except ConnectorError as e:
            if str(e) in ("HTTP 404", "HTTP 405", "HTTP 501"):
                raise NotHnap(str(e)) from None
            raise
        except ValueError:
            raise NotHnap(UNREADABLE) from None
        if not isinstance(data, dict):
            raise NotHnap(UNREADABLE)
        return data

    def hnap_login(self, base: str) -> tuple[str, str]:
        """(private key, uid cookie). One attempt only."""
        user, password = str(self.conf.get("username") or "admin"), str(self.conf.get("password", ""))
        ask = {LOGIN_ACTION: {"Action": "request", "Username": user, "LoginPassword": "", "Captcha": "", "PrivateLogin": "LoginPassword"}}
        first = self.call(LOGIN_ACTION, ask).get("LoginResponse")
        if not isinstance(first, dict) or not first.get("Challenge") or not first.get("PublicKey"):
            raise NotHnap(UNREADABLE)
        uid = str(first.get("Cookie") or "")
        key, proof = login_keys(str(first["PublicKey"]), password, str(first["Challenge"]))
        answer = self.call(LOGIN_ACTION, {LOGIN_ACTION: {"Action": "login", "Username": user, "LoginPassword": proof, "Captcha": "", "PrivateLogin": "LoginPassword"}}, key, uid)
        result = str((answer.get("LoginResponse") or {}).get("LoginResult", "")).upper()
        if result in LOGIN_OK:
            return key, uid
        if "LOCK" in result:
            raise ConnectorError(LOCKED)
        self.refuse(base)

    def hnap_read(self, key: str, uid: str) -> dict:
        def multi(*names: str) -> dict:
            answer = self.call("GetMultipleHNAPs", {"GetMultipleHNAPs": dict.fromkeys(names, "")}, key, uid)
            found = answer.get("GetMultipleHNAPsResponse")
            if not isinstance(found, dict):
                raise ConnectorError(SESSION_LOST)
            return {n: found.get(f"{n}Response") or {} for n in names}
        soft = multi("GetCustomerStatusSoftware")["GetCustomerStatusSoftware"]
        boot = multi("GetCustomerStatusStartupSequence", "GetCustomerStatusConnectionInfo")
        chan = multi("GetCustomerStatusDownstreamChannelInfo", "GetCustomerStatusUpstreamChannelInfo")
        down, up = hnap_channels(chan["GetCustomerStatusDownstreamChannelInfo"].get("CustomerConnDownstreamChannel"),
                                 chan["GetCustomerStatusUpstreamChannelInfo"].get("CustomerConnUpstreamChannel"))
        start = boot["GetCustomerStatusStartupSequence"]
        return {"down": down, "up": up, "model": soft.get("StatusSoftwareModelName"), "firmware": soft.get("StatusSoftwareSfVer"),
                "uptime": soft.get("CustomerConnSystemUpTime"), "state": start.get("CustomerConnConnectivityStatus"), "comment": start.get("CustomerConnConnectivityComment")}

    # Comcast SB8200 token ---------------------------------------------------------------------------------

    def token_read(self, base: str) -> dict:
        user, password = str(self.conf.get("username") or "admin"), str(self.conf.get("password", ""))
        account = base64.b64encode(f"{user}:{password}".encode()).decode()
        basic = {"Authorization": f"Basic {account}"}
        try:
            token = self.fetch(f"{PAGES[0]}?{account}", headers=basic).decode("utf-8", "replace").strip()
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e) in ("HTTP 401", "HTTP 403"):
                self.refuse(base)
            raise
        if not re.fullmatch(r"[A-Za-z0-9+/=_-]{16,64}", token):
            self.refuse(base)
        headers = {**basic, "Cookie": f"credential={token}"}
        try:
            page = parse_page(self.fetch(PAGES[0], headers=headers))
            if not (page["down"] or page["up"]):
                raise ConnectorError(UNREADABLE)
            page["info"] = self.optional_info(headers)
        finally:
            try:
                self.fetch(LOGOUT_PAGE, headers=headers)   # lets the modem free its single session
            except ConnectorError:
                pass
        return page

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        password = str(self.conf.get("password", ""))
        page, answered = self.open_pages()
        if page is not None:
            page["info"] = self.optional_info()
            return self.card(page["down"], page["up"], page["model"], page["info"].get("software version"), page["info"].get("up time"), page["startup"].get("Connectivity State"))
        if not password:
            raise ConnectorError(NEEDS_LOGIN if answered else NOT_ARRIS)
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        try:
            key, uid = self.hnap_login(base)
            got = self.hnap_read(key, uid)
            REFUSED_BY.pop(base, None)
            return self.card(got["down"], got["up"], got["model"], got["firmware"], got["uptime"], [got["state"], got["comment"]] if got["state"] else None)
        except NotHnap:
            pass
        page = self.token_read(base)
        REFUSED_BY.pop(base, None)
        return self.card(page["down"], page["up"], page["model"], page["info"].get("software version"), page["info"].get("up time"), page["startup"].get("Connectivity State"))

    @staticmethod
    def card(down: list[dict], up: list[dict], model, firmware, uptime, state) -> dict:
        """The Box (line « cable ») plus the signal facts. « Connected » follows the connectivity state of the startup procedure, else the locked channels."""
        word = str((state or [""])[0]).strip().upper()
        connected = word == "OK" if word else (locked(down) > 0 and locked(up) > 0 if down or up else None)
        seconds = uptime_s(uptime)
        card = box_card(Box(model=str(model or "") or None, line="cable", connected=connected, uptime_s=seconds, firmware=str(firmware or "") or None))
        facts, problems = signal_facts(down, up)
        card["facts"] = (card["facts"] + facts)[:MAX_FACTS]
        card["problems"] = (card["problems"] + problems)[:12]
        return card
