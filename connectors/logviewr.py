"""LogviewR : fail2ban (prisons, bannissements, menaces) et recherche dans les journaux, en lecture seule, par son serveur MCP.

LogviewR n'a pas d'API REST à jeton : il parle MCP (Streamable HTTP, sans état) sur POST /mcp, avec un jeton « Lecture seule »
(Réglages → MCP → Jetons d'accès). Il faut y activer « Transport HTTP distant » (désactivé par défaut). MyServices n'appelle que
des outils de lecture : f2b_list_jails, f2b_get_metrics, f2b_get_ban_history, f2b_get_active_threats, log_list_sources.
Jamais f2b_ban_ip, f2b_unban_ip, f2b_jail_start, f2b_jail_stop (écriture) : un jeton « read » les refuserait de toute façon.
Les textes des journaux viennent d'attaquants : seuls des nombres, des IP et des noms de prison sont gardés, aucun texte libre.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from connectors.base import Connector, ConnectorError, Field, Result

PROTOCOL = "2025-06-18"
READ_TOOLS = ("f2b_list_jails", "f2b_get_metrics", "f2b_get_ban_history", "f2b_get_active_threats", "log_list_sources")


def _body(raw: bytes, ctype: str) -> dict:
    """Réponse JSON-RPC, simple ou en flux « text/event-stream » (dernière ligne data:)."""
    text = raw.decode("utf-8", "replace")
    if "text/event-stream" in ctype:
        datas = [ln[5:].strip() for ln in text.splitlines() if ln.startswith("data:")]
        text = datas[-1] if datas else ""
    try:
        got = json.loads(text or "null")
    except ValueError:
        raise ConnectorError("réponse qui n'est pas du JSON (URL de LogviewR ? /mcp activé ?)") from None
    if not isinstance(got, dict):
        raise ConnectorError("réponse MCP inattendue")
    return got


def cluster(c: dict) -> dict:
    """An active threat (LogviewR ThreatCluster) reduced to safe fields: kind, IPs, jails, numbers and the AS number. The whois
    organisation name is left out: free text written by third parties."""
    ips = [str(i) for i in c.get("ips") or [] if isinstance(i, str) and re.fullmatch(r"[0-9a-fA-F:.]{3,45}", i)]
    return {"key": str(c.get("clusterKey") or "")[:80], "kind": c.get("kind") if c.get("kind") in ("ip_escalation", "asn_campaign") else "autre",
            "ips": ips[:20], "ip_count": len(ips), "jails": [str(j)[:40] for j in c.get("jails") or [] if isinstance(j, str)][:10],
            "bans": c.get("totalBans") if isinstance(c.get("totalBans"), int) else None,
            "first": c.get("firstSeen") if isinstance(c.get("firstSeen"), (int, float)) else None,
            "last": c.get("lastSeen") if isinstance(c.get("lastSeen"), (int, float)) else None,
            "severity": c.get("severity") if isinstance(c.get("severity"), (int, float)) else None,
            "asn": str(c["asn"])[:20] if isinstance(c.get("asn"), (str, int)) and re.fullmatch(r"(AS)?\d{1,10}", str(c["asn"])) else None}


class LogviewR(Connector):
    type = "logviewr"
    label = "LogviewR"
    kinds = ("security",)
    images = ("ghcr.io/erreur32/logviewr", "erreur32/logviewr")
    tested = ("0.",)
    fields = (
        Field("url", "URL de LogviewR", "url", required=True, help="ex. http://192.168.1.10:3000 (sans /mcp)"),
        Field("token", "Jeton MCP en lecture seule", "password", required=True, secret=True,
              help="LogviewR → Réglages → MCP → Jetons d'accès : portée « Lecture seule ». Montré une seule fois."),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True),
    )
    setup_fields = ("url", "token")
    guide = (
        "Dans LogviewR : Réglages → MCP → Vue d'ensemble : activer « Transport HTTP distant ».",
        "Jetons d'accès : créer un jeton nommé « MyServices », portée « Lecture seule ».",
        "Copier le jeton tout de suite : il n'est montré qu'une fois. Un jeton « Lecture/écriture » est refusé par MyServices.",
    )

    def _rpc(self, method: str, params: dict | None = None, rid: int = 1) -> dict:
        payload = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            payload["params"] = params
        req = urllib.request.Request(
            self.conf["url"].rstrip("/") + "/mcp", data=json.dumps(payload).encode(), method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                     "Authorization": f"Bearer {self.conf['token']}", "User-Agent": "myservices"})
        ctx = None
        if self.conf.get("verify_tls", True) is False:
            import ssl
            ctx = ssl._create_unverified_context()
        try:
            with urllib.request.urlopen(req, timeout=self.ctx.timeout, context=ctx) as r:
                got = _body(r.read(), r.headers.get("Content-Type", ""))
        except urllib.error.HTTPError as e:
            hint = {401: " : jeton refusé", 403: " : accès refusé (réseau, ou transport HTTP distant coupé)", 404: " : /mcp introuvable"}.get(e.code, "")
            raise ConnectorError(f"HTTP {e.code}{hint}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e)})") from None
        if got.get("error"):
            raise ConnectorError(f"MCP : {str((got['error'] or {}).get('message') or got['error'])[:160]}")
        return got.get("result") or {}

    def version(self) -> str | None:
        if not hasattr(self, "_info"):
            self._info = self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                                  "clientInfo": {"name": "myservices", "version": "1"}}).get("serverInfo") or {}
        v = self._info.get("version")
        # LogviewR declares its MCP server as a fixed « 1.0.0 », not the app version (0.x): shown only once it is the real one
        return str(v) if v and str(v) != "1.0.0" else None

    def _tool(self, name: str, args: dict | None = None):
        if name not in READ_TOOLS:  # garde-fou : jamais un outil d'écriture
            raise ConnectorError(f"outil « {name} » non autorisé")
        res = self._rpc("tools/call", {"name": name, "arguments": args or {}}, rid=2)
        texts = [c.get("text") or "" for c in res.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"]
        if res.get("isError"):
            raise ConnectorError(f"{name} : {str(texts[0] if texts else 'erreur')[:160]}")
        # Tools that return attacker-written data (f2b_get_active_threats, f2b_lookup_ip, log_search) send a notice first
        # (« UNTRUSTED DATA: … ») and the JSON in a second block: the first block that parses is the payload
        for text in texts:
            try:
                return json.loads(text)
            except ValueError:
                continue
        raise ConnectorError(f"{name} : réponse illisible")

    def collect(self) -> dict:
        jails = self._tool("f2b_list_jails")
        names = [j if isinstance(j, str) else (j or {}).get("name") for j in (jails or {}).get("jails") or []]
        events = (self._tool("f2b_get_ban_history", {"days": 1, "limit": 1000}) or {}).get("events") or []
        threats = self._tool("f2b_get_active_threats")
        metrics = self._tool("f2b_get_metrics")
        sources = (self._tool("log_list_sources") or {}).get("sources") or []
        bans = [{"ip": e.get("ip"), "jail": e.get("jail"), "time": e.get("timeofban"), "failures": e.get("failures")}
                for e in events if isinstance(e, dict)]
        lists = threats if isinstance(threats, list) else [v for v in (threats or {}).values() if isinstance(v, list)] if isinstance(threats, dict) else []
        raw = lists if lists and isinstance(threats, list) else lists[0] if lists else []
        return {"jails": [n for n in names if n], "bans_24h": len(bans), "bans": bans[:200],
                "threat_count": len(raw), "threats": [cluster(c) for c in raw if isinstance(c, dict)][:50],
                "metrics": metrics if isinstance(metrics, dict) else None,
                "log_sources": len(sources)}

    def test(self) -> Result:
        try:
            v = self.version()
            data = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, f"{len(data['jails'])} prison(s), {data['bans_24h']} bannissement(s) en 24 h", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        web = next((h for h, c in ports if c in (3000, 8080, 5173)), None)
        return {"url": f"http://{ip}:{web}"} if web else None
