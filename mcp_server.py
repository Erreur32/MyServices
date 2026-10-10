"""Serveur MCP de MyServices (/myservices/mcp) : transport « Streamable HTTP » en mode sans état, réponses JSON.

Un assistant IA (Claude Code, Claude Desktop, Cursor…) s'y branche avec un jeton msv_mcp_ :
  claude mcp add --transport http myservices http://<hôte>:8090/myservices/mcp \\
    --header "Authorization: Bearer msv_mcp_…"

Chaque requête est authentifiée et son niveau relu (tokens.check) : rien n'est gardé entre deux appels, un jeton
révoqué tombe aussitôt. Outils en lecture sur ce que montre la page ; « run_collect » demande un passage
(niveau runs). Chaque outil a un interrupteur dans Réglages → API et MCP. Réponses sans secret ni chemin de clé.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

PROTOCOL = "2025-06-18"
SUPPORTED = ("2025-06-18", "2025-03-26", "2024-11-05")


def _data(core) -> dict:
    try:
        return json.loads((Path(core.WEB) / "data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _health(core) -> dict:
    try:
        return json.loads((Path(core.WEB) / "health" / "stats.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def t_status(core, args, ctx):
    d, st = _data(core), core.status()
    return {"data_generated": d.get("generated"), "next_run": d.get("next_run"), "collect": st,
            "machines": len(d.get("machine_list", [])), "services": len(d.get("hosts", [])),
            "connectors": [{"type": c["type"], "name": c["name"], "ok": c["ok"], "message": c.get("message")}
                           for c in d.get("connectors", [])]}


def t_machines(core, args, ctx):
    out = []
    for m in _data(core).get("machine_list", []):
        i = m.get("info") or {}
        out.append({"name": m["name"], "ip": m["ip"], "role": m.get("role"), "ping": m.get("ping"),
                    "off_on_purpose": bool(m.get("off")), "ssh": bool(m.get("ssh")), "ssh_ok": bool(m.get("info")),
                    "os": i.get("os"), "uptime_s": i.get("uptime_s"), "containers": i.get("docker"),
                    "services": m.get("services"), "services_down": m.get("down")})
    return {"machines": out}


def t_services(core, args, ctx):
    import watcher
    q = str(args.get("query") or "").casefold()
    only = bool(args.get("problems_only"))
    limit = max(1, min(int(args.get("limit") or 100), 500))
    out = []
    for r in _data(core).get("hosts", []):
        st = watcher.status(r)
        if only and st not in ("bad", "warn"):
            continue
        name = watcher.label(r)
        svc = r.get("service") or {}
        if q and q not in f"{name} {r.get('machine')} {svc.get('name')} {svc.get('image')} {r.get('category')}".casefold():
            continue
        out.append({"name": name, "type": r["type"], "status": st, "machine": r.get("machine"), "ip": r.get("ip"),
                    "port": r.get("port"), "category": r.get("category"), "container": svc.get("name"),
                    "image": svc.get("image"), "http": (r.get("public") or {}).get("code"),
                    "error": (r.get("public") or {}).get("err") or (r.get("backend") or {}).get("err")})
    out.sort(key=lambda x: ({"bad": 0, "warn": 1, "ok": 2, "off": 3}.get(x["status"], 4), x["name"]))
    return {"count": len(out), "services": out[:limit]}


def t_health(core, args, ctx):
    h = _health(core)
    keep = ("name", "level", "reachable")
    return {"generated": h.get("timestamp"), "overall": h.get("overall_level"),
            "hosts": [{**{k: x.get(k) for k in keep},
                       "disks": [{"mount": d.get("mount"), "used_pct": d.get("used_pct")} for d in x.get("disks") or []]}
                      for x in h.get("hosts", [])]}


def t_events(core, args, ctx):
    import history
    from auth import db_path
    hours = max(1, min(int(args.get("hours") or 24), 24 * 365))
    rows = history.query(db_path(core.CFG), since=time.time() - hours * 3600, kind=args.get("kind") or None,
                         q=args.get("query") or None, limit=max(1, min(int(args.get("limit") or 100), 1000)))
    return {"hours": hours, "events": rows}


def t_run_collect(core, args, ctx):
    st = core.status()
    if st["running"]:
        return {"started": False, "reason": "passage déjà en cours", **st}
    if st["wait"]:
        return {"started": False, "reason": f"trop tôt, réessayer dans {st['wait']} s", **st}
    core.TASKS["collect"]["trigger"] = time.time()
    core.run_task("collect", f"MCP, jeton {ctx['token']['name']}")
    ctx["audit"]("passage demandé (MCP)")
    return {"started": True, **core.status()}


OBJ = {"type": "object", "additionalProperties": False}
TOOLS = {
    "status": ("read", "État général : fraîcheur des données, passage en cours, nombre de machines et services, "
               "état de chaque connecteur.", {**OBJ, "properties": {}}, t_status),
    "list_machines": ("read", "Machines suivies : nom, IP, rôle, ping, accès SSH, système, conteneurs, services en panne.",
                      {**OBJ, "properties": {}}, t_machines),
    "list_services": ("read", "Services (proxy NPM, conteneurs, process) avec leur état ok / warn / bad / off, "
                      "problèmes d'abord.",
                      {**OBJ, "properties": {"query": {"type": "string", "description": "texte cherché (nom, machine, image)"},
                                             "problems_only": {"type": "boolean", "description": "seulement warn et bad"},
                                             "limit": {"type": "integer", "minimum": 1, "maximum": 500}}}, t_services),
    "get_health": ("read", "Santé des machines (disques, niveau global) relevée par la tâche santé.",
                   {**OBJ, "properties": {}}, t_health),
    "list_events": ("read", "Historique : pannes, rétablissements, machines hors ligne, santé… sur les N dernières heures.",
                    {**OBJ, "properties": {"hours": {"type": "integer", "minimum": 1, "maximum": 8760},
                                           "kind": {"type": "string", "description": "genre (panne, retabli, hors_ligne…)"},
                                           "query": {"type": "string"},
                                           "limit": {"type": "integer", "minimum": 1, "maximum": 1000}}}, t_events),
    "run_collect": ("runs", "Demande un passage de la collecte (comme le bouton ⟳ ; délai minimal entre deux).",
                    {**OBJ, "properties": {}}, t_run_collect),
}


def tools_info(states: dict[str, bool]) -> list[dict]:
    """Pour la page : chaque outil, son niveau et son interrupteur (actif par défaut)."""
    return [{"name": n, "level": t[0], "description": t[1], "enabled": states.get(n, True)} for n, t in TOOLS.items()]


def handle(msg: dict, ctx: dict, core, states: dict[str, bool]) -> dict | None:
    """Une requête JSON-RPC ; None pour une notification (pas de réponse)."""
    import tokens
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if mid is None:
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, text):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}

    level = ctx["token"]["level"]
    usable = {n: t for n, t in TOOLS.items() if states.get(n, True) and tokens.allows(level, t[0])}
    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok({"protocolVersion": asked if asked in SUPPORTED else PROTOCOL,
                   "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": {"name": "myservices", "title": "MyServices", "version": "2"},
                   "instructions": "Inventaire et état d'un réseau domestique / homelab : machines, services, santé, "
                                   "historique. Lecture seule, sauf run_collect (niveau runs)."})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": [{"name": n, "description": t[1], "inputSchema": t[2]} for n, t in usable.items()]})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS or not states.get(name, True):
            return err(-32602, f"outil inconnu ou désactivé : {name}")
        if name not in usable:
            return ok({"isError": True, "content": [{"type": "text", "text": f"MCP_TOKEN_LEVEL : niveau « {TOOLS[name][0]} » requis"}]})
        try:
            out = TOOLS[name][3](core, params.get("arguments") or {}, ctx)
        except (ValueError, TypeError) as e:
            return ok({"isError": True, "content": [{"type": "text", "text": f"arguments invalides : {e}"}]})
        return ok({"content": [{"type": "text", "text": tokens.dumps(out)}], "structuredContent": out})
    return err(-32601, f"méthode inconnue : {method}")
