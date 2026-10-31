"""TP-Link home routers of the Archer range whose web interface is the encrypted LuCI one (/cgi-bin/luci, RSA then AES). Read-only: the login, the
reading pages and the logout are sent, nothing else (nothing that writes to the router).
Tapo devices are not routers: they have their own connector. Other TP-Link web generations are NOT handled (the /cgi_gdpr firmwares of the MR, VR, EX, XDR series,
the older /cgi plain-token ones, and the newer LuCI firmwares with a 2048-bit password key and no AES): they are told apart and refused with a clear message.

Sources, used as documentation only, nothing copied: the tplinkrouterc6u library (AlexandrErohin, GPL-3.0, github.com/AlexandrErohin/TP-Link-Archer-C6U) is the ONLY source
read for the LuCI protocol and for the names of the reading pages and fields; its README lists Archer C6U, C6, C7, C50, C64, C80, C1200, C2300, C3200, A7, AX10 to AX73 and
many more as working, without telling which of them use this very generation. The protocol facts (addresses, field names, formats) were re-written with the standard
library and the `cryptography` package already in requirements.txt. No second independent source was found: the Home Assistant tplink_router integration
(wire67, no licence stated) and the hertzg/tplink-api client (GPL-2.0, /cgi_gdpr family) do not describe this generation. Never run against a real router.

Protocol, as read: POST cgi-bin/luci/;stok=/login?form=keys (body operation=read) gives data.password = [modulus, exponent] in hex, the key for the password;
POST ;stok=/login?form=auth gives data.seq and data.key = [modulus, exponent], the key for the signature. The client makes a 16 hex character AES key and IV,
sends form fields `sign` and `data`: data = base64 AES-128-CBC (PKCS7) of the text `operation=login&password=<RSA hex of the password>&confirm=true`; sign = hex RSA
(PKCS#1 v1.5, chunks of modulus bytes minus 11) of `k=<key>&i=<iv>&h=<md5 of user+password>&s=<seq + length of data>` (`k` and `i` only for the login). The answer is
JSON {"data": "<base64 AES>"} holding {"success": true, "data": {"stok": ...}}; the session cookie `sysauth` is kept by the cookie jar, the token goes in the URL.
Later calls sign `h=...&s=...` only. Logout: ;stok=<stok>/admin/system?form=logout. The router keeps ONE web session: a login throws out the open session of its owner.
Read: admin/status?form=all (WAN address, WAN uptime, the three device lists, the Wi-Fi switches) and admin/firmware?form=upgrade (model, firmware version).
Guessed, only a real router can confirm: that the read calls carry `operation=read` as a form text (a JSON text is used by another subclass of the library), the unit of
wan_ipv4_uptime (seconds), the wording of a refused or locked login, and that an address on the WAN means a connection that is up.
Not given by this protocol: the kind of line, the rates of the line, the current traffic, the update state and the temperature, so those fields stay None.
A refused password is remembered in memory (address, user and a hash of the password, never the password) and not tried again until the settings change.
"""
from __future__ import annotations

import base64
import hashlib
import http.cookiejar
import json
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card, public_address
from connectors.status_kit import StatusConnector, num

MAX_BYTES = 2_000_000
LUCI = "cgi-bin/luci/"
NO_ADDRESS = ("", "0.0.0.0")   # NOSONAR S1313: the address a WAN without lease shows
WIFI_SWITCHES = ("wireless_2g_enable", "wireless_5g_enable", "wireless_5g_2_enable", "wireless_6g_enable")
DEVICE_LISTS = ("access_devices_wired", "access_devices_wireless_host", "access_devices_wireless_guest")
REFUSED = "mot de passe refusé par le routeur TP-Link : vérifie le compte et le mot de passe local (pas le compte TP-Link ID) ; MyServices ne réessaie pas tant que les réglages ne changent pas"
LOCKED = "le routeur TP-Link a bloqué la connexion après des erreurs de mot de passe : attends un moment puis réessaie"
DENIED = "le routeur TP-Link a refusé la connexion (une session est peut-être déjà ouverte dans son interface web) : ferme-la puis réessaie"
UNSUPPORTED = "firmware non pris en charge : seuls les Archer à interface web LuCI chiffrée (RSA 1024 bits puis AES) sont lus ici"
UNREADABLE = "réponse illisible du routeur TP-Link (format non géré)"
SESSION_LOST = "le routeur TP-Link a fermé la session ou refuse la lecture : réessaie"
PASSWORD_TOO_LONG = "mot de passe trop long pour la clé du routeur TP-Link"
REFUSED_BY: dict[str, str] = {}   # address -> fingerprint of the account and password the router refused


@dataclass
class Session:
    """What the login negotiates; lives for one reading."""
    key: str = ""
    iv: str = ""
    seq: int = 0
    sign_key: tuple[int, int] = (0, 0)    # (modulus, exponent) of the signature
    pwd_key: tuple[int, int] = (0, 0)     # (modulus, exponent) of the password
    digest: str = ""
    stok: str = ""


def as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def key_pair(value: object) -> tuple[int, int] | None:
    """(modulus, exponent) of a [modulus, exponent] list of hex texts; None when it is not that."""
    if not isinstance(value, list) or len(value) != 2:
        return None
    try:
        return int(str(value[0]), 16), int(str(value[1]), 16)
    except ValueError:
        return None


def rsa_hex(text: str, key: tuple[int, int]) -> str:
    """PKCS#1 v1.5 encryption of one block, in lowercase hex (a text longer than the key allows raises ValueError)."""
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    public = rsa.RSAPublicNumbers(key[1], key[0]).public_key()
    return public.encrypt(text.encode(), padding.PKCS1v15()).hex()   # NOSONAR S5542: the router's own scheme, not our choice


def rsa_chunks(text: str, key: tuple[int, int]) -> str:
    """The signature text, cut in blocks of (modulus bytes - 11) and encrypted block by block."""
    size = (key[0].bit_length() + 7) // 8 - 11
    return "".join(rsa_hex(text[i:i + size], key) for i in range(0, len(text), size))


def aes_encrypt(text: str, key: str, iv: str) -> str:
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    padder = padding.PKCS7(128).padder()
    body = padder.update(text.encode()) + padder.finalize()
    enc = Cipher(algorithms.AES(key.encode()), modes.CBC(iv.encode())).encryptor()   # NOSONAR S5542: the router's own scheme, not our choice
    return base64.b64encode(enc.update(body) + enc.finalize()).decode()


def aes_decrypt(text: str, key: str, iv: str) -> str:
    """The clear text of a base64 AES answer; ConnectorError(UNREADABLE) when it does not decrypt."""
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    try:
        dec = Cipher(algorithms.AES(key.encode()), modes.CBC(iv.encode())).decryptor()   # NOSONAR S5542: the router's own scheme, not our choice
        body = dec.update(base64.b64decode(text, validate=True)) + dec.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        return (unpadder.update(body) + unpadder.finalize()).decode()
    except ValueError:
        raise ConnectorError(UNREADABLE) from None


def flag(value: object) -> bool | None:
    word = str(value).strip().lower() if value is not None else ""
    if word in ("yes", "true", "on", "1"):
        return True
    return False if word in ("no", "false", "off", "0") else None


def count_devices(status: dict) -> int | None:
    lists = [status[k] for k in DEVICE_LISTS if isinstance(status.get(k), list)]
    return sum(len(item) for item in lists) if lists else None


def wifi_state(status: dict) -> bool | None:
    states = [flag(status.get(k)) for k in WIFI_SWITCHES]
    return any(states) if any(s is not None for s in states) else None


def box_of(status: dict, firmware: dict) -> Box:
    ip = str(status.get("wan_ipv4_ipaddr")).strip() if status.get("wan_ipv4_ipaddr") is not None else None
    uptime = num(status.get("wan_ipv4_uptime"))
    return Box(model=str(firmware.get("model") or "") or None, connected=None if ip is None else ip not in NO_ADDRESS,
               public_ip=public_address(ip), uptime_s=int(uptime) if uptime is not None and uptime >= 0 else None,
               firmware=str(firmware.get("firmware_version") or "") or None, devices=count_devices(status), wifi=wifi_state(status))


class TplinkRouter(StatusConnector):
    type = "tplink-router"
    label = "TP-Link Archer (routeur)"
    every = 900   # each reading throws out the owner's open web session
    fields = (
        Field("url", "Adresse du routeur", "url", required=True, default="http://192.168.0.1", help="L'adresse de son interface web : souvent http://192.168.0.1 ou http://tplinkwifi.net."),   # NOSONAR S1313: the factory address of the router, a default the user can change
        Field("username", "Utilisateur", "text", required=True, default="admin", help="Le compte local de l'interface web, « admin » sur la plupart des Archer."),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="Le mot de passe local de l'interface web (pas celui du compte TP-Link ID)."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="à laisser décoché pour un routeur en HTTPS : son certificat est auto-signé"),
    )
    guide = ("Donne l'adresse du routeur et le compte local de son interface web : MyServices se connecte, lit l'état, puis se déconnecte, sans rien modifier.",
             "Le routeur TP-Link n'accepte qu'une seule session web à la fois : quand MyServices se connecte, la session ouverte de son propriétaire dans l'interface est fermée. MyServices lit donc toutes les 15 minutes par défaut : évite de raccourcir ce délai.",
             "Après quelques erreurs de mot de passe, le routeur bloque la connexion un moment : MyServices ne réessaie pas tant que les réglages ne changent pas.",
             "Seuls les Archer dont l'interface web est la version chiffrée « LuCI » sont lus (par exemple C6U, C6, C7, C80, C1200, AX10 à AX73 selon le firmware). Les séries MR, VR, EX et XDR et les firmwares les plus récents sont refusés avec un message. Non testé sur un vrai routeur. Les appareils Tapo ont leur propre connecteur.",
             "Sont lus : le modèle, le firmware, l'adresse IP publique, la durée de la connexion, le nombre d'appareils et l'état du Wi-Fi. Ne sont pas lus : le type de ligne, les débits, la température et les mises à jour.")

    def opener(self) -> urllib.request.OpenerDirector:
        if getattr(self, "_op", None) is None:
            tls = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in for the self-signed certificate of a router
            self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), urllib.request.HTTPSHandler(context=tls))
        return self._op

    def fetch(self, path: str, form: dict) -> bytes:
        """One POST under cgi-bin/luci/. ConnectorError « HTTP n » for an error status; never the credentials in a message."""
        req = urllib.request.Request(f"{self.base_url()}/{LUCI}{path}", data=urllib.parse.urlencode(form).encode(), method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "myservices"})
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

    @staticmethod
    def parse(raw: bytes) -> dict:
        try:
            doc = json.loads(raw)
        except ValueError:
            raise ConnectorError(UNREADABLE) from None
        if not isinstance(doc, dict):
            raise ConnectorError(UNREADABLE)
        return doc

    def plain(self, query: str) -> dict:
        """The two unencrypted calls that hand out the keys; ConnectorError(UNSUPPORTED) for a router that does not speak this scheme."""
        try:
            doc = self.parse(self.fetch(f";stok=/login?form={query}", {"operation": "read"}))
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e) in ("HTTP 404", "HTTP 400", UNREADABLE):
                raise ConnectorError(UNSUPPORTED) from None
            raise
        data = as_dict(doc.get("data"))
        if doc.get("success") is False or not data:
            raise ConnectorError(UNSUPPORTED)
        return data

    def negotiate(self) -> Session:
        sess = Session(key=secrets.token_hex(8), iv=secrets.token_hex(8))
        pwd = key_pair(self.plain("keys").get("password"))
        auth = self.plain("auth")
        sign = key_pair(auth.get("key"))
        seq = num(auth.get("seq"))
        if not pwd or not sign or seq is None or pwd[0].bit_length() > 1100:   # a 2048-bit password key is the newer, unencrypted generation
            raise ConnectorError(UNSUPPORTED)
        sess.pwd_key, sess.sign_key, sess.seq = pwd, sign, int(seq)
        user, password = str(self.conf.get("username", "")), str(self.conf.get("password", ""))
        sess.digest = hashlib.md5((user + password).encode()).hexdigest()   # NOSONAR S4790: the router's own scheme, not our choice
        return sess

    def secure(self, sess: Session, path: str, text: str, login: bool = False) -> dict:
        """One encrypted call; the clear JSON answer. ConnectorError(UNREADABLE) when the answer is not what this scheme returns."""
        data = aes_encrypt(text, sess.key, sess.iv)
        sign = f"h={sess.digest}&s={sess.seq + len(data)}"
        if login:
            sign = f"k={sess.key}&i={sess.iv}&{sign}"
        doc = self.parse(self.fetch(path, {"sign": rsa_chunks(sign, sess.sign_key), "data": data}))
        body = doc.get("data")
        if isinstance(body, str):
            return self.parse(aes_decrypt(body, sess.key, sess.iv).encode())
        return doc

    def login(self, base: str, sess: Session) -> None:
        """One attempt only. Refused or locked password: ConnectorError, remembered when refused."""
        try:
            secret = rsa_hex(str(self.conf.get("password", "")), sess.pwd_key)
        except ValueError:
            raise ConnectorError(PASSWORD_TOO_LONG) from None
        try:
            answer = self.secure(sess, ";stok=/login?form=login", f"operation=login&password={secret}&confirm=true", login=True)
        except ConnectorError as e:
            if str(e) == "HTTP 403":
                raise ConnectorError(DENIED) from None
            raise
        stok = as_dict(answer.get("data")).get("stok")
        if answer.get("success") is True and stok:
            sess.stok = str(stok)
            return
        reason = json.dumps(answer.get("data")).lower() + str(answer.get("errorcode")).lower()
        if "exceed" in reason or "lock" in reason or "forbid" in reason:
            raise ConnectorError(LOCKED)
        REFUSED_BY[base] = self.fingerprint()
        raise ConnectorError(REFUSED)

    def read(self, sess: Session, page: str, optional: bool = False) -> dict:
        """The data of a reading page; {} for an optional page the router lacks. An answer in failure is a lost session."""
        try:
            doc = self.secure(sess, f";stok={sess.stok}/{page}", "operation=read")
        except RateLimited:
            raise
        except ConnectorError as e:
            if optional and str(e).startswith("HTTP"):
                return {}
            raise
        if doc.get("success") is not True:
            if optional:
                return {}
            raise ConnectorError(SESSION_LOST)
        return as_dict(doc.get("data"))

    def logout(self, sess: Session) -> None:
        try:
            self.secure(sess, f";stok={sess.stok}/admin/system?form=logout", "operation=write")
        except ConnectorError:
            pass   # the router frees the session after its idle time

    def collect(self) -> dict:
        self._op = None
        base = self.base_url()
        if REFUSED_BY.get(base) == self.fingerprint():
            raise ConnectorError(REFUSED)
        sess = self.negotiate()
        self.login(base, sess)
        REFUSED_BY.pop(base, None)
        try:
            status = self.read(sess, "admin/status?form=all")
            firmware = self.read(sess, "admin/firmware?form=upgrade", optional=True)
        finally:
            self.logout(sess)
        if not status:
            raise ConnectorError(UNREADABLE)
        return box_card(box_of(status, firmware))
