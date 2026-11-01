"""API routes: access."""
from __future__ import annotations

import json
import time
import zlib
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from msv.api import server as core
from msv.api.common import AGENT_REPORT, API, MCP, SECURITY_HEADERS, admin_only, admin_write, agents_store, app, deny, ip_of, session_admin, store, tokens_store

router = APIRouter()

@router.post(MCP, tags=["mcp"], summary="Serveur MCP (JSON-RPC, Streamable HTTP sans état ; jeton msv_mcp_)")
async def mcp_endpoint(request: Request):
    from msv.api import mcp_server
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSON illisible"}}, status_code=400)
    u = request.state.user or {}
    ctx = {"token": u.get("token") or {"name": "?", "level": "read"},
           "audit": lambda action: store().audit(action, u.get("username"), ip_of(request)),
           "route": lambda method, path, params: mcp_route(request, method, path, params), "route_help": mcp_route_help}
    states = tokens_store().tool_states()
    msgs = body if isinstance(body, list) else [body]
    # in a worker thread: the *_config tools run blocking routes (connector tests, SSH)
    out = await run_in_threadpool(lambda: [r for m in msgs if isinstance(m, dict) and (r := mcp_server.handle(m, ctx, core, states)) is not None])
    if not out:
        return Response(status_code=202)
    return JSONResponse(out if isinstance(body, list) else out[0])


def _route(method: str, path: str):
    """The REST route behind an MCP *_config action, and its parameters as (name, type)."""
    import inspect
    import typing
    from fastapi.routing import APIRoute
    # FastAPI keeps each included router as one block (`original_router`): look inside it
    for r in (route for block in app.routes for route in getattr(getattr(block, "original_router", None), "routes", None) or [block]):
        if isinstance(r, APIRoute) and r.path == API + path and method in r.methods:
            hints = typing.get_type_hints(r.endpoint)
            return r, [(name, hints.get(name)) for name in inspect.signature(r.endpoint).parameters]
    raise ValueError(f"route inconnue : {method} {path}")


def _is_model(kind) -> bool:
    return isinstance(kind, type) and issubclass(kind, BaseModel)


def mcp_route(request: Request, method: str, path: str, params: dict) -> tuple[int, object]:
    """Run a REST route for an MCP *_config tool, as the token's user: same checks, audit and side effects as from the page.
    Path parameters are taken from params by name (« type_ » as « type »), the rest is the body. A bad body raises ValueError."""
    from fastapi import HTTPException
    route, args = _route(method, path)
    body, kwargs, model = dict(params), {}, None
    for name, kind in args:
        if name == "request":
            kwargs[name] = request
        elif _is_model(kind):
            model = (name, kind)
        elif (key := name.rstrip("_")) in body:
            value = body.pop(key)
            kwargs[name] = kind(value) if kind in (int, str) else value
        elif "{" + name + "}" in path:
            raise ValueError(f"paramètre « {key} » requis")
    if model:
        kwargs[model[0]] = model[1].model_validate(body)
    try:
        out = route.endpoint(**kwargs)
    except HTTPException as e:
        return e.status_code, {"error": e.detail}
    if isinstance(out, Response):
        try:
            return out.status_code, json.loads(out.body)
        except ValueError:
            return out.status_code, {}
    return 200, {"ok": True} if out is None else out


def mcp_route_help(method: str, path: str) -> dict:
    """What an MCP *_config action does and the JSON schema of its parameters (path parameters and body fields together)."""
    route, args = _route(method, path)
    props, required, defs = {}, [], {}
    for name, kind in args:
        if _is_model(kind):
            schema = kind.model_json_schema()
            props.update(schema.get("properties", {}))
            required += schema.get("required", [])
            defs.update(schema.get("$defs", {}))
        elif "{" + name + "}" in path:
            props[name.rstrip("_")] = {"type": "integer" if kind is int else "string"}
            required.append(name.rstrip("_"))
    return {"summary": route.summary, "params": {"type": "object", "properties": props, "required": required, **({"$defs": defs} if defs else {})}}


@router.get(MCP, include_in_schema=False)
def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


class NewToken(BaseModel):
    kind: Literal["api", "mcp"]
    name: str = Field(max_length=64)
    level: Literal["read", "runs", "admin"] = "read"
    days: int | None = Field(None, ge=1, le=3650)
    password: str | None = Field(None, max_length=256)  # requis pour un jeton admin


@router.get(API + "/tokens", tags=["jetons"], summary="Jetons d'API et MCP, outils MCP (session admin)")
def tokens_list(request: Request):
    from msv.api import mcp_server
    if denied := admin_only(request):
        return denied
    if (request.state.user or {}).get("token"):
        return deny(403, "gestion des jetons : session requise")
    t = tokens_store()
    return {"tokens": t.listing(), "tools": mcp_server.tools_info(t.tool_states()), "mcp_path": MCP, "api_path": API}


@router.post(API + "/tokens", tags=["jetons"], summary="Créer un jeton (affiché une seule fois ; admin : mot de passe et durée)")
def tokens_create(body: NewToken, request: Request):
    from msv.core import tokens
    if denied := session_admin(request):
        return denied
    u, ip = request.state.user, ip_of(request)
    if body.level == "admin":
        if store().too_many_failures(ip):
            return deny(429, "trop d'échecs : réessayer dans 15 minutes")
        if store().verify(u["username"], body.password or "", ip) is None:
            return deny(401, "mot de passe incorrect (requis pour un jeton admin)")
    try:
        raw, info = tokens_store().create(body.kind, body.name, body.level, body.days, u["username"])
    except tokens.TokenError as e:
        return deny(400, str(e))
    store().audit("jeton créé", u["username"], ip, f"{body.kind} « {body.name} » ({body.level})")
    return {"token": raw, "info": info}


@router.delete(API + "/tokens/{tid}", tags=["jetons"], summary="Révoquer un jeton (session admin)")
def tokens_revoke(tid: int, request: Request):
    from msv.core import tokens
    if denied := session_admin(request):
        return denied
    try:
        tokens_store().revoke(tid)
    except tokens.TokenError as e:
        return deny(400, str(e))
    store().audit("jeton révoqué", request.state.user["username"], ip_of(request), str(tid))
    return {"ok": True}


class NewAgent(BaseModel):
    ip: str = Field(max_length=45)
    name: str = Field(max_length=64)
    url: str | None = Field(default=None, max_length=200)  # adresse de MyServices vue par la machine (sinon celle du navigateur)
    kind: str = Field(default="windows", max_length=10)    # « windows » (agent PowerShell) ou « linux » (agent Python)


PLAIN = "text/plain; charset=utf-8"   # scripts d'agent servis tels quels


def too_soon(a: dict) -> dict | None:
    """A report sent less than MIN_GAP seconds after the last one (a run at boot then one at sign-in): answered « already received »
    with a 200, not a 429, so an agent does not retry it nor its scheduled task run the whole collection again."""
    from msv.machines import agents
    if a["last_seen"] and time.time() - a["last_seen"] < agents.MIN_GAP:
        return {"ok": True, "skipped": True, "interval": agents.DEFAULT_INTERVAL}
    return None


def refresh_after_report(a: dict, report: dict, before, now) -> None:
    """Relit la santé (et, au premier relevé ou après une mise à jour d'agent, la collecte) sans attendre le prochain horaire.
    Only this machine is read again, from its report (--only, --agent: no SSH, no new call to an API), even when its level changed: its events
    and alerts come from that pass as from a full one."""
    first, upgraded = not a["last_seen"], str(report.get("version") or "") != (a.get("version") or "")
    if core.enabled("health"):
        why = f"relevé de l'agent {a['name']}" + (f" : {before or 'premier'} → {now}" if first or before != now else "")
        core.run_task("health", why, ("--only", a["ip"], "--agent"))
    # Premier relevé, agent réinstallé dans une autre version ou revenu d'un silence : système, matériel et ports (lus à la collecte) apparaissent sans attendre l'horaire
    if (first or upgraded or a["state"] == "silencieux") and core.enabled("collect"):
        core.run_chain(["collect"], f"relevé de l'agent {a['name']} (version {report.get('version')})")


def unzip_report(raw: bytes, limit: int) -> bytes | None:
    """Corps gzip d'un relevé (agent Linux 3 et plus), décompressé au plus jusqu'à `limit` octets ; None s'il est plus gros ou illisible
    (jamais décompressé en entier : une archive piégée ne remplit pas la mémoire)."""
    try:
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        out = d.decompress(raw, limit + 1)
        return None if len(out) > limit or d.unconsumed_tail or not d.eof else out
    except zlib.error:
        return None


@router.post(AGENT_REPORT, tags=["agents"], summary="Relevé de santé envoyé par un agent (jeton msv_agent_)")
async def agent_report(request: Request):
    from msv.machines import agents
    a = request.state.agent
    if early := too_soon(a):
        return early
    raw = await request.body()
    if len(raw) > agents.MAX_BODY:
        return deny(413, "relevé trop gros")
    if request.headers.get("content-encoding", "").lower() == "gzip" and (raw := unzip_report(raw, agents.MAX_UNZIPPED)) is None:
        return deny(413, "relevé compressé illisible ou trop gros une fois décompressé")
    # Parsing, the database and the health level are slow, blocking work: done in a worker thread, the server keeps answering meanwhile
    return await run_in_threadpool(_agent_report, a, raw, ip_of(request))


def backup_request(ip: str) -> dict | None:
    from msv.backups import backups, backups_admin
    try:
        req = backups.agent_request(ip)
        return {**req, "names": backups_admin.agent_find_names()} if req else None
    except (OSError, ValueError, KeyError):   # no backups-meta.json, or unreadable: the report is still taken
        return None


def _agent_report(a: dict, raw: bytes, ip: str):
    from msv.machines import agents
    try:
        report = agents.validate_report(json.loads(raw))
    except ValueError:
        return deny(400, "relevé invalide : JSON attendu")
    except agents.AgentError as e:
        return deny(400, str(e))
    if (report["data"].get("kind") == "linux") != (a.get("kind") == "linux"):
        return deny(400, "relevé d'un autre type que cet agent (Windows ou Linux)")
    if not agents_store().claim_host(a["id"], report.get("host")):
        store().audit("agent : nom de poste différent, relevé refusé", "agent", ip, f"« {a['name']} » ({a['ip']}) : {str(report.get('host'))[:64]}")
        return JSONResponse({"error": "nom de poste différent de celui connu : à confirmer dans MyServices (fiche de la machine, onglet Accès)", "code": "HOST_CHANGED"},
                            status_code=409, headers=SECURITY_HEADERS)
    before, now = agents_store().store_report(a["id"], report, ip)
    refresh_after_report(a, report, before, now)
    out = {"ok": True, "interval": agents.DEFAULT_INTERVAL}
    if a.get("kind") == "linux" and (scan := backup_request(a["ip"])):
        out["backups"] = scan
    if upd := agents_store().update_for(a["id"], str(report.get("version") or "")):   # mise à jour automatique ou demandée : l'agent s'en charge
        out["update"] = upd
    return out


@router.get("/agent/{name}.ps1", tags=["agents"], summary="Scripts de l'agent Windows (sans secret, réseau local)")
def agent_script(name: str):
    from msv.machines import agents
    if name not in ("install", "agent"):
        return deny(404, "introuvable")
    return Response(agents.script(name + ".ps1"), media_type=PLAIN)


@router.get("/agent/dns-scan.py", tags=["agents"], summary="Lecture root du DNS local de l'agent Linux (sans secret)")
def agent_dns_scan():
    from msv.machines import agents
    return Response(agents.script("dns-scan.py"), media_type=PLAIN)


@router.get("/agent/backup-scan.py", tags=["agents"], summary="Lecture root des sauvegardes de l'agent Linux (sans secret)")
def agent_backup_scan():
    from msv.machines import agents
    return Response(agents.script("backup-scan.py"), media_type=PLAIN)


@router.get("/agent/agent.py", tags=["agents"], summary="Agent Linux (sans secret, réseau local)")
def agent_script_py():
    from msv.machines import agents
    return Response(agents.script("agent.py"), media_type=PLAIN)


@router.get("/agent/install.sh", tags=["agents"], summary="Installateur de l'agent Linux (sans secret, réseau local)")
def agent_script_sh():
    from msv.machines import agents
    return Response(agents.script("install.sh"), media_type=PLAIN)


def base_url(request: Request) -> str:
    """Adresse de MyServices vue par le navigateur (derrière un proxy : en-têtes X-Forwarded-*)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{request.headers.get('x-forwarded-host') or request.headers.get('host')}"


@router.get(API + "/agents", tags=["agents"], summary="Agents et leur dernier relevé (admin)")
def agents_list(request: Request):
    if denied := admin_write(request):
        return denied
    from msv.machines import agents
    store = agents_store()
    reports = store.fresh_reports()
    fresh = lambda a: reports[a["ip"]]["report"] if reports.get(a["ip"], {}).get("fresh") else None  # noqa: E731
    rows = [{**a, "gaps": agents.inventory_gaps(fresh(a)), "rights": agents.rights_gaps(fresh(a))} for a in store.listing()]
    return {"agents": rows, "report_path": AGENT_REPORT}


@router.post(API + "/agents", tags=["agents"], summary="Créer un agent pour une machine (jeton affiché une seule fois)")
def agents_create(body: NewAgent, request: Request):
    from msv.machines import agents
    if denied := admin_write(request):
        return denied
    u, ip = request.state.user, ip_of(request)
    try:
        url = agents.clean_url(body.url) if body.url else base_url(request)
        raw, info = agents_store().create(body.ip, body.name, u["username"], body.kind)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("agent créé", u["username"], ip, f"« {body.name} » ({info['ip']})")
    return {"token": raw, "info": info, "url": url, "command": agents.install_command(url, raw, info["kind"])}


class AgentChange(BaseModel):
    auto_update: bool


@router.patch(API + "/agents/{aid}", tags=["agents"], summary="Mise à jour automatique d'un agent : activer ou couper (admin)")
def agents_change(aid: int, body: AgentChange, request: Request):
    from msv.machines import agents
    if denied := admin_write(request):
        return denied
    try:
        agents_store().set_auto_update(aid, body.auto_update)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("mise à jour automatique de l'agent " + ("activée" if body.auto_update else "coupée"), request.state.user["username"], ip_of(request), str(aid))
    return {"ok": True}


@router.post(API + "/agents/{aid}/update", tags=["agents"], summary="Mettre à jour un agent maintenant : il récupère le script à son prochain relevé (admin)")
def agents_update(aid: int, request: Request):
    from msv.machines import agents
    if denied := admin_write(request):
        return denied
    try:
        agents_store().request_update(aid)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("mise à jour d'agent demandée", request.state.user["username"], ip_of(request), str(aid))
    return {"ok": True, "message": "l'agent se mettra à jour à son prochain relevé"}


@router.post(API + "/agents/{aid}/confirm-host", tags=["agents"], summary="Accepter le nouveau nom de poste d'un agent (machine renommée ; admin)")
def agents_confirm_host(aid: int, request: Request):
    from msv.machines import agents
    if denied := admin_write(request):
        return denied
    try:
        agents_store().confirm_host(aid)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("nom de poste d'agent confirmé", request.state.user["username"], ip_of(request), str(aid))
    return {"ok": True}


@router.delete(API + "/agents/{aid}", tags=["agents"], summary="Révoquer un agent (admin)")
def agents_revoke(aid: int, request: Request):
    from msv.machines import agents
    if denied := admin_write(request):
        return denied
    try:
        agents_store().revoke(aid)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("agent révoqué", request.state.user["username"], ip_of(request), str(aid))
    return {"ok": True}


@router.delete(API + "/agents/{aid}/purge", tags=["agents"], summary="Effacer un agent déjà révoqué de la liste (admin)")
def agents_purge(aid: int, request: Request):
    from msv.machines import agents
    if denied := admin_write(request):
        return denied
    try:
        agents_store().purge(aid)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("agent révoqué effacé", request.state.user["username"], ip_of(request), str(aid))
    return {"ok": True}


class ToolToggle(BaseModel):
    enabled: bool


@router.patch(API + "/tokens/tools/{name}", tags=["jetons"], summary="Activer ou couper un outil MCP (session admin)")
def tokens_tool(name: str, body: ToolToggle, request: Request):
    from msv.api import mcp_server
    if denied := session_admin(request):
        return denied
    if name not in mcp_server.TOOLS:
        return deny(400, "outil inconnu")
    tokens_store().set_tool(name, body.enabled)
    store().audit("outil MCP " + ("activé" if body.enabled else "coupé"), request.state.user["username"], ip_of(request), name)
    return {"ok": True}
