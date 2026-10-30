"""Windows Admin Center (WAC): the servers, clusters and PCs it manages, read only, from its gateway (the web service of WAC).
Two sign-ins, the gateway says which by its first answer:
  401 with a challenge    a Windows account (NTLM, connectors/ntlm.py), the older gateways
  403 with no challenge   the login page of the recent gateways (port 20443), the same calls as that page: a csrf value in the page,
                          POST /api/user/key gives a public key, POST /api/user/login takes {username, password, csrf} under RSA-OAEP SHA-256
Reads one route:
  GET /api/connections    the connection list of the gateway: id, name, type (server, cluster, …) and tags
Nothing else is read and nothing is written. A self-signed certificate is the rule: not verified by default.

Written from the public description of the gateway (the PSWindowsAdminCenter module calls the same route) and the code of the login page,
without an instance at hand: the answer is read leniently (a list, or {"value": [...]}), and a sign-in the gateway does not offer is said in words.
"""
from __future__ import annotations

import base64
import html
import http.client
import json
import re
import ssl
import time
import urllib.parse

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from connectors import ntlm, reqstats
from connectors.base import Connector, ConnectorError, Field, Result
from connectors.status_kit import MAX_FACTS, fact

MAX_BODY = 2_000_000
MAX_CONNECTIONS = 500
ROUTE = "/api/connections"
KEY_ROUTE = "/api/user/key"
LOGIN_ROUTE = "/api/user/login"
KINDS = {"server": "server", "cluster": "cluster", "hyperconvergedcluster": "cluster", "windowsclient": "pc", "clientconnection": "pc"}


def _items(got) -> list[dict]:
    if isinstance(got, dict):
        got = got.get("value") or got.get("connections") or got.get("items") or []
    return [x for x in got if isinstance(x, dict)] if isinstance(got, list) else []


def _row(x: dict) -> dict:
    ident = str(x.get("id") or "")
    kind = str(x.get("type") or ident.split("!")[0] or "").rsplit(".", 1)[-1]
    tags = x.get("tags")
    return {"id": ident, "name": str(x.get("name") or ident.split("!")[-1]), "kind": KINDS.get(kind.lower(), kind.lower() or "other"),
            "tags": [str(t) for t in tags][:10] if isinstance(tags, list) else []}


def _account(user: str) -> tuple[str, str]:
    """(domain, user) from « DOMAIN\\user »; « user@domain » and a local account are sent as they are, with no domain."""
    domain, sep, name = user.partition("\\")
    return (domain, name) if sep else ("", user)


def _csrf(page: str) -> str:
    """The value of the hidden csrf field of the login page, empty if there is none."""
    for tag in re.findall(r"<input\b[^<>]*>", page, re.IGNORECASE):
        if re.search(r"""\bname\s*=\s*["']csrf["']""", tag, re.IGNORECASE):
            found = re.search(r"""\bvalue\s*=\s*["']([^"']*)["']""", tag, re.IGNORECASE)
            return html.unescape(found.group(1)) if found else ""
    return ""


def _number(text: str) -> int:
    return int.from_bytes(base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)), "big")


def _packet(jwk: dict, data: str) -> str:
    """What the login page does with crypto.subtle: RSA-OAEP with SHA-256 on the UTF-8 text, in standard base64."""
    key = rsa.RSAPublicNumbers(_number(jwk["e"]), _number(jwk["n"])).public_key()
    sealed = key.encrypt(data.encode(), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return base64.b64encode(sealed).decode()


def _keep_cookies(jar: dict, head) -> None:
    for line in head.get_all("Set-Cookie") or []:
        name, _, value = line.split(";", 1)[0].partition("=")
        if value:
            jar[name.strip()] = value.strip()
        else:
            jar.pop(name.strip(), None)   # an empty value is the gateway clearing the cookie


class WindowsAdminCenter(Connector):
    type = "windows-admin-center"
    label = "Windows Admin Center"
    kinds = ("status",)
    every = 300
    fields = (
        Field("url", "Adresse de Windows Admin Center", "url", required=True, help="https://<serveur>:<port> (20443 sur les versions récentes, sinon 443 ou 6600)"),
        Field("user", "Compte Windows", required=True, help="DOMAINE\\utilisateur, utilisateur@domaine, ou un compte local du serveur WAC"),
        Field("password", "Mot de passe du compte", "password", required=True, secret=True, help="chiffré dans config.json, jamais renvoyé à la page"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="décoché : certificat auto-signé (cas courant)"),
    )
    setup_fields = ("url", "user", "password")
    guide = (
        "Prendre un compte Windows autorisé à ouvrir Windows Admin Center : par défaut tout membre du groupe local « Utilisateurs » du serveur WAC, sinon un des groupes réglés dans WAC (Paramètres, Accès).",
        "Coller l'adresse de WAC, ce compte et son mot de passe ci-dessus. MyServices se connecte comme un navigateur le ferait avec un compte Windows.",
        "MyServices ne fait que lire la liste des connexions de WAC (serveurs, clusters, PC). Il n'ouvre aucune session sur ces machines.",
        "Les versions récentes de WAC (page de connexion, port 20443) et les anciennes (connexion Windows) sont gérées toutes les deux : rien à choisir.",
    )

    def _conn(self) -> tuple[http.client.HTTPConnection, str]:
        parts = urllib.parse.urlsplit(self.conf["url"].strip())
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ConnectorError("adresse de Windows Admin Center invalide (https://serveur:port)")
        timeout = getattr(self.ctx, "timeout", 15)
        if parts.scheme == "http":
            return http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout), f"{parts.scheme}://{parts.netloc}"
        context = None if self.conf.get("verify_tls") else ssl._create_unverified_context()  # NOSONAR S5527 ; certificat auto-signé (cas courant de WAC)
        return http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=timeout, context=context), f"{parts.scheme}://{parts.netloc}"

    def _ask(self, conn: http.client.HTTPConnection, base: str, path: str = ROUTE, *, auth: str | None = None, cookies: dict | None = None,
             payload: dict | None = None) -> tuple[int, object, bytes]:
        headers = {"Accept": "application/json", "User-Agent": "myservices"}
        if auth:
            headers["Authorization"] = auth
        if cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
        if payload is not None:
            headers["Content-Type"] = "application/json"
        t0 = time.monotonic()
        try:
            conn.request("POST" if payload is not None else "GET", path, None if payload is None else json.dumps(payload), headers)
            r = conn.getresponse()
            body = r.read(MAX_BODY)
        except ssl.SSLCertVerificationError:
            raise ConnectorError("certificat non reconnu : décocher « Vérifier le certificat » (certificat auto-signé)") from None
        except (OSError, http.client.HTTPException) as e:
            msg = f"injoignable ({getattr(e, 'reason', None) or e})"
            reqstats.record(getattr(self.ctx, "owner", ""), base + path, (time.monotonic() - t0) * 1000, None, msg)
            raise ConnectorError(msg) from None
        reqstats.record(getattr(self.ctx, "owner", ""), base + path, (time.monotonic() - t0) * 1000, r.status)
        return r.status, r.msg, body

    @staticmethod
    def _scheme(www: list[str]) -> str:
        offered = {w.split(None, 1)[0].lower() for w in www if w.strip()}
        for name in ("NTLM", "Negotiate"):
            if name.lower() in offered:
                return name
        raise ConnectorError("la connexion par compte Windows n'est pas proposée par cette passerelle (connexion par formulaire ?)")

    @staticmethod
    def _token(www: list[str], scheme: str) -> bytes:
        for w in www:
            head, _, value = w.strip().partition(" ")
            if head.lower() == scheme.lower() and value.strip():
                raw = base64.b64decode(value.strip())
                at = raw.find(ntlm.SIGNATURE)   # under « Negotiate » the message may sit inside a wrapper
                if at >= 0:
                    return raw[at:]
        raise ConnectorError("la passerelle n'a pas répondu à la connexion Windows (NTLM)")

    def _windows_sign_in(self, conn: http.client.HTTPConnection, base: str, head) -> tuple[int, bytes]:
        scheme = self._scheme(head.get_all("WWW-Authenticate") or [])
        first = ntlm.negotiate()
        status, head, _ = self._ask(conn, base, auth=f"{scheme} {base64.b64encode(first).decode()}")
        if status != 401:
            raise ConnectorError(f"réponse inattendue (HTTP {status}) à la connexion Windows")
        try:
            domain, user = _account(str(self.conf.get("user", "")))
            last = ntlm.authenticate(first, self._token(head.get_all("WWW-Authenticate") or [], scheme), user, str(self.conf.get("password", "")), domain)
        except ValueError:
            raise ConnectorError("réponse de connexion Windows illisible (adresse de WAC ?)") from None
        status, _, body = self._ask(conn, base, auth=f"{scheme} {base64.b64encode(last).decode()}")
        return status, body

    def _page_sign_in(self, conn: http.client.HTTPConnection, base: str) -> tuple[int, bytes]:
        jar: dict = {}

        def step(path: str, payload: dict | None = None) -> tuple[int, bytes]:
            status, head, body = self._ask(conn, base, path, cookies=jar, payload=payload)
            _keep_cookies(jar, head)
            return status, body

        csrf = _csrf(step("/")[1].decode("utf-8", "replace"))
        if not csrf:
            raise ConnectorError("page de connexion de Windows Admin Center non reconnue (pas de jeton csrf)")
        status, body = step(KEY_ROUTE, {"csrf": csrf})
        if status != 200:
            raise ConnectorError(f"la passerelle refuse la clé de connexion (HTTP {status})")
        identity = {"username": str(self.conf.get("user", "")), "password": str(self.conf.get("password", "")), "csrf": csrf}
        try:   # same text as JSON.stringify in the page
            packet = _packet(json.loads(body)["jwk"], json.dumps(identity, separators=(",", ":"), ensure_ascii=False))
        except (ValueError, KeyError, TypeError):
            raise ConnectorError("clé de connexion illisible (adresse de Windows Admin Center ?)") from None
        status, _ = step(LOGIN_ROUTE, {"packet": packet, "csrf": csrf})
        if status != 200:
            raise ConnectorError("compte refusé (DOMAINE\\utilisateur et mot de passe ?)")
        return step(ROUTE)

    def _fetch(self) -> object:
        conn, base = self._conn()
        try:
            status, head, body = self._ask(conn, base)
            if status == 401:
                status, body = self._windows_sign_in(conn, base, head)
            elif status == 403:   # recent gateways: a JSON « sign in again », no challenge
                status, body = self._page_sign_in(conn, base)
        finally:
            conn.close()
        if status == 401:
            raise ConnectorError("compte refusé (DOMAINE\\utilisateur et mot de passe ?)")
        if status == 403:
            raise ConnectorError("droits insuffisants : ce compte n'a pas accès à la passerelle (WAC, Paramètres, Accès)")
        if status != 200:
            raise ConnectorError(f"HTTP {status}")
        try:
            return json.loads(body or b"null")
        except ValueError:
            raise ConnectorError("réponse qui n'est pas du JSON (adresse de Windows Admin Center ?)") from None

    def collect(self) -> dict:
        rows = [_row(x) for x in _items(self._fetch())][:MAX_CONNECTIONS]
        count = {k: sum(1 for r in rows if r["kind"] == k) for k in ("server", "cluster", "pc")}
        facts = [fact("Connexions", len(rows)), fact("Serveurs", count["server"])]
        if count["cluster"]:
            facts.append(fact("Clusters", count["cluster"]))
        if count["pc"]:
            facts.append(fact("PC", count["pc"]))
        return {"version": None, "facts": facts[:MAX_FACTS], "problems": [], "connections": rows}

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{len(d['connections'])} connexion(s) lue(s)")
