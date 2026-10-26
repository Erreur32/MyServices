"""MyServices MCP server (/mcp): "Streamable HTTP" transport, stateless, JSON answers.

An AI assistant (Claude Code, Claude Desktop, Cursor...) connects with a msv_mcp_ token:
  claude mcp add --transport http myservices http://<host>:8090/mcp \\
    --header "Authorization: Bearer msv_mcp_..."

Each request is authenticated and its level read again (tokens.check): nothing is kept between two calls, a revoked
token fails at once. Read tools show what the page shows; "run_collect" asks for a pass (level runs). The *_config
tools (level admin, off until switched on) run the same REST routes as the Settings page, through ctx["route"]: same
checks, same audit, same side effects. Each tool has a switch in Settings -> API and MCP. No secret or key path in answers.
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
    seen = {(c["type"], c["name"]) for c in d.get("connectors", [])}
    health_connectors = [c for c in _health(core).get("connectors", []) if (c["type"], c["name"]) not in seen]   # Beszel is read by the health task, not by the collection
    return {"data_generated": d.get("generated"), "next_run": d.get("next_run"), "collect": st,
            "machines": len(d.get("machine_list", [])), "services": len(d.get("hosts", [])),
            "connectors": [{"type": c["type"], "name": c["name"], "ok": c["ok"], "message": c.get("message")}
                           for c in [*d.get("connectors", []), *health_connectors]]}


def t_machines(core, args, ctx):
    import watcher
    problems: dict[str, list[dict]] = {}   # per machine: which services are behind « services_down »
    for r in _data(core).get("hosts", []):
        if (st := watcher.status(r)) in ("bad", "warn"):
            problems.setdefault(r.get("ip"), []).append({"name": watcher.label(r), "status": st})
    out = []
    for m in _data(core).get("machine_list", []):
        i = m.get("info") or {}
        out.append({"name": m["name"], "ip": m["ip"], "role": m.get("role"), "ping": m.get("ping"),
                    "off_on_purpose": bool(m.get("off")), "ssh": bool(m.get("ssh")), "ssh_ok": bool(m.get("info")),
                    "os": i.get("os"), "uptime_s": i.get("uptime_s"), "containers": i.get("docker"),
                    "services": m.get("services"), "services_down": m.get("down"), "problems": problems.get(m["ip"], [])})
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
            "hosts": [{**{k: x.get(k) for k in keep}, "checks": x.get("checks") or {},   # the controls in warn or crit: why the level is not « ok »
                       **({"kernel_errors": k["samples"]} if (k := x.get("kernel") or {}).get("has_errors") else {}),   # the journal lines behind a « kernel » warn
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


class ToolError(Exception):
    """A refusal to show the assistant as a tool error (isError), not a protocol error."""


# Settings reachable by the *_config tools: action -> (method, REST route under api/v1). Left out on purpose: showing a
# saved secret, installing npm-api.sh on a machine, accounts, tokens, the configuration export and import, the container log, the app's SSH key.
CONFIG = {
    "connectors_config": {
        "list": ("GET", "/connectors/settings"),
        "test": ("POST", "/connectors/settings/{type_}/test"),
        "save": ("PUT", "/connectors/settings/{type_}"),
        "switch": ("PATCH", "/connectors/settings/{type_}/{name}"),
        "delete": ("DELETE", "/connectors/settings/{type_}/{name}"),
        "npm_script_check": ("POST", "/connectors/settings/npm/script/check"),
    },
    "backups_config": {
        "list": ("GET", "/backups/settings"),
        "discover": ("POST", "/backups/discover"),
        "set_patterns": ("PUT", "/backups/patterns"),
        "follow_folders": ("PUT", "/backups/settings"),
        "update_set": ("PATCH", "/backups/settings/{set_id}"),
        "update_location": ("PATCH", "/backups/settings/{set_id}/locations/{index}"),
        "unfollow": ("DELETE", "/backups/settings/{set_id}"),
        "find_copies": ("POST", "/backups/copies/find"),
        "add_copy": ("POST", "/backups/settings/{set_id}/copies"),
        "remove_copy": ("DELETE", "/backups/settings/{set_id}/copies/{index}"),
        "veeam_test": ("POST", "/backups/veeam/test"),
        "veeam_discover": ("POST", "/backups/veeam/discover"),
        "veeam_follow": ("PUT", "/backups/veeam"),
        "remote_test": ("POST", "/backups/remote/test"),
        "remote_browse": ("POST", "/backups/remote/browse"),
        "remote_follow": ("PUT", "/backups/remote"),
        "synology_discover": ("POST", "/backups/synology/discover"),
        "synology_follow": ("PUT", "/backups/synology"),
        "pbs_discover": ("POST", "/backups/pbs/discover"),
        "pbs_follow": ("PUT", "/backups/pbs"),
        "agents_discover": ("GET", "/backups/agents/discover"),
        "agents_follow": ("PUT", "/backups/agents"),
        "vzdump_discover": ("POST", "/backups/vzdump/discover"),
        "vzdump_follow": ("PUT", "/backups/vzdump"),
        "ha_check": ("POST", "/backups/ha/check"),
        "ha_follow": ("PUT", "/backups/ha"),
    },
    "machines_config": {
        "list": ("GET", "/machines/settings"),
        "save": ("PUT", "/machines/settings/{ip}"),
        "delete": ("DELETE", "/machines/settings/{ip}"),
        "check": ("POST", "/machines/settings/{ip}/check"),
        "refresh": ("POST", "/machines/settings/{ip}/refresh"),
        "network_get": ("GET", "/network/settings"),
        "network_set": ("PUT", "/network/settings"),
    },
    "settings_config": {
        "mail_get": ("GET", "/system/mail"),
        "mail_set": ("PUT", "/system/mail"),
        "mail_test": ("POST", "/system/mail/test"),
        "tasks_list": ("GET", "/tasks"),
        "task_schedule": ("PUT", "/system/tasks/{name}/schedule"),
        "live_get": ("GET", "/system/live-checks"),
        "live_set": ("PUT", "/system/live-checks"),
        "updates_get": ("GET", "/about"),
        "updates_check": ("POST", "/about/check"),
        "updates_set": ("PUT", "/about/settings"),
        "alerts_list": ("GET", "/alerts"),
        "channel_add": ("POST", "/alerts/channels"),
        "channel_update": ("PATCH", "/alerts/channels/{cid}"),
        "channel_delete": ("DELETE", "/alerts/channels/{cid}"),
        "channel_test": ("POST", "/alerts/channels/{cid}/test"),
        "rule_add": ("POST", "/alerts/rules"),
        "rule_update": ("PATCH", "/alerts/rules/{rid}"),
        "rule_delete": ("DELETE", "/alerts/rules/{rid}"),
        "presets_add": ("POST", "/alerts/presets"),
    },
    "agents_config": {
        "list": ("GET", "/agents"),
        "create": ("POST", "/agents"),
        "auto_update": ("PATCH", "/agents/{aid}"),
        "update_now": ("POST", "/agents/{aid}/update"),
        "confirm_host": ("POST", "/agents/{aid}/confirm-host"),
        "revoke": ("DELETE", "/agents/{aid}"),
        "purge": ("DELETE", "/agents/{aid}/purge"),
    },
}


def config_tool(name: str):
    """One *_config tool: "help" describes each action and its params, any other action runs its REST route."""
    def run(core, args, ctx):
        actions, action = CONFIG[name], args.get("action")
        if action == "help":
            return {"actions": {a: ctx["route_help"](*r) for a, r in actions.items()}}
        if action not in actions:
            raise ValueError(f"action inconnue {action!r} : l'action « help » les liste")
        params = args.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("params : objet attendu")
        status, out = ctx["route"](*actions[action], params)
        if status >= 400:
            raise ToolError(f"HTTP {status}: {(out or {}).get('error') or (out or {}).get('detail') or out}")
        return out if isinstance(out, dict) else {"result": out}
    return run


VALIDATE_TYPE = {"type": "string", "description": "un seul type de connecteur (proxmox, npm…)"}


def t_validate(core, args, ctx):
    """Test every saved connector (or one type) as the Settings page does, without saving anything; « help » describes it, like the *_config tools."""
    from concurrent.futures import ThreadPoolExecutor

    if args.get("action") == "help":
        return {"actions": {"run": {"summary": "essayer les connecteurs enregistrés, sans rien changer (action par défaut)",
                                    "params": {**OBJ, "properties": {"type": VALIDATE_TYPE}}}}}
    if args.get("action") not in (None, "run"):
        raise ValueError(f"action inconnue {args['action']!r} : l'action « help » les liste")

    from connectors import settings
    only = args.get("type") or None
    items = [i for i in settings.listing([]) if not only or i["type"] == only]

    def check(i):
        try:
            ok, msg = settings.check_saved(i["type"], i["name"])
        except settings.SettingsError as e:
            ok, msg = False, str(e)
        return {"type": i["type"], "name": i["name"], "enabled": i["enabled"], "ok": ok, "message": msg}
    with ThreadPoolExecutor(max_workers=4) as pool:
        out = list(pool.map(check, items))
    return {"checked": len(out), "failed": sum(not o["ok"] for o in out), "connectors": out}


OBJ = {"type": "object", "additionalProperties": False}


def config_schema(name: str) -> dict:
    return {**OBJ, "required": ["action"],
            "properties": {"action": {"type": "string", "enum": ["help", *CONFIG[name]]},
                           "params": {"type": "object", "description": "paramètres de l'action, listés par l'action « help »"}}}


CONFIG_HELP = " L'action « help » liste chaque action et ses paramètres (schéma JSON) ; essayer ou chercher avant d'enregistrer."
TOOLS = {
    "status": ("read", "État général : fraîcheur des données, passage en cours, nombre de machines et services, "
               "état de chaque connecteur.", {**OBJ, "properties": {}}, t_status),
    "list_machines": ("read", "Machines suivies : nom, IP, rôle, ping, accès SSH, système, conteneurs en marche, services en panne avec leur nom.",
                      {**OBJ, "properties": {}}, t_machines),
    "list_services": ("read", "Services (proxy NPM, conteneurs, process) avec leur état ok / warn / bad / off, "
                      "problèmes d'abord.",
                      {**OBJ, "properties": {"query": {"type": "string", "description": "texte cherché (nom, machine, image)"},
                                             "problems_only": {"type": "boolean", "description": "seulement warn et bad"},
                                             "limit": {"type": "integer", "minimum": 1, "maximum": 500}}}, t_services),
    "get_health": ("read", "Santé des machines (disques, niveau global, contrôles en alerte avec leur niveau, lignes d'erreur noyau) relevée par la tâche santé.",
                   {**OBJ, "properties": {}}, t_health),
    "list_events": ("read", "Historique : pannes, rétablissements, machines hors ligne, santé… sur les N dernières heures.",
                    {**OBJ, "properties": {"hours": {"type": "integer", "minimum": 1, "maximum": 8760},
                                           "kind": {"type": "string", "description": "genre (panne, retabli, hors_ligne…)"},
                                           "query": {"type": "string"},
                                           "limit": {"type": "integer", "minimum": 1, "maximum": 1000}}}, t_events),
    "run_collect": ("runs", "Demande un passage de la collecte (comme le bouton ⟳ ; délai minimal entre deux).",
                    {**OBJ, "properties": {}}, t_run_collect),
    "connectors_config": ("admin", "Réglages des connecteurs : lister, essayer sans enregistrer, enregistrer (testé d'abord, collecte "
                          "coupée si le test échoue), allumer ou couper, supprimer." + CONFIG_HELP, config_schema("connectors_config"),
                          config_tool("connectors_config")),
    "backups_config": ("admin", "Réglages des sauvegardes : dossiers par SSH, Veeam, distant (SFTP…), Synology, PBS, agents, "
                       "vzdump, Home Assistant ; copies, seuils d'âge, arrêt du suivi." + CONFIG_HELP, config_schema("backups_config"),
                       config_tool("backups_config")),
    "machines_config": ("admin", "Machines : lister, ajouter ou modifier (accès SSH, rôle), retirer, vérifier (SSH, Docker, AdGuard, santé), "
                        "relire une seule machine, et régler la recherche réseau automatique." + CONFIG_HELP, config_schema("machines_config"),
                        config_tool("machines_config")),
    "settings_config": ("admin", "Réglages généraux : envoi d'e-mails (SMTP, essai), horaires des tâches, pouls et connecteurs rapides, "
                        "vérification des mises à jour, alertes (canaux, règles, préréglages)." + CONFIG_HELP, config_schema("settings_config"),
                        config_tool("settings_config")),
    "agents_config": ("admin", "Agents de santé : lister, créer (commande d'installation affichée une seule fois), mise à jour "
                      "automatique, mise à jour immédiate, nom de poste confirmé, révoquer, effacer." + CONFIG_HELP, config_schema("agents_config"),
                      config_tool("agents_config")),
    "validate_config": ("admin", "Essayer tous les connecteurs enregistrés (ou un type) sans rien changer : ce qui échoue et pourquoi.",
                        {**OBJ, "properties": {"action": {"type": "string", "enum": ["run", "help"], "description": "run (par défaut) ou help"},
                                               "type": VALIDATE_TYPE}}, t_validate),
}
# Tools that change the configuration: off until an admin switches them on in Settings -> API and MCP
OFF_BY_DEFAULT = {"connectors_config", "backups_config", "machines_config", "settings_config", "agents_config", "validate_config"}


def enabled(states: dict[str, bool], name: str) -> bool:
    return states.get(name, name not in OFF_BY_DEFAULT)


def tools_info(states: dict[str, bool]) -> list[dict]:
    """For the page: each tool, its level and its switch (on by default, except OFF_BY_DEFAULT)."""
    return [{"name": n, "level": t[0], "description": t[1], "enabled": enabled(states, n)} for n, t in TOOLS.items()]


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
    usable = {n: t for n, t in TOOLS.items() if enabled(states, n) and tokens.allows(level, t[0])}
    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok({"protocolVersion": asked if asked in SUPPORTED else PROTOCOL,
                   "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": {"name": "myservices", "title": "MyServices", "version": "2"},
                   "instructions": "Inventaire et état d'un réseau domestique / homelab : machines, services, santé, "
                                   "historique. Lecture, run_collect (niveau runs) ; réglages des connecteurs, sauvegardes et agents "
                                   "par les outils *_config (niveau admin, action « help » d'abord)."})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": [{"name": n, "description": t[1], "inputSchema": t[2]} for n, t in usable.items()]})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS or not enabled(states, name):
            return err(-32602, f"outil inconnu ou désactivé : {name}")
        if name not in usable:
            return ok({"isError": True, "content": [{"type": "text", "text": f"MCP_TOKEN_LEVEL : niveau « {TOOLS[name][0]} » requis"}]})
        try:
            out = TOOLS[name][3](core, params.get("arguments") or {}, ctx)
        except ToolError as e:
            return ok({"isError": True, "content": [{"type": "text", "text": str(e)}]})
        except (ValueError, TypeError) as e:
            return ok({"isError": True, "content": [{"type": "text", "text": f"arguments invalides : {e}"}]})
        return ok({"content": [{"type": "text", "text": tokens.dumps(out)}], "structuredContent": out})
    return err(-32601, f"méthode inconnue : {method}")
