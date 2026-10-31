"""Sagemcom F@st boxes (Bell Home Hub, Proximus b-box, Telia, KPN Box, Orange Spain…), read by their JSON interface: a form POST of `req=<json>` on /cgi/json-req.
Read-only: one login, one getValue request, one logout; only getValue is ever sent. The password never travels: the box wants a hash of it (MD5 or SHA512
according to the model) mixed with a nonce, and the same hash is the only thing kept. A refused login stops the reading at its first call (these boxes lock
logins after a few wrong ones), and the connector never tries the other encryption by itself.
Written from the python-sagemcom-api library (the legacy mode only: the « rest » firmware and MD5_NONCE are not handled), not tested on a real box. That library reads no WAN
state and no public address: those fields, the line type and the connection uptime stay None (DeviceInfo/UpTime is the box's own uptime, not the connection's).
KPN changed its firmware in 2025: not guaranteed there.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import urllib.parse

from connectors.base import ConnectorError, Field, RateLimited
from connectors.box_kit import Box, box_card
from connectors.status_kit import StatusConnector

ENDPOINT = "/cgi/json-req"
HASHES = {"MD5": hashlib.md5, "SHA512": hashlib.sha512}  # NOSONAR the box asks for MD5 or SHA512 depending on the model, the login protocol imposes it
REFUSED = {
    "XMO_AUTHENTICATION_ERR": "utilisateur ou mot de passe refusé par la box : vérifie le compte et le chiffrement (MD5 ou SHA512 selon le modèle)",
    "XMO_ACCESS_RESTRICTION_ERR": "ce compte n'a pas le droit de lire la box : essaie un autre utilisateur (admin, ou guest sur certaines Bell)",
    "XMO_MAX_SESSION_COUNT_ERR": "la box a déjà trop de sessions ouvertes : ferme son interface web et réessaie dans quelques minutes",
    "XMO_LOGIN_RETRY_ERR": "la box bloque les connexions après trop d'essais : attends quelques minutes avant de réessayer",
}
OK = ("XMO_REQUEST_NO_ERR", "XMO_NO_ERR", "Ok")
SESSION_OPTIONS = {   # the options the library sends at login: values come back with the names the box gives them
    "nss": [{"name": "gtw", "uri": "http://sagemcom.com/gateway-data"}], "language": "ident", "context-flags": {"get-content-name": True, "local-time": True},
    "capability-depth": 2, "capability-flags": {"name": True, "default-value": False, "restriction": True, "description": False},
    "time-format": "ISO_8601", "write-only-string": "_XMO_WRITE_ONLY_", "undefined-write-only-string": "_XMO_UNDEFINED_WRITE_ONLY_"}


def key(name: object) -> str:
    """A field name as the box spells it (UpTime, up_time, Up-Time) compared as one."""
    return str(name).replace("_", "").replace("-", "").lower()


def pick(data: object, *names: str):
    """The first non-empty value of a dict under one of these names, whatever their case; None when there is none."""
    if not isinstance(data, dict):
        return None
    flat = {key(k): v for k, v in data.items()}
    return next((flat[key(n)] for n in names if flat.get(key(n)) not in (None, "", [], {})), None)


def text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def count_active(hosts: object) -> int | None:
    """The connected devices of Device/Hosts/Hosts (a list of hosts, each one bare or wrapped under « Host »); None when the list is not one."""
    if isinstance(hosts, dict):
        hosts = pick(hosts, "Hosts", "Host")
    if not isinstance(hosts, list):
        return None
    rows = [pick(h, "Host") or h for h in hosts if isinstance(h, dict)]
    return sum(1 for h in rows if pick(h, "Active") is True)


class SagemcomFast(StatusConnector):
    type = "sagemcom-fast"
    label = "Sagemcom F@st"
    fields = (
        Field("url", "Adresse de la box", "url", required=True, default="http://192.168.1.1", help="L'adresse de son interface web, souvent http://192.168.1.1 (ou http://192.168.2.1)."),
        Field("username", "Utilisateur", "text", required=True, default="admin", help="admin en général ; guest sur certaines box Bell."),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("encryption", "Chiffrement du mot de passe", "choice", default="SHA512", choices=("MD5", "SHA512"),
              help="Selon le modèle : SHA512 pour les plus récentes (Bell Home Hub 3000, Proximus b-box 3), MD5 pour les plus anciennes."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour le certificat auto-signé de la box"),
    )
    guide = ("Utilise le compte de l'interface web de la box (celui de la page de connexion). MyServices ne fait que lire.",
             "Le chiffrement dépend du modèle : si la connexion est refusée avec le bon mot de passe, essaie l'autre choix une seule fois (la box bloque les connexions après trop d'essais).",
             "Bell, Proximus, Telia, KPN, Orange Espagne : même famille Sagemcom F@st. KPN a changé son firmware en 2025 : non garanti.",
             "La box ne dit ici ni l'adresse IP publique, ni le type de ligne, ni les débits : ces informations ne sont pas montrées.")

    def __init__(self, conf: dict, ctx):
        super().__init__(conf, ctx)
        self.request_id, self.session_id, self.server_nonce = -1, 0, ""

    def digest(self, value: str) -> str:
        return HASHES[self.encryption()](value.encode()).hexdigest()  # NOSONAR S4790: the hash the box firmware requires

    def encryption(self) -> str:
        choice = str(self.conf.get("encryption") or "SHA512").upper()
        if choice not in HASHES:
            raise ConnectorError("chiffrement : MD5 ou SHA512 attendu")
        return choice

    def post(self, actions: list[dict], priority: bool = False) -> dict:
        """One request of the box: its `reply`, or a ConnectorError for a request-level refusal (never the password)."""
        self.request_id += 1
        cnonce = secrets.randbelow(500000)
        credential = self.digest(f"{self.conf.get('username', '')}:{self.server_nonce}:{self.digest(str(self.conf.get('password', '')))}")
        req = {"request": {"id": self.request_id, "session-id": int(self.session_id), "priority": priority, "actions": actions, "cnonce": cnonce,
                           "auth-key": self.digest(f"{credential}:{self.request_id}:{cnonce}:JSON:{ENDPOINT}")}}
        try:
            answer = self.ctx.http(self.base_url() + ENDPOINT, method="POST", form={"req": json.dumps(req, separators=(",", ":"))}, verify_tls=self.tls())
        except RateLimited:
            raise
        except ConnectorError as e:
            if str(e).startswith(("HTTP 400", "HTTP 404")):
                raise ConnectorError("cet appareil ne répond pas comme une Sagemcom F@st : vérifie l'adresse (celle de son interface web)") from None
            raise
        reply = answer.get("reply") if isinstance(answer, dict) else None
        error = reply.get("error") if isinstance(reply, dict) else None
        if not isinstance(error, dict):
            raise ConnectorError("réponse illisible : ce n'est pas une Sagemcom F@st, ou son firmware n'est pas géré")
        description = error.get("description")
        if description in REFUSED:
            raise ConnectorError(REFUSED[description])
        if description not in OK and description != "XMO_REQUEST_ACTION_ERR":
            raise ConnectorError("la box refuse la lecture : firmware non géré ?")
        return reply

    @staticmethod
    def outcome(reply: dict, index: int) -> tuple[dict, str | None]:
        """(parameters of the callback, error description) of one action of a reply; the error is None when the action went well."""
        try:
            action = reply["actions"][index]
            error = action["error"]["description"]
            return (action["callbacks"][0]["parameters"] if error in OK else {}), (None if error in OK else str(error))
        except (KeyError, IndexError, TypeError):
            return {}, "unreadable"

    def login(self) -> None:
        action = {"id": 0, "method": "logIn", "parameters": {"user": str(self.conf.get("username", "")), "persistent": True, "session-options": SESSION_OPTIONS}}
        params, error = self.outcome(self.post([action], True), 0)
        if error in REFUSED or not isinstance(params, dict) or params.get("id") is None or params.get("nonce") is None:
            raise ConnectorError(REFUSED["XMO_AUTHENTICATION_ERR"])
        self.session_id, self.server_nonce = params["id"], str(params["nonce"])

    def logout(self) -> None:
        """Best effort: the box keeps few sessions, but a failed logout must not hide the reading."""
        try:
            self.post([{"id": 0, "method": "logOut"}])
        except ConnectorError:
            pass

    def collect(self) -> dict:
        self.request_id, self.session_id, self.server_nonce = -1, 0, ""
        self.login()   # the first call with the password: a refused one stops here
        try:
            paths = ("Device/DeviceInfo", "Device/Hosts/Hosts")
            actions = [{"id": i, "method": "getValue", "xpath": urllib.parse.quote(p, "/=[]'@\""), "options": {"capability-flags": {"interface": True}} if i else {}}
                       for i, p in enumerate(paths)]
            reply = self.post(actions)
        finally:
            self.logout()
        (info, info_error), (hosts, _) = self.outcome(reply, 0), self.outcome(reply, 1)   # the hosts are optional, the identity is not
        info = pick(info.get("value"), "DeviceInfo") or info.get("value")
        if info_error or not isinstance(info, dict):
            raise ConnectorError("la box répond mais refuse la lecture de ses informations : vérifie le compte utilisé")
        return box_card(Box(model=text(pick(info, "ModelName", "ModelNumber", "ProductClass")), firmware=text(pick(info, "SoftwareVersion", "ExternalFirmwareVersion")),
                            devices=count_active(hosts.get("value"))))
