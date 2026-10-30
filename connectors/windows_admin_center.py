"""Windows Admin Center (WAC): the servers, clusters and PCs it manages, read only, from its gateway (the web service of WAC).
Signed in with a Windows account (NTLM, connectors/ntlm.py), the way WAC asks for it by default. Reads one route:
  GET /api/connections    the connection list of the gateway: id, name, type (server, cluster, …) and tags
Nothing else is called and nothing is written. A self-signed certificate is the rule: not verified by default.

Written from the public description of the gateway (the PSWindowsAdminCenter module calls the same route), without an instance at hand:
the answer is read leniently (a list, or {"value": [...]}), and a sign-in the gateway does not offer is said in words.
"""
from __future__ import annotations

import base64
import http.client
import json
import ssl
import time
import urllib.parse

from connectors import ntlm, reqstats
from connectors.base import Connector, ConnectorError, Field, Result
from connectors.status_kit import MAX_FACTS, fact

MAX_BODY = 2_000_000
MAX_CONNECTIONS = 500
ROUTE = "/api/connections"
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


class WindowsAdminCenter(Connector):
    type = "windows-admin-center"
    label = "Windows Admin Center"
    kinds = ("status",)
    every = 300
    fields = (
        Field("url", "Adresse de Windows Admin Center", "url", required=True, help="https://<serveur>:<port> (443 ou 6600 selon l'installation)"),
        Field("user", "Compte Windows", required=True, help="DOMAINE\\utilisateur, utilisateur@domaine, ou un compte local du serveur WAC"),
        Field("password", "Mot de passe du compte", "password", required=True, secret=True, help="chiffré dans config.json, jamais renvoyé à la page"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="décoché : certificat auto-signé (cas courant)"),
    )
    setup_fields = ("url", "user", "password")
    guide = (
        "Sur le serveur qui héberge Windows Admin Center : créer un compte (ou prendre un compte de service) et l'ajouter au groupe local « Windows Admin Center Gateway Users ».",
        "Coller l'adresse de WAC, ce compte et son mot de passe ci-dessus. MyServices se connecte comme un navigateur le ferait avec un compte Windows.",
        "MyServices ne fait que lire la liste des connexions de WAC (serveurs, clusters, PC). Il n'ouvre aucune session sur ces machines.",
        "Si le test dit que la connexion par compte Windows n'est pas proposée, WAC est réglé en connexion par formulaire : ce n'est pas encore géré.",
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

    def _ask(self, conn: http.client.HTTPConnection, base: str, auth: str | None) -> tuple[int, list[str], bytes]:
        t0 = time.monotonic()
        try:
            conn.request("GET", ROUTE, headers={"Accept": "application/json", "User-Agent": "myservices", **({"Authorization": auth} if auth else {})})
            r = conn.getresponse()
            body = r.read(MAX_BODY)
            www = r.msg.get_all("WWW-Authenticate") or []
        except ssl.SSLCertVerificationError:
            raise ConnectorError("certificat non reconnu : décocher « Vérifier le certificat » (certificat auto-signé)") from None
        except (OSError, http.client.HTTPException) as e:
            msg = f"injoignable ({getattr(e, 'reason', None) or e})"
            reqstats.record(getattr(self.ctx, "owner", ""), base + ROUTE, (time.monotonic() - t0) * 1000, None, msg)
            raise ConnectorError(msg) from None
        reqstats.record(getattr(self.ctx, "owner", ""), base + ROUTE, (time.monotonic() - t0) * 1000, r.status)
        return r.status, www, body

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

    def _fetch(self) -> object:
        conn, base = self._conn()
        try:
            status, www, body = self._ask(conn, base, None)
            if status == 401:
                scheme = self._scheme(www)
                first = ntlm.negotiate()
                status, www, body = self._ask(conn, base, f"{scheme} {base64.b64encode(first).decode()}")
                if status != 401:
                    raise ConnectorError(f"réponse inattendue (HTTP {status}) à la connexion Windows")
                try:
                    domain, user = _account(str(self.conf.get("user", "")))
                    last = ntlm.authenticate(first, self._token(www, scheme), user, str(self.conf.get("password", "")), domain)
                except ValueError:
                    raise ConnectorError("réponse de connexion Windows illisible (adresse de WAC ?)") from None
                status, www, body = self._ask(conn, base, f"{scheme} {base64.b64encode(last).decode()}")
        finally:
            conn.close()
        if status == 401:
            raise ConnectorError("compte refusé (DOMAINE\\utilisateur et mot de passe ?)")
        if status == 403:
            raise ConnectorError("droits insuffisants : ajouter le compte au groupe « Windows Admin Center Gateway Users »")
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
