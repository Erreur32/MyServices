"""Asus routers (AsusWRT and Asuswrt-Merlin) read through their web interface. Read-only: the login, GET pages of /appGet.cgi and the logout are sent, never apply.cgi.
Written from the asusrouter library (Apache-2.0, github.com/Vaskivskyi/asusrouter) and the AsusRouterTools library (GPL-3.0, github.com/PixelByProxy/AsusRouterTools), used as
documentation of the protocol only (nothing copied). Not tested on a real router. Newer models (for example the GS-BE18000) use another login (nonce, login_v2.cgi): not covered.

Protocol, where both libraries agree: POST /login.cgi with the form field login_authorization = base64("user:password") and a User-Agent of the Asus app; the JSON answer carries
asus_token, which every later call sends as the cookie `asus_token=<token>` (so a plain header is enough, no cookie jar). Then /appGet.cgi?hook=<hooks> where the hooks are
`nvram_get(<key>);`, `get_wan_unit();`, `get_clientlist();`. Only asusrouter says: the failure is an answer with `error_status` (3 wrong credentials, 7 locked with
`remaining_lock_time`, 8 logged out, 9 another session, 10 captcha, 11 reset required: the meaning of 9 is taken from the name of its enum), the logout is POST /Logout.asp, link_internet "2" is
connected, wan<unit>_realip_ip is the address seen from outside, wl<n>_radio is a Wi-Fi radio, the nvram keys productid, firmver, buildno and extendno build the firmware name.
Only AsusRouterTools says: the hooks go in a GET query. The answers are kept as bytes and read leniently, since the router sometimes sends a slightly broken JSON.
The router allows one web login at a time and locks the login after a few wrong passwords: a refused login is remembered in memory (address and a hash of the password, never
the password) and not repeated until the settings change; the session is closed at the end.
Not given by a source in JSON, so left None: current traffic (netdev gives counters, a rate needs two readings), the uptime of the connection (the `uptime()` hook is not JSON and is
the router's own), the line type and rates, the temperature (JavaScript page), the firmware update.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import urllib.parse

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector

USER_AGENT = "asusrouter--DUTUtil-"   # the login is refused without a User-Agent of the Asus app
LOGIN, LOGOUT, HOOK = "/login.cgi", "/Logout.asp", "/appGet.cgi?hook="
RADIOS = 4   # wl0_radio to wl3_radio: 2.4 GHz, 5 GHz, second 5 GHz or 6 GHz
KEYS = ("productid", "firmver", "buildno", "extendno", "link_internet",
        *(f"wan{u}_{k}" for u in (0, 1) for k in ("state_t", "realip_ip", "ipaddr")), *(f"wl{n}_radio" for n in range(RADIOS)))
MAIN_HOOK = "get_wan_unit();" + "".join(f"nvram_get({k});" for k in KEYS)
CLIENTS_HOOK = "get_clientlist();"
REFUSED = "identifiant ou mot de passe refusé par le routeur : vérifie-les dans son interface web (MyServices ne réessaie pas tant que les réglages ne changent pas)"
BUSY = "le routeur a déjà une session ouverte (une seule à la fois) : ferme son interface web puis réessaie"
LOCKED = "connexion verrouillée par le routeur après des erreurs de mot de passe : réessaie dans {} s"
LOCKED_UNKNOWN = "connexion verrouillée par le routeur après des erreurs de mot de passe : réessaie dans quelques minutes"
CAPTCHA = "le routeur demande un captcha : connecte-toi une fois à son interface web depuis un navigateur, puis réessaie (MyServices ne réessaie pas tant que les réglages ne changent pas)"
RESET = "le routeur demande de changer son mot de passe : fais-le dans son interface web puis mets à jour les réglages"
UNKNOWN_REFUSAL = "le routeur refuse la connexion (code {})"
SESSION_LOST = "le routeur a fermé la session : réessaie"
NOT_A_ROUTER = "réponse inattendue : ce n'est pas un routeur Asus (ou son modèle utilise une autre connexion)"
UNREADABLE = "le routeur répond mais la réponse est illisible"
REFUSED_BY: dict[str, str] = {}   # address -> fingerprint of the password the router refused
REMEMBERED = {"2", "3", "10"}     # codes that mean « do not try again with these settings »


def parse(raw: object) -> dict:
    """The JSON object of an answer, read leniently (empty values, stray commas); ConnectorError when it is not one."""
    text = raw.decode("utf-8-sig", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
    text = re.sub(r"\s*,\s*,", ", ", text)
    text = re.sub(r",\s*}\s*$", "}", text)
    text = re.sub(r":\s*(,|\})", ": null\\1", text)
    try:
        data = json.loads(text)
    except ValueError:
        raise ConnectorError(UNREADABLE) from None
    if not isinstance(data, dict):
        raise ConnectorError(UNREADABLE)
    return data


def text_of(value: object) -> str | None:
    return None if value is None else (str(value).strip() or None)


def firmware_of(data: dict) -> str | None:
    """« 3.0.0.4.388_24198 »: firmver.buildno then _extendno; None without the first two parts."""
    major, minor, extend = (text_of(data.get(k)) for k in ("firmver", "buildno", "extendno"))
    if not (major and minor):
        return None
    base = f"{major}.{minor}"
    return f"{base}_{extend}" if extend else base


def wan_unit(data: dict) -> int:
    """The active WAN (0, or 1 in dual WAN)."""
    return 1 if str(data.get("get_wan_unit")).strip() == "1" else 0


def connected_of(data: dict, unit: int) -> bool | None:
    state = text_of(data.get("link_internet")) or text_of(data.get(f"wan{unit}_state_t"))
    return None if state is None else state == "2"


def public_ip_of(data: dict, unit: int) -> str | None:
    for key in ("realip_ip", "ipaddr"):
        found = public_address(data.get(f"wan{unit}_{key}"))
        if found:
            return found
    return None


def wifi_of(data: dict) -> bool | None:
    radios = [text_of(data.get(f"wl{n}_radio")) for n in range(RADIOS)]
    known = [r for r in radios if r in ("0", "1")]
    return any(r == "1" for r in known) if known else None


def online_clients(data: dict) -> int | None:
    """Connected devices of a get_clientlist answer, the router itself left out; None when the list is not there."""
    table = data.get("get_clientlist")
    if not isinstance(table, dict):
        return None
    clients = [c for c in table.values() if isinstance(c, dict)]
    return sum(1 for c in clients if str(c.get("isOnline")) == "1" and str(c.get("isGateway")) != "1")


class AsusRouter(StatusConnector):
    type = "asus-router"
    label = "Routeur Asus (AsusWRT / Merlin)"
    every = 900   # one web session at a time: a reading must not keep the owner out of the interface
    fields = (
        Field("url", "Adresse du routeur", "url", required=True, default="http://192.168.50.1", help="L'adresse de son interface web : souvent http://192.168.50.1 ou http://router.asus.com (https://...:8443 pour l'accès sécurisé)."),   # NOSONAR S1313: the factory address of the router, a default the user can change
        Field("username", "Utilisateur", "text", required=True, default="admin", help="admin sauf si tu l'as changé."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Celui de l'interface web du routeur."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="à laisser décoché pour le certificat auto-signé du routeur"),
    )
    guide = ("Donne l'adresse du routeur (celle qui ouvre son interface web depuis le serveur), son utilisateur et son mot de passe : MyServices ne fait que lire.",
             "Le routeur n'accepte qu'une session web à la fois : si tu es connecté à son interface en même temps, MyServices est refusé. Il lit donc toutes les 15 minutes par défaut. Après quelques erreurs de mot de passe, il verrouille la connexion un moment ; MyServices ne réessaie pas.",
             "Pour les routeurs Asus sous AsusWRT et Asuswrt-Merlin. Les modèles récents à connexion par nonce (comme le GS-BE18000) ne sont pas pris en charge.",
             "Le routeur ne donne pas ici le débit en cours, la température, la durée de connexion ni l'état des mises à jour.",
             "Non testé sur un vrai routeur.")

    def fingerprint(self) -> str:
        return hashlib.sha256(f"{self.conf.get('username', '')}:{self.conf.get('password', '')}".encode()).hexdigest()

    def call(self, path: str, token: str = "", form: dict | None = None) -> dict:
        """The JSON object answered; the token travels as a cookie header. A POST goes with `form`."""
        headers = {"User-Agent": USER_AGENT, **({"Cookie": f"asus_token={token}"} if token else {})}
        try:
            raw = self.ctx.http(self.base_url() + path, method="POST" if form is not None else "GET", form=form, headers=headers, verify_tls=self.tls(), binary=True)
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith("HTTP 404"):
                raise ConnectorError(NOT_A_ROUTER) from None
            raise
        return parse(raw)

    def refusal(self, answer: dict) -> ConnectorError:
        code = str(answer.get("error_status")).strip()
        if code == "7":
            wait = answer.get("remaining_lock_time")
            return ConnectorError(LOCKED.format(int(wait)) if str(wait).isdigit() else LOCKED_UNKNOWN)
        known = {"2": REFUSED, "3": REFUSED, "9": BUSY, "10": CAPTCHA, "11": RESET}
        return ConnectorError(known.get(code) or UNKNOWN_REFUSAL.format(code[:8]))

    def login(self, base: str) -> str:
        user, password = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        credentials = base64.b64encode(f"{user}:{password}".encode()).decode("ascii")
        answer = self.call(LOGIN, form={"login_authorization": credentials})
        if answer.get("error_status") not in (None, ""):
            if str(answer["error_status"]).strip() in REMEMBERED:
                REFUSED_BY[base] = self.fingerprint()
            raise self.refusal(answer)
        token = answer.get("asus_token")
        if not token or not isinstance(token, str):
            raise ConnectorError(NOT_A_ROUTER)
        return token

    def hook(self, hooks: str, token: str) -> dict:
        answer = self.call(HOOK + urllib.parse.quote(hooks, safe="();"), token)
        if "error_status" in answer:
            raise ConnectorError(SESSION_LOST)
        return answer

    def clients(self, token: str) -> int | None:
        """A router without the list gives None (not an error); an expired session or a rate limit still raise."""
        try:
            return online_clients(self.hook(CLIENTS_HOOK, token))
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e) == SESSION_LOST:
                raise
            return None

    def read(self, token: str) -> Box:
        data = self.hook(MAIN_HOOK, token)
        if not any(text_of(data.get(k)) for k in ("productid", "link_internet", "wan0_state_t")):
            raise ConnectorError(NOT_A_ROUTER)
        unit = wan_unit(data)
        connected = connected_of(data, unit)
        return Box(model=text_of(data.get("productid")), connected=connected, firmware=firmware_of(data), wifi=wifi_of(data), devices=self.clients(token),
                   public_ip=public_ip_of(data, unit) if connected is not False else None)

    def collect(self) -> dict:
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        token = self.login(base)
        REFUSED_BY.pop(base, None)
        try:
            return box_card(self.read(token))
        finally:
            try:
                self.ctx.http(base + LOGOUT, method="POST", payload=b"", headers={"User-Agent": USER_AGENT, "Cookie": f"asus_token={token}"}, verify_tls=self.tls(), binary=True)   # frees the single session slot at once
            except ConnectorError:
                pass   # the slot is freed by the router after its idle time
