"""Home Assistant par le module complémentaire « ha-mcp » (serveur MCP communautaire), en lecture seule.

Ce n'est PAS le MCP natif de Home Assistant (celui-là ne sert qu'à l'assistant vocal et ne connaît ni les sauvegardes ni les réparations) :
ha-mcp est un module à installer à part, qui expose environ 80 outils, dont certains modifient Home Assistant. MyServices n'en appelle que
six, avec des arguments fixes de lecture (liste ci-dessous) : jamais d'installation, de suppression, de restauration ni de création.
Les outils mixtes (ha_manage_backup, ha_manage_updates) ne sont appelés qu'avec action = « list ». Le mode lecture seule de ha-mcp
(BACKUP_READ_ONLY=true, Read Only Mode) reste conseillé : il double cette garde côté serveur.

Transport : Streamable HTTP sur l'adresse affichée par le module (elle contient un chemin secret, donc traitée comme un secret).
Ce que l'on obtient en plus de l'API REST : la liste réelle des sauvegardes (date, taille, chiffrée ou non, où elles sont copiées), les
réparations signalées, la validité de la configuration, l'état des modules complémentaires et des intégrations.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from connectors.base import ConnectorError

PROTOCOL = "2025-06-18"

# Les SEULS appels faits à ha-mcp : (outil, arguments fixes). Une clé hors de cette table n'existe pas pour le code.
READ_CALLS: dict[str, tuple[str, dict]] = {
    "backups": ("ha_manage_backup", {"scope": "snapshot", "action": "list", "limit": 100}),
    "overview": ("ha_get_overview", {"detail_level": "minimal", "include_notifications": True,
                                     "fields": ["system_info", "notifications", "repairs", "repair_count"]}),
    "updates": ("ha_manage_updates", {"action": "list"}),
    "health": ("ha_get_system_health", {"include": "repairs,config_check"}),
    "apps": ("ha_get_app", {"source": "installed"}),
    "integrations": ("ha_get_integration", {"limit": 200}),
}
WRITE_ACTIONS = {"create", "restore", "delete", "install", "skip", "clear_skipped", "ignore_repair", "unignore_repair"}


def assert_read_only() -> None:
    """Garde de conception (testée) : aucun appel de la table ne porte une action d'écriture, et les outils mixtes sont en « list »."""
    for key, (tool, args) in READ_CALLS.items():
        if args.get("action") in WRITE_ACTIONS:
            raise AssertionError(f"{key}: action d'écriture {args['action']}")
        if tool in ("ha_manage_backup", "ha_manage_updates") and args.get("action") != "list":
            raise AssertionError(f"{key}: {tool} doit rester en action « list »")
        if tool == "ha_manage_backup" and args.get("scope") != "snapshot":
            raise AssertionError(f"{key}: sauvegardes complètes seulement")


def _text(v, n: int = 160) -> str:
    return str(v)[:n] if isinstance(v, (str, int, float)) else ""


def _epoch(v) -> int | None:
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except (TypeError, ValueError):
        return None


def _int(v) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


# ───────────── Réponses d'outils -> données sûres et courtes ─────────────

def parse_backups(p: dict) -> dict:
    """Sauvegardes complètes de Home Assistant. `locations` : où chacune est stockée (« local » = Home Assistant lui-même ; tout autre
    agent, comme un NAS ou un cloud, est une copie ailleurs). `offsite` : au moins une sauvegarde est aussi copiée hors de Home Assistant."""
    rows = []
    for b in p.get("backups") or []:
        if not isinstance(b, dict) or not b.get("backup_id"):
            continue
        agents = [a for a in b.get("agent_ids") or [] if isinstance(a, str)]
        rows.append({"id": _text(b["backup_id"], 64), "name": _text(b.get("name"), 120), "date": _epoch(b.get("date")),
                     "size": _int(b.get("size_bytes")) or 0, "protected": bool(b.get("protected")),
                     "database": bool(b.get("database_included")), "ha_version": _text(b.get("homeassistant_version"), 40),
                     "auto": bool(b.get("with_automatic_settings")),
                     "locations": [a.rsplit(".", 1)[-1][:60] for a in agents][:8], "offsite": any(not a.endswith(".local") for a in agents)})
    rows.sort(key=lambda r: r["date"] or 0, reverse=True)
    return {"total": _int(p.get("total")) if _int(p.get("total")) is not None else len(rows), "items": rows[:100],
            "offsite": any(r["offsite"] for r in rows[:1])}   # la plus récente est-elle copiée ailleurs ?


def parse_overview(p: dict) -> dict:
    si = p.get("system_info") if isinstance(p.get("system_info"), dict) else {}
    notes = [{"title": _text(n.get("title"), 120), "created": _epoch(n.get("created_at"))}
             for n in p.get("notifications") or [] if isinstance(n, dict)]
    return {"version": _text(si.get("version"), 40), "state": _text(si.get("state"), 30), "notifications": notes[:20],
            "repairs": _int(p.get("repair_count")) or 0}


def parse_updates(p: dict) -> dict:
    cats = p.get("categories") if isinstance(p.get("categories"), dict) else {}
    return {"available": _int(p.get("updates_available")) or 0, "skipped": _int(p.get("skipped_count")) or 0,
            "categories": {_text(k, 30): v for k, v in cats.items() if isinstance(v, int)}}


def parse_health(p: dict) -> dict:
    rep = p.get("repairs") if isinstance(p.get("repairs"), dict) else {}
    chk = p.get("config_check") if isinstance(p.get("config_check"), dict) else {}
    issues = [{k: _text(i.get(k), 80) for k in ("domain", "issue_id", "severity") if i.get(k)} for i in rep.get("issues") or [] if isinstance(i, dict)]
    return {"config_ok": chk.get("is_valid") if isinstance(chk.get("is_valid"), bool) else None,
            "config_errors": [_text(e, 160) for e in chk.get("errors") or []][:5],
            "repairs": issues[:20], "repairs_count": _int(rep.get("count")) if _int(rep.get("count")) is not None else len(issues),
            "components": _int(p.get("component_count")) or 0}


def parse_apps(p: dict) -> dict:
    s = p.get("summary") if isinstance(p.get("summary"), dict) else {}
    apps = [{"name": _text(a.get("name"), 80), "slug": _text(a.get("slug"), 80), "version": _text(a.get("version"), 40),
             "state": _text(a.get("state"), 20), "update": bool(a.get("update_available"))}
            for a in p.get("addons") or [] if isinstance(a, dict) and a.get("slug")]
    return {"total": _int(s.get("total_installed")) if _int(s.get("total_installed")) is not None else len(apps),
            "running": _int(s.get("running")) or 0, "stopped": _int(s.get("stopped")) or 0, "updates": _int(s.get("updates_available")) or 0,
            "items": apps[:80]}


# États d'erreur d'une intégration. « not_loaded » n'en est pas un : c'est l'état d'une intégration désactivée ou en veille (32 sur 187 chez l'auteur)
INTEGRATION_ERRORS = ("setup_error", "setup_retry", "migration_error", "failed_unload")


def parse_integrations(p: dict) -> dict:
    states = p.get("state_summary") if isinstance(p.get("state_summary"), dict) else {}
    bad = [{"domain": _text(e.get("domain"), 60), "title": _text(e.get("title"), 80), "state": _text(e.get("state"), 30)}
           for e in p.get("entries") or [] if isinstance(e, dict) and e.get("state") in INTEGRATION_ERRORS]
    return {"total": _int(p.get("total_count")) or 0, "states": {_text(k, 30): v for k, v in states.items() if isinstance(v, int)}, "problems": bad[:15]}


PARSERS = {"backups": parse_backups, "overview": parse_overview, "updates": parse_updates, "health": parse_health,
           "apps": parse_apps, "integrations": parse_integrations}


# ───────────── Client MCP (Streamable HTTP) ─────────────

def _body(raw: bytes, ctype: str) -> dict:
    text = raw.decode("utf-8", "replace")
    if "text/event-stream" in ctype:
        datas = [ln[5:].strip() for ln in text.splitlines() if ln.startswith("data:")]
        text = datas[-1] if datas else ""
    if not text.strip():
        return {}
    try:
        got = json.loads(text)
    except ValueError:
        raise ConnectorError("réponse qui n'est pas du JSON : l'adresse ne mène pas à ha-mcp ?") from None
    if not isinstance(got, dict):
        raise ConnectorError("réponse MCP inattendue")
    return got


def _payload(tool: str, res: dict) -> dict:
    """Premier bloc de texte de la réponse d'un outil qui est du JSON ; erreur lisible si l'outil a échoué ou si rien n'est lisible."""
    texts = [c.get("text") or "" for c in res.get("content") or [] if isinstance(c, dict) and c.get("type") == "text"]
    if res.get("isError"):
        raise ConnectorError(f"{tool} : {_text(texts[0] if texts else 'erreur', 160)}")
    for t in texts:
        try:
            got = json.loads(t)
        except ValueError:
            continue
        if isinstance(got, dict) and got.get("success") is False:
            raise ConnectorError(f"{tool} : {_text(got.get('error') or got.get('message') or 'refusé', 160)}")
        return got if isinstance(got, dict) else {}
    raise ConnectorError(f"{tool} : réponse illisible")


class HaMcp:
    def __init__(self, url: str, timeout: float = 30):
        if urllib.parse.urlsplit(str(url or "")).scheme not in ("http", "https"):
            raise ConnectorError("adresse MCP : http://<IP>:<port>/<chemin> attendu (celle affichée par le module ha-mcp)")
        self.url, self.timeout, self.sid, self.n, self.ready = str(url).strip(), timeout, None, 0, False

    def _rpc(self, method: str, params: dict | None = None, notify: bool = False) -> dict:
        msg: dict = {"jsonrpc": "2.0", "method": method}
        if not notify:
            self.n += 1
            msg["id"] = self.n
        if params is not None:
            msg["params"] = params
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": "myservices"}
        if self.sid:
            headers["Mcp-Session-Id"] = self.sid
        req = urllib.request.Request(self.url, data=json.dumps(msg).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:  # NOSONAR S5144: the address is the connector's own (an admin typed it)
                self.sid = r.headers.get("Mcp-Session-Id") or self.sid
                got = _body(r.read(), r.headers.get("Content-Type", ""))
        except urllib.error.HTTPError as e:
            hint = {401: " : accès refusé", 403: " : accès refusé", 404: " : chemin introuvable (l'adresse doit inclure le chemin secret du module)"}.get(e.code, "")
            raise ConnectorError(f"MCP HTTP {e.code}{hint}") from None
        except (OSError, ValueError) as e:
            raise ConnectorError(f"MCP injoignable ({getattr(e, 'reason', e)}) : module ha-mcp démarré ? adresse et port ?") from None
        if got.get("error"):
            raise ConnectorError(f"MCP : {_text((got['error'] or {}).get('message') or got['error'], 160)}")
        return got.get("result") or {}

    def start(self) -> dict:
        info = self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "myservices", "version": "1"}})
        self._rpc("notifications/initialized", notify=True)
        self.ready = True
        return info.get("serverInfo") or {}

    def call(self, key: str) -> dict:
        """Un des appels de lecture de READ_CALLS (par sa clé) ; rien d'autre ne peut partir."""
        tool, args = READ_CALLS[key]
        if not self.ready:
            self.start()
        res = self._rpc("tools/call", {"name": tool, "arguments": dict(args)})
        return _payload(tool, res)

    def get(self, key: str) -> dict:
        return PARSERS[key](self.call(key))

    def collect(self) -> dict:
        """Tous les blocs ; un outil qui échoue ne gâche pas les autres (son erreur est notée dans « errors »)."""
        out: dict = {"errors": {}}
        try:
            out["server"] = self.start()
        except ConnectorError as e:
            return {"errors": {"connexion": str(e)}}
        for key in READ_CALLS:
            try:
                out[key] = self.get(key)
            except ConnectorError as e:
                out["errors"][key] = str(e)
        return out
