"""API et page de MyServices (version Docker), avec FastAPI. Lancé par server.py (uvicorn).

Sous /myservices/ :
  /                       page (web/ de l'image), fichiers produits pris d'abord dans le volume (data.json…)
  api/v1/…                API versionnée : état, connecteurs, passages ; doc OpenAPI : api/v1/docs
/healthz                  santé du conteneur (sans données)

Garde-fous : réseaux autorisés (MYSERVICES_ALLOW), puis session obligatoire (auth.py : comptes admin /
viewer, cookie HttpOnly + SameSite=Strict, en-tête X-CSRF-Token sur toute écriture), contrôle d'origine,
aucun fichier servi hors de web/ ni du volume, en-têtes de sécurité, pas de bannière de version.
MYSERVICES_AUTH=0 coupe les comptes (déconseillé : page alors ouverte à tout le réseau autorisé).
Cookies Secure : automatiques en HTTPS direct ; derrière un proxy HTTPS (NPM), MYSERVICES_COOKIE_SECURE=1.
"""
from __future__ import annotations

import ipaddress
import json
import mimetypes
import os
import secrets
import time
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

import models
import server as core
import auth as auth_mod
from auth import AuthError, Store, db_path

PREFIX = "/myservices"
API = PREFIX + "/api/v1"

app = FastAPI(title="MyServices", version="2", docs_url=API + "/docs", redoc_url=None,
              openapi_url=API + "/openapi.json")

@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    """Requête mal formée : champ et raison, JAMAIS la valeur envoyée (FastAPI la renverrait : mot de passe, jeton)."""
    errors = [{"loc": [str(x) for x in e.get("loc", [])], "msg": e.get("msg", "invalide"), "type": e.get("type", "")} for e in exc.errors()]
    return JSONResponse({"error": "requête invalide : " + "; ".join(f"{'.'.join(e['loc'])} ({e['msg']})" for e in errors), "detail": errors},
                        status_code=422, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
                    "X-Frame-Options": "SAMEORIGIN"}
# CSP : rien ne se charge hors de ce site. La page actuelle a du script et du style en ligne
# ('unsafe-inline', retiré avec le nouveau front) ; la page de connexion n'en a pas : politique stricte.
# Le nouveau front (/v2/, React compilé) n'a rien en ligne : politique stricte, comme la connexion.
# La carte (Archify) exporte en PNG / WebM : blob: en plus. La doc de l'API (Swagger, CDN) : sans CSP.
_CSP_BASE = ("default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
             "frame-ancestors 'self'; form-action 'self'; font-src 'self' data:; ")
CSP = {"page": _CSP_BASE + "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
       "login": _CSP_BASE + "script-src 'self'; style-src 'self'; img-src 'self' data:",
       "map": _CSP_BASE + "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                          "img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:"}


def csp_for(path: str) -> str | None:
    if path.startswith(API + "/docs"):
        return None
    if path.startswith(PREFIX + "/login.") or path.startswith(PREFIX + "/v2/"):
        return CSP["login"]
    if path.endswith("/carte.html"):
        return CSP["map"]
    return CSP["page"]
AUTH = os.environ.get("MYSERVICES_AUTH", "1") != "0"
COOKIE, CSRF_COOKIE = "ms_session", "ms_csrf"
# Accessibles sans session : page de connexion et ce qu'elle charge, connexion, santé du conteneur
PUBLIC = {"/healthz", PREFIX + "/agent/install.ps1", PREFIX + "/agent/agent.ps1", PREFIX + "/login.html", PREFIX + "/login.js", PREFIX + "/login.css", PREFIX + "/favicon.svg",
          API + "/login", API + "/setup"}
# Premier compte depuis la page (comme Uptime Kuma) : seulement tant qu'aucun compte n'existe, et dans les
# SETUP_WINDOW s après le démarrage (au-delà : redémarrer le conteneur). Réseau local seulement (guard).
SETUP_WINDOW = 30 * 60
STARTED = time.time()
STORE: Store | None = None


def store() -> Store:
    global STORE
    if STORE is None:
        STORE = Store(db_path(core.CFG))
        try:
            auth_mod.set_session_days(int(core.CFG.get("session_days", 14)))
        except (AuthError, ValueError, TypeError):
            pass  # valeur de config.json hors bornes : durée par défaut
    return STORE


def ip_of(request: Request) -> str:
    return request.client.host if request.client else "?"


def client_allowed(host: str | None) -> bool:
    try:
        ip = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    ip = getattr(ip, "ipv4_mapped", None) or ip
    return any(ip in n for n in core.ALLOW)


def same_origin(request: Request) -> bool:
    """Requête d'écriture venue de cette page (pas d'un autre site) : Origin absent ou égal à l'hôte."""
    origin = request.headers.get("origin")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return not origin or origin.split("://", 1)[-1] == host


def deny(code: int, error: str) -> JSONResponse:
    return JSONResponse({"error": error}, status_code=code, headers=SECURITY_HEADERS)


MCP = PREFIX + "/mcp"
AGENT_REPORT = API + "/agent/report"  # seule route d'un agent : jeton msv_agent_, ni session ni CSRF
TOKENS = None
AGENTS = None


def tokens_store():
    global TOKENS
    if TOKENS is None:
        import tokens
        TOKENS = tokens.Tokens(db_path(core.CFG))
    return TOKENS


def agents_store():
    global AGENTS
    if AGENTS is None:
        import agents
        AGENTS = agents.Agents(db_path(core.CFG))
    return AGENTS


def agent_guard(request: Request, raw: str) -> JSONResponse | None:
    """Jeton d'agent valable : la fiche est posée dans request.state.agent."""
    import agents
    try:
        request.state.agent = agents_store().check(raw)
    except agents.AgentError as e:
        return JSONResponse({"error": str(e), "code": str(e)}, status_code=401, headers=SECURITY_HEADERS)
    return None


def token_guard(request: Request, path: str, raw: str) -> JSONResponse | None:
    """Jeton d'API (routes REST) ou MCP (/mcp) : valable, bonne sorte, niveau suffisant pour la route."""
    import tokens
    kind = "mcp" if path == MCP else "api"
    try:
        t = tokens_store().check(raw, kind, ip_of(request))
    except tokens.TokenError as e:
        return JSONResponse({"error": str(e), "code": str(e)}, status_code=401, headers=SECURITY_HEADERS)
    if kind == "api":
        need = tokens.api_route_level(request.method, path[len(API) + 1:])
        if need is None:
            return JSONResponse({"error": "route non ouverte aux jetons (session requise)", "code": "API_TOKEN_ROUTE_NOT_ALLOWED"},
                                status_code=403, headers=SECURITY_HEADERS)
        if not tokens.allows(t["level"], need):
            code = "API_TOKEN_READ_ONLY" if t["level"] == "read" else "API_TOKEN_LEVEL"
            return JSONResponse({"error": f"niveau « {need} » requis (jeton : {t['level']})", "code": code},
                                status_code=403, headers=SECURITY_HEADERS)
    role = "admin" if t["level"] == "admin" else "viewer"
    request.state.user = {"username": f"{kind}:{t['name']}", "role": role, "token": t}
    return None


@app.middleware("http")
async def guard(request: Request, call_next):
    if not client_allowed(request.client.host if request.client else None):
        return deny(403, "réservé au réseau local")
    write = request.method not in ("GET", "HEAD", "OPTIONS")
    if write and not same_origin(request):
        return deny(403, "origine refusée")
    path = request.url.path
    request.state.user = None
    bearer = request.headers.get("authorization", "")
    if path == AGENT_REPORT:
        denied = agent_guard(request, bearer[7:].strip() if bearer.lower().startswith("bearer ") else "")
        if denied is not None:
            return denied
    elif AUTH and bearer.lower().startswith("bearer ") and (path.startswith(API + "/") or path == MCP):
        denied = token_guard(request, path, bearer[7:].strip())  # jeton : ni cookie ni CSRF, niveau relu à chaque fois
        if denied is not None:
            return denied
    elif AUTH and path == MCP:
        return deny(401, "MCP : jeton msv_mcp_ requis (Authorization: Bearer …)")
    elif AUTH and path not in PUBLIC:
        user = store().session(request.cookies.get(COOKIE))
        if user is None:
            if "/api/" in path:
                return deny(401, "connexion requise")
            return RedirectResponse(f"{PREFIX}/login.html?next={quote(path)}", status_code=302, headers=SECURITY_HEADERS)
        # Écriture : jeton CSRF de la session dans l'en-tête (le cookie seul ne suffit pas)
        if write and not secrets.compare_digest(request.headers.get("x-csrf-token", ""), user["csrf"]):
            return deny(403, "jeton CSRF absent ou faux : recharger la page")
        request.state.user = user
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    csp = csp_for(path)
    if csp and response.headers.get("content-type", "").startswith("text/html"):
        response.headers.setdefault("Content-Security-Policy", csp)
    # Journal : écritures et refus seulement (la page interroge le statut toutes les 30 s)
    if request.method != "GET" or response.status_code >= 400:
        core.log(f"{request.client.host if request.client else '?'} {request.method} {request.url.path} {response.status_code}")
    return response


@app.get("/", include_in_schema=False)
@app.get(PREFIX, include_in_schema=False)
def root():
    return RedirectResponse(PREFIX + "/v2/", status_code=302)  # le nouveau front ; l'ancienne page (v1) reste sur /myservices/


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}


# ── Passage de la collecte à la demande ───────────────────────────────────────────────────────────

def refresh_response(who: str) -> JSONResponse:
    st = core.status()
    if st["running"]:
        return JSONResponse(dict(st, error="passage déjà en cours"), status_code=409)
    if st["wait"]:
        return JSONResponse(dict(st, error=f"trop tôt, réessayer dans {st['wait']} s"), status_code=429)
    core.TASKS["collect"]["trigger"] = time.time()
    core.run_task("collect", f"bouton ⟳, {who}")
    return JSONResponse(core.status(), status_code=202)


def refresh_from(request: Request) -> JSONResponse:
    r = refresh_response(ip_of(request))
    if AUTH and r.status_code == 202:
        store().audit("passage demandé", (request.state.user or {}).get("username"), ip_of(request))
    return r


# ── API v1 ────────────────────────────────────────────────────────────────────────────────────────

@app.get(API + "/status", tags=["passages"], summary="État du collecteur (passage en cours, délai avant le suivant)")
def status_v1():
    return JSONResponse(core.status(), headers={"Cache-Control": "no-store"})


@app.post(API + "/refresh", tags=["passages"], summary="Demander un passage du collecteur",
          responses={202: {"description": "passage lancé"}, 409: {"description": "déjà en cours"},
                     429: {"description": "trop tôt (délai entre deux passages)"}})
def refresh_v1(request: Request):
    return refresh_from(request)


@app.get(API + "/tasks", tags=["passages"], summary="Tâches planifiées : horaires, dernier passage, résultat")
def tasks_v1():
    return {name: {"script": t["script"], "minutes": sorted(t["minutes"]),
                   "hours": None if t["hours"] is None else sorted(t["hours"]), "enabled": core.enabled(name),
                   "running": t["proc"] is not None, "started": t["start"], "ended": t["end"], "result": t["result"]}
            for name, t in core.TASKS.items()}


@app.get(API + "/connectors", tags=["connecteurs"], summary="État des connecteurs au dernier passage")
def connectors_v1():
    try:
        data = json.loads((core.WEB / "data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"generated": None, "connectors": []}
    return {"generated": data.get("generated"), "connectors": data.get("connectors", [])}


# Lectures typées (modèle commun models.py) : fichier absent = liste vide, élément hors modèle = ignoré et compté.

class MachinesOut(BaseModel):
    generated: str | None = None
    machines: list[models.Machine] = []
    skipped: int = 0


class ServicesOut(BaseModel):
    generated: str | None = None
    services: list[models.Service] = []
    skipped: int = 0


class HealthOut(BaseModel):
    generated: str | float | None = None
    overall: models.Level | None = None
    hosts: list[models.Health] = []
    skipped: int = 0


class BackupsOut(BaseModel):
    generated: str | float | None = None
    sets: list[models.Backup] = []
    skipped: int = 0


def read_produced(rel: str) -> dict | None:
    """Fichier produit lu en JSON ; None s'il manque ou n'est pas lisible (jamais d'erreur)."""
    try:
        d = json.loads((core.WEB / rel).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def typed(model: type[BaseModel], items) -> tuple[list, int]:
    """(éléments conformes au modèle, nombre d'éléments ignorés)."""
    ok, skipped = [], 0
    for it in items if isinstance(items, list) else []:
        try:
            ok.append(model.model_validate(it))
        except Exception:
            skipped += 1
    return ok, skipped


@app.get(API + "/machines", tags=["modèle"], summary="Machines du réseau (modèle commun)", response_model=MachinesOut)
def machines_v1():
    d = read_produced("data.json") or {}
    items, skipped = typed(models.Machine, d.get("machine_list"))
    return MachinesOut(generated=d.get("generated"), machines=items, skipped=skipped)


@app.get(API + "/services", tags=["modèle"], summary="Services exposés (modèle commun), filtrables par machine et par type",
         response_model=ServicesOut)
def services_v1(machine: str | None = None, type: Literal["proxy", "redirect", "dead", "stream", "local"] | None = None):
    d = read_produced("data.json") or {}
    items, skipped = typed(models.Service, d.get("hosts"))
    if machine:
        items = [s for s in items if (s.machine or "").casefold() == machine.casefold() or s.ip == machine]
    if type:
        items = [s for s in items if s.type == type]
    return ServicesOut(generated=d.get("generated"), services=items, skipped=skipped)


@app.get(API + "/health", tags=["modèle"], summary="Santé des machines et niveau global (modèle commun)", response_model=HealthOut)
def health_v1():
    d = read_produced("health/stats.json") or {}
    items, skipped = typed(models.Health, d.get("hosts"))
    level = d.get("overall_level")
    return HealthOut(generated=d.get("timestamp"), overall=level if level in ("ok", "warn", "crit", "down", "na") else None,
                     hosts=items, skipped=skipped)


@app.get(API + "/backups", tags=["modèle"], summary="Jeux de sauvegarde et leurs emplacements (modèle commun)",
         response_model=BackupsOut, responses={404: {"description": "sauvegardes non suivies (pas de backups.json)"}})
def backups_v1():
    d = read_produced("backups.json")
    if d is None:
        return deny(404, "pas de backups.json : sauvegardes non suivies")
    items, skipped = typed(models.Backup, d.get("sets"))
    return BackupsOut(generated=d.get("generated"), sets=items, skipped=skipped)


class ConnectorConf(BaseModel):
    name: str = Field(max_length=64)
    config: dict[str, str | int | bool | None] = {}
    original: str | None = Field(None, max_length=64)  # nom actuel, pour modifier (et renommer) une instance


def last_statuses() -> list[dict]:
    try:
        return json.loads((core.WEB / "data.json").read_text(encoding="utf-8")).get("connectors", [])
    except (OSError, ValueError):
        return []


@app.get(API + "/connectors/settings", tags=["connecteurs"], summary="Connecteurs réglables : types, champs, instances (admin)")
def connectors_settings(request: Request):
    from connectors import settings
    if denied := admin_only(request):
        return denied
    statuses = last_statuses()
    try:
        items = settings.listing(statuses)
    except settings.SettingsError as e:
        return deny(500, str(e))
    shown = {(i["type"], i["name"]) for i in items}
    return {"types": settings.schema(), "instances": items,
            "others": [s for s in statuses if (s.get("type"), s.get("name")) not in shown]}


def connector_call(request: Request, action: str, detail: str, fn) -> JSONResponse | dict:
    from connectors import settings
    if denied := admin_write(request):
        return denied
    try:
        out = fn(settings)
    except settings.SettingsError as e:
        return deny(400, str(e))
    if action:
        store().audit(action, request.state.user["username"], ip_of(request), detail)
    return out if isinstance(out, dict) else {"ok": True, "message": "enregistré : pris en compte au prochain passage de la collecte"}


@app.put(API + "/connectors/settings/{type_}", tags=["connecteurs"], summary="Ajouter ou modifier une instance (admin ; secret vide = gardé)")
def connector_save(type_: str, body: ConnectorConf, request: Request):
    return connector_call(request, "connecteur enregistré", f"{type_} {body.name}",
                          lambda s: s.save(type_, body.name, body.config, body.original))


class Toggle(BaseModel):
    enabled: bool


@app.patch(API + "/connectors/settings/{type_}/{name}", tags=["connecteurs"], summary="Allumer ou couper un connecteur (admin)")
def connector_toggle(type_: str, name: str, body: Toggle, request: Request):
    return connector_call(request, "connecteur allumé" if body.enabled else "connecteur coupé", f"{type_} {name}",
                          lambda s: s.set_enabled(type_, name, body.enabled))


@app.delete(API + "/connectors/settings/{type_}/{name}", tags=["connecteurs"], summary="Supprimer une instance (admin)")
def connector_delete(type_: str, name: str, request: Request):
    return connector_call(request, "connecteur supprimé", f"{type_} {name}", lambda s: s.delete(type_, name))


class NpmScriptCheck(BaseModel):
    api: str = Field(max_length=200)
    ssh: str | None = Field(default=None, max_length=64)


class NpmScriptInstall(BaseModel):
    ssh: str = Field(max_length=64)
    directory: str = Field(default="npm-api", max_length=120)
    ip: str = Field(default="127.0.0.1", max_length=120)
    port: int = 81
    user: str = Field(max_length=120)
    password: str = Field(max_length=200)  # écrit dans npm-api.conf de la machine (600), jamais gardé par MyServices


@app.post(API + "/connectors/settings/npm/script/check", tags=["connecteurs"], summary="Vérifier le chemin de npm-api.sh sur une machine, sans rien lancer (admin)")
def npm_script_check(body: NpmScriptCheck, request: Request):
    return connector_call(request, "", "", lambda s: s.npm_script_check(body.api, body.ssh))


@app.post(API + "/connectors/settings/npm/script/install", tags=["connecteurs"],
          summary="Installer npm-api.sh (version figée, empreinte vérifiée) sur une machine par SSH (admin)")
def npm_script_install(body: NpmScriptInstall, request: Request):
    if (request.state.user or {}).get("token"):  # écrit sur une machine : session d'administrateur seulement, jamais un jeton d'API
        return deny(403, "installation sur une machine : session requise")
    return connector_call(request, "npm-api.sh installé", f"{body.ssh} : {body.directory}",
                          lambda s: s.npm_script_install(body.ssh, body.directory, body.ip, body.port, body.user, body.password))


@app.post(API + "/connectors/settings/{type_}/test", tags=["connecteurs"], summary="Essayer des réglages sans les enregistrer (admin)")
def connector_test(type_: str, body: ConnectorConf, request: Request):
    return connector_call(request, "", "", lambda s: s.test(type_, body.name, body.config, body.original))


# ── Machines (machines_admin.py, équivalent de setup.py --add) ─────────────────────────────────────

class MachineConf(BaseModel):
    machine: dict
    process: bool | None = None
    extra: list[dict] = []


def machine_call(request: Request, action: str, detail: str, fn, write: bool = True):
    import machines_admin
    if denied := (admin_write(request) if write else admin_only(request)):
        return denied
    try:
        out = fn(machines_admin)
    except machines_admin.MachineError as e:
        return deny(400, str(e))
    if action:
        store().audit(action, request.state.user["username"], ip_of(request), detail)
    return out


@app.get(API + "/machines/settings", tags=["machines"], summary="Machines déclarées, alias SSH connus (admin)")
def machines_settings(request: Request):
    return machine_call(request, "", "", lambda m: m.listing(), write=False)


@app.post(API + "/machines/detect", tags=["machines"], summary="Détecter une machine (IP, nom ou alias), sans rien écrire (admin)")
def machines_detect(request: Request, target: str):
    return machine_call(request, "", "", lambda m: m.detect(target))


class RedetectBody(BaseModel):
    ips: list[str] | None = None


@app.post(API + "/machines/redetect", tags=["machines"], summary="Refaire la détection des machines déclarées : écarts proposés, rien n'est écrit (admin)")
def machines_redetect(request: Request, body: RedetectBody | None = None):
    return machine_call(request, "machines redétectées", ", ".join(body.ips) if body and body.ips else "toutes",
                        lambda m: m.redetect(body.ips if body else None))


@app.put(API + "/machines/settings/{ip}", tags=["machines"], summary="Ajouter ou modifier une machine (admin)")
def machines_save(ip: str, body: MachineConf, request: Request):
    return machine_call(request, "machine enregistrée", ip,
                        lambda m: {"ok": True, "machine": m.save(ip, body.machine, body.process, body.extra),
                                   "message": "enregistrée : prise en compte au prochain passage de la collecte"})


class AliasBody(BaseModel):
    ip: str
    user: str = "root"
    port: int = 22


@app.post(API + "/machines/ssh-alias", tags=["machines"], summary="Préparer l'accès SSH d'une machine : alias avec la clé de l'app (admin)")
def machines_ssh_alias(body: AliasBody, request: Request):
    return machine_call(request, "alias SSH préparé", f"{body.user}@{body.ip}:{body.port}", lambda m: m.add_alias(body.ip, body.user, body.port))


# ── Recherche des machines du réseau (étape 4 de « Premiers pas ») ────────────────────────────────

def _netscan_file():
    return Path(core.CFG["state_dir"]) / "network-scan.json"


@app.get(API + "/network/scan", tags=["réseau"], summary="Dernière recherche de machines sur le réseau local (admin)")
def network_scan_state(request: Request):
    import netscan
    return admin_only(request) or JSONResponse({**netscan.state(_netscan_file()), "ignored": [e["ip"] for e in core.CFG["netscan_ignored"]]},
                                               headers={"Cache-Control": "no-store"})


@app.post(API + "/network/scan", tags=["réseau"], summary="Chercher les machines du réseau local : ping, nom, ports (lecture seule) (admin)")
def network_scan_start(request: Request):
    import netscan

    def launch(m):
        if not netscan.start(m.known_ips(), _netscan_file(), net=",".join(core.CFG["netscan_nets"]) or None, discreet=core.CFG["netscan_discreet"]):
            raise m.MachineError("une recherche est déjà en cours")
        return netscan.state(_netscan_file())
    return machine_call(request, "recherche réseau lancée", "", launch)


class NetscanEvery(BaseModel):
    every_h: int | None = None
    nets: list[str] | None = None
    discreet: bool | None = None


@app.get(API + "/network/settings", tags=["réseau"], summary="Fréquence de la recherche réseau automatique (admin)")
def network_settings(request: Request):
    import system
    return admin_only(request) or system.netscan_settings(core)


@app.put(API + "/network/settings", tags=["réseau"], summary="Changer la fréquence de la recherche réseau automatique, 0 = coupée (admin)")
def network_settings_set(body: NetscanEvery, request: Request):
    import system
    if denied := admin_write(request):
        return denied
    try:
        out, what = None, []
        if body.every_h is not None:
            out = system.set_netscan_every(core, body.every_h)
            what.append(f"automatique : {'coupée' if not body.every_h else f'toutes les {body.every_h} h'}")
        if body.nets is not None:
            out = system.set_netscan_nets(core, body.nets)
            what.append("réseaux : " + (", ".join(body.nets) or "celui de l'hôte"))
        if body.discreet is not None:
            out = system.set_netscan_discreet(core, body.discreet)
            what.append("mode discret " + ("activé" if body.discreet else "coupé"))
    except ValueError as e:
        return deny(400, str(e))
    store().audit("recherche réseau", request.state.user["username"], ip_of(request), " ; ".join(what))
    return {"ok": True, **(out or system.netscan_settings(core))}


class IgnoreBody(BaseModel):
    ip: str
    name: str = ""


@app.post(API + "/network/ignored", tags=["réseau"], summary="Ne plus proposer un appareil trouvé par la recherche (admin)")
def network_ignore(body: IgnoreBody, request: Request):
    import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_netscan_ignored(core, body.ip, body.name, True)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("appareil ignoré", request.state.user["username"], ip_of(request), body.ip)
    return {"ok": True, **out}


@app.delete(API + "/network/ignored/{ip}", tags=["réseau"], summary="Proposer de nouveau un appareil ignoré (admin)")
def network_unignore(ip: str, request: Request):
    import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_netscan_ignored(core, ip, "", False)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("appareil de nouveau proposé", request.state.user["username"], ip_of(request), ip)
    return {"ok": True, **out}


@app.post(API + "/network/scan/stop", tags=["réseau"], summary="Arrêter la recherche en cours (admin)")
def network_scan_stop(request: Request):
    import netscan
    if denied := admin_only(request):
        return denied
    netscan.stop()
    return netscan.state(_netscan_file())


@app.delete(API + "/machines/settings/{ip}", tags=["machines"], summary="Retirer une machine (admin)")
def machines_delete(ip: str, request: Request):
    return machine_call(request, "machine retirée", ip, lambda m: (m.delete(ip), {"ok": True})[1])


@app.post(API + "/machines/settings/{ip}/check", tags=["machines"], summary="Vérifier une machine (SSH, Docker, AdGuard, santé) (admin)")
def machines_check(ip: str, request: Request):
    return machine_call(request, "", "", lambda m: m.check(ip))


@app.post(API + "/machines/settings/{ip}/refresh", tags=["machines"], summary="Relire une seule machine : collecte (SSH, Docker) et santé (admin)")
def machines_refresh(ip: str, request: Request):
    """Après un changement d'accès ou de réglage : seule cette machine est relue par SSH (les autres restent en cache), puis la
    santé de cette machine seule. Un passage déjà en cours n'est pas doublé : il reprendra le changement au suivant."""
    def go(m):
        if ip not in m.known_ips():
            raise m.MachineError("machine inconnue")
        m.expire_inventory(ip)
        started = [t for t, args in (("collect", ()), ("health", ("--only", ip))) if core.enabled(t) and core.run_task(t, f"relecture de {ip} (Réglages → Machines)", args)]
        return {"ok": True, "started": started, "busy": not started}
    return machine_call(request, "machine relue", ip, go)


# ── API et MCP : jetons (tokens.py), serveur MCP (mcp_server.py) ──────────────────────────────────

@app.post(MCP, tags=["mcp"], summary="Serveur MCP (JSON-RPC, Streamable HTTP sans état ; jeton msv_mcp_)")
async def mcp_endpoint(request: Request):
    import mcp_server
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSON illisible"}}, status_code=400)
    u = request.state.user or {}
    ctx = {"token": u.get("token") or {"name": "?", "level": "read"},
           "audit": lambda action: store().audit(action, u.get("username"), ip_of(request))}
    states = tokens_store().tool_states()
    msgs = body if isinstance(body, list) else [body]
    out = [r for m in msgs if isinstance(m, dict) and (r := mcp_server.handle(m, ctx, core, states)) is not None]
    if not out:
        return Response(status_code=202)
    return JSONResponse(out if isinstance(body, list) else out[0])


@app.get(MCP, include_in_schema=False)
def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


class NewToken(BaseModel):
    kind: Literal["api", "mcp"]
    name: str = Field(max_length=64)
    level: Literal["read", "runs", "admin"] = "read"
    days: int | None = Field(None, ge=1, le=3650)
    password: str | None = Field(None, max_length=256)  # requis pour un jeton admin


def session_admin(request: Request) -> JSONResponse | None:
    """Jetons : gérés seulement depuis une session admin (jamais par un jeton : pas d'escalade)."""
    if denied := admin_write(request):
        return denied
    if request.state.user.get("token"):
        return deny(403, "gestion des jetons : session requise")
    return None


@app.get(API + "/tokens", tags=["jetons"], summary="Jetons d'API et MCP, outils MCP (session admin)")
def tokens_list(request: Request):
    import mcp_server
    if denied := admin_only(request):
        return denied
    if (request.state.user or {}).get("token"):
        return deny(403, "gestion des jetons : session requise")
    t = tokens_store()
    return {"tokens": t.listing(), "tools": mcp_server.tools_info(t.tool_states()), "mcp_path": MCP, "api_path": API}


@app.post(API + "/tokens", tags=["jetons"], summary="Créer un jeton (affiché une seule fois ; admin : mot de passe et durée)")
def tokens_create(body: NewToken, request: Request):
    import tokens
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


@app.delete(API + "/tokens/{tid}", tags=["jetons"], summary="Révoquer un jeton (session admin)")
def tokens_revoke(tid: int, request: Request):
    import tokens
    if denied := session_admin(request):
        return denied
    try:
        tokens_store().revoke(tid)
    except tokens.TokenError as e:
        return deny(400, str(e))
    store().audit("jeton révoqué", request.state.user["username"], ip_of(request), str(tid))
    return {"ok": True}


# ── Agents (agents.py) : la machine envoie son relevé, sans SSH ───────────────────────────────────

class NewAgent(BaseModel):
    ip: str = Field(max_length=45)
    name: str = Field(max_length=64)
    url: str | None = Field(default=None, max_length=200)  # adresse de MyServices vue par la machine (sinon celle du navigateur)


@app.post(AGENT_REPORT, tags=["agents"], summary="Relevé de santé envoyé par un agent (jeton msv_agent_)")
async def agent_report(request: Request):
    import agents
    raw = await request.body()
    if len(raw) > agents.MAX_BODY:
        return deny(413, "relevé trop gros")
    try:
        report = agents.validate_report(json.loads(raw))
    except ValueError:
        return deny(400, "relevé invalide : JSON attendu")
    except agents.AgentError as e:
        return deny(400, str(e))
    a = request.state.agent
    before, now = agents_store().store_report(a["id"], report, ip_of(request))
    first, upgraded = not a["last_seen"], str(report.get("version") or "") != (a.get("version") or "")
    # La santé est relue tout de suite au premier relevé et quand le niveau de la machine change (sinon, au prochain horaire)
    if (first or before != now) and core.enabled("health"):
        core.run_task("health", f"relevé de l'agent {a['name']} : {before or 'premier'} → {now}")
    # Premier relevé ou agent réinstallé dans une autre version : système, matériel et ports (lus à la collecte) apparaissent sans attendre l'horaire
    if (first or upgraded) and core.enabled("collect"):
        core.run_chain(["collect"], f"relevé de l'agent {a['name']} (version {report.get('version')})")
    return {"ok": True, "interval": agents.DEFAULT_INTERVAL}


@app.get(PREFIX + "/agent/{name}.ps1", tags=["agents"], summary="Scripts de l'agent Windows (sans secret, réseau local)")
def agent_script(name: str):
    import agents
    if name not in ("install", "agent"):
        return deny(404, "introuvable")
    return Response(agents.script(name + ".ps1"), media_type="text/plain; charset=utf-8")


def base_url(request: Request) -> str:
    """Adresse de MyServices vue par le navigateur (derrière un proxy : en-têtes X-Forwarded-*)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{request.headers.get('x-forwarded-host') or request.headers.get('host')}"


@app.get(API + "/agents", tags=["agents"], summary="Agents et leur dernier relevé (session admin)")
def agents_list(request: Request):
    if denied := admin_only(request):
        return denied
    if (request.state.user or {}).get("token"):
        return deny(403, "gestion des agents : session requise")
    return {"agents": agents_store().listing(), "report_path": AGENT_REPORT}


@app.post(API + "/agents", tags=["agents"], summary="Créer un agent pour une machine (jeton affiché une seule fois)")
def agents_create(body: NewAgent, request: Request):
    import agents
    if denied := session_admin(request):
        return denied
    u, ip = request.state.user, ip_of(request)
    try:
        url = agents.clean_url(body.url) if body.url else base_url(request)
        raw, info = agents_store().create(body.ip, body.name, u["username"])
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("agent créé", u["username"], ip, f"« {body.name} » ({info['ip']})")
    return {"token": raw, "info": info, "url": url, "command": agents.install_command(url, raw)}


@app.delete(API + "/agents/{aid}", tags=["agents"], summary="Révoquer un agent (session admin)")
def agents_revoke(aid: int, request: Request):
    import agents
    if denied := session_admin(request):
        return denied
    try:
        agents_store().revoke(aid)
    except agents.AgentError as e:
        return deny(400, str(e))
    store().audit("agent révoqué", request.state.user["username"], ip_of(request), str(aid))
    return {"ok": True}


class ToolToggle(BaseModel):
    enabled: bool


@app.patch(API + "/tokens/tools/{name}", tags=["jetons"], summary="Activer ou couper un outil MCP (session admin)")
def tokens_tool(name: str, body: ToolToggle, request: Request):
    import mcp_server
    if denied := session_admin(request):
        return denied
    if name not in mcp_server.TOOLS:
        return deny(400, "outil inconnu")
    tokens_store().set_tool(name, body.enabled)
    store().audit("outil MCP " + ("activé" if body.enabled else "coupé"), request.state.user["username"], ip_of(request), name)
    return {"ok": True}


# ── Système (system.py) ───────────────────────────────────────────────────────────────────────────

@app.get(API + "/system", tags=["système"], summary="Clé SSH de l'app, tâches et horaires, informations (admin)")
def system_state(request: Request):
    import sys
    import system
    if denied := admin_only(request):
        return denied
    from connectors.process import host_docker
    return {"ssh": system.ssh_key(core), "tasks": system.tasks(core), "info": system.info(core, sys.modules[__name__]),
            "host_docker": host_docker()}


class Schedule(BaseModel):
    at: str | None = Field(None, max_length=120)


@app.put(API + "/system/tasks/{name}/schedule", tags=["système"], summary="Changer l'horaire d'une tâche (vide = défaut) (admin)")
def system_schedule(name: str, body: Schedule, request: Request):
    import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_schedule(core, name, body.at)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("horaire changé", request.state.user["username"], ip_of(request), f"{name} : {out['at']}")
    return {"ok": True, **out}


class HealthSwitch(BaseModel):
    enabled: bool


@app.put(API + "/system/health", tags=["système"], summary="Allumer ou couper la santé des machines (admin)")
def system_health(body: HealthSwitch, request: Request):
    import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_health(core, body.enabled)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("santé des machines " + ("allumée" if body.enabled else "coupée"), request.state.user["username"], ip_of(request))
    if body.enabled:  # premier relevé tout de suite, puis collecte pour que l'onglet Santé apparaisse sans attendre l'horaire
        core.run_chain(["health", "collect"], "Réglages → Tâches, santé allumée")
    return {"ok": True, **out, "started": body.enabled}


# ── Sauvegardes à suivre, décrites depuis la page (backups-meta.json) ──────────────────────────────

def backups_call(request: Request, action: str, detail: str, fn, write: bool = True):
    import backups_admin
    if denied := (admin_write(request) if write else admin_only(request)):
        return denied
    try:
        out = fn(backups_admin)
    except backups_admin.BackupError as e:
        return deny(400, str(e))
    if action:
        store().audit(action, request.state.user["username"], ip_of(request), detail)
    return out


class BackupItem(BaseModel):
    ip: str
    path: str
    label: str
    max_age_days: float = 2.0


class BackupFollow(BaseModel):
    items: list[BackupItem]


@app.get(API + "/backups/settings", tags=["sauvegardes"], summary="Jeux de sauvegarde suivis et état de l'onglet (admin)")
def backups_settings(request: Request):
    return backups_call(request, "", "", lambda b: b.current(), write=False)


@app.post(API + "/backups/discover", tags=["sauvegardes"], summary="Chercher les dossiers de sauvegarde des machines lues par SSH, lecture seule (admin)")
def backups_discover(request: Request):
    return backups_call(request, "recherche de sauvegardes", "", lambda b: b.discover())


@app.put(API + "/backups/settings", tags=["sauvegardes"], summary="Suivre des dossiers de sauvegarde : écrit l'inventaire, active l'onglet (admin)")
def backups_follow(body: BackupFollow, request: Request):
    import system

    def go(b):
        out = b.follow([i.model_dump() for i in body.items])
        if not core.CFG.get("backups_url"):  # onglet Sauvegardes activé par le premier jeu
            system.set_backups_url(core, "backups.json")
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True, **out}
    return backups_call(request, "sauvegardes suivies", f"{len(body.items)} dossier(s)", go)


class VeeamAccount(BaseModel):
    url: str
    user: str = ""
    password: str = ""  # vide = celui déjà enregistré ; jamais renvoyé, ni écrit dans le journal


class VeeamJob(BaseModel):
    name: str
    label: str = ""
    max_age_days: float = 2.0


class VeeamFollow(VeeamAccount):
    jobs: list[VeeamJob]


class HaFollow(BaseModel):
    connector: str
    label: str = ""
    max_age_days: float = 2.0


@app.post(API + "/backups/veeam/test", tags=["sauvegardes"], summary="Essayer la connexion à Veeam B&R sans rien enregistrer (admin)")
def backups_veeam_test(body: VeeamAccount, request: Request):
    return backups_call(request, "essai de connexion Veeam", body.url, lambda b: b.veeam_test(body.model_dump()))


@app.post(API + "/backups/veeam/discover", tags=["sauvegardes"], summary="Lister les jobs et dépôts de Veeam B&R, lecture seule, sans rien enregistrer (admin)")
def backups_veeam_discover(body: VeeamAccount, request: Request):
    return backups_call(request, "recherche des jobs Veeam", body.url, lambda b: b.veeam_discover(body.model_dump()))


@app.put(API + "/backups/veeam", tags=["sauvegardes"], summary="Enregistrer le compte Veeam (mot de passe chiffré) et suivre des jobs (admin)")
def backups_veeam_follow(body: VeeamFollow, request: Request):
    import system

    def go(b):
        out = b.veeam_follow(body.model_dump(exclude={"jobs"}), [j.model_dump() for j in body.jobs])
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, "backups.json")
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (Veeam)")
        return {"ok": True, **out}
    return backups_call(request, "jobs Veeam suivis", f"{body.url} : {len(body.jobs)} job(s)", go)


@app.post(API + "/backups/ha/check", tags=["sauvegardes"], summary="Lire les sauvegardes de Home Assistant par son connecteur, sans rien enregistrer (admin)")
def backups_ha_check(body: HaFollow, request: Request):
    return backups_call(request, "", "", lambda b: b.ha_check(body.connector))


@app.put(API + "/backups/ha", tags=["sauvegardes"], summary="Suivre la sauvegarde automatique de Home Assistant (admin)")
def backups_ha_follow(body: HaFollow, request: Request):
    import system

    def go(b):
        out = b.ha_follow(body.connector, body.label, body.max_age_days)
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, "backups.json")
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (Home Assistant)")
        return {"ok": True, **out}
    return backups_call(request, "sauvegarde Home Assistant suivie", body.connector, go)


@app.delete(API + "/backups/settings/{set_id}", tags=["sauvegardes"], summary="Ne plus suivre un jeu de sauvegarde (admin)")
def backups_unfollow(set_id: str, request: Request):
    def go(b):
        b.unfollow(set_id)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True}
    return backups_call(request, "sauvegarde retirée", set_id, go)


@app.post(API + "/system/tasks/{name}/run", tags=["système"], summary="Lancer une tâche maintenant (admin)")
def system_run(name: str, request: Request):
    if denied := admin_write(request):
        return denied
    if name not in core.TASKS:
        return deny(400, "tâche inconnue")
    if not core.enabled(name):
        return deny(409, "tâche non configurée (rien à faire pour l'instant)")
    if not core.run_task(name, f"Réglages → Système, {request.state.user['username']}"):
        return deny(409, "déjà en cours")
    store().audit("tâche lancée", request.state.user["username"], ip_of(request), name)
    return {"ok": True}


class Confirm(BaseModel):
    password: str = Field(max_length=256)


@app.post(API + "/system/export", tags=["système"], summary="Exporter /config en tar.gz (session admin + mot de passe)")
def system_export(body: Confirm, request: Request):
    import system
    if denied := session_admin(request):
        return denied
    u, ip = request.state.user, ip_of(request)
    if store().too_many_failures(ip):
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    if store().verify(u["username"], body.password, ip) is None:
        return deny(401, "mot de passe incorrect")
    store().audit("configuration exportée", u["username"], ip)
    name = f"myservices-config-{time.strftime('%Y%m%d-%H%M')}.tar.gz"
    return Response(system.export_config(), media_type="application/gzip",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ── Sources activables (config.json « sources ») ─────────────────────────────────────────────────

@app.get(API + "/sources", tags=["sources"], summary="Sources de services activées (admin)")
def sources_state(request: Request):
    from config import sources
    if denied := admin_only(request):
        return denied
    return {"sources": sources(core.CFG)}


class SourceToggle(BaseModel):
    enabled: bool


@app.put(API + "/sources/{name}", tags=["sources"], summary="Activer ou couper une source (admin ; prise en compte à la prochaine collecte)")
def sources_set(name: str, body: SourceToggle, request: Request):
    from config import SOURCES
    import secrets_store
    if denied := admin_write(request):
        return denied
    if name not in SOURCES:
        return deny(400, "source inconnue")
    if name == "fail2ban" and body.enabled:
        return deny(400, "Fail2ban n'a pas d'interrupteur : son onglet apparaît dès qu'un connecteur LogviewR est relié")
    f = Path(os.environ.get("MYSERVICES_CONFIG") or Path(core.HERE) / "config.json")
    raw = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    src = dict(raw.get("sources") or {})
    if body.enabled == SOURCES[name]:
        src.pop(name, None)
    else:
        src[name] = body.enabled
    raw["sources"] = src
    if not src:
        raw.pop("sources")
    out, _ = secrets_store.encrypt_all(raw, f) if secrets_store.key_path(f).exists() else (raw, 0)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(f)
    core.CFG["sources"] = src
    store().audit("source " + ("activée" if body.enabled else "coupée"), request.state.user["username"], ip_of(request), name)
    return {"ok": True}


# ── Historique ────────────────────────────────────────────────────────────────────────────────────

@app.get(API + "/events", tags=["historique"], summary="Événements (pannes, rétablissements, santé…), un an")
def events(since: float | None = None, until: float | None = None, kind: str | None = None, machine: str | None = None,
           source: str | None = None, q: str | None = None, limit: int = 500):
    import history
    return {"events": history.query(db_path(core.CFG), since, until, kind, machine, source, q, limit)}


@app.get(API + "/events/per-day", tags=["historique"], summary="Nombre d'événements par jour et par genre")
def events_per_day(days: int = 30):
    import history
    return {"days": history.per_day(db_path(core.CFG), days)}


# ── Comptes et sessions ───────────────────────────────────────────────────────────────────────────

class Login(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


def cookie_secure(request: Request) -> bool:
    return request.url.scheme == "https" or os.environ.get("MYSERVICES_COOKIE_SECURE") == "1"


@app.post(API + "/login", tags=["comptes"], summary="Se connecter (cookie de session)")
def login(body: Login, request: Request):
    ip = ip_of(request)
    if store().too_many_failures(ip):
        store().audit("connexion refusée (trop d'échecs)", body.username, ip)
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    got = store().login(body.username, body.password, ip)
    if got is None:
        store().audit("connexion échouée", body.username, ip)
        return deny(401, "compte ou mot de passe incorrect")
    store().audit("connexion", got[2]["username"], ip)
    return session_response(got, request)


def session_response(got: tuple[str, str, dict], request: Request) -> JSONResponse:
    """Réponse de connexion : cookie de session (HttpOnly) et cookie CSRF (lu par la page)."""
    token, csrf, user = got
    r = JSONResponse({"username": user["username"], "role": user["role"]})
    opts = {"max_age": auth_mod.SESSION_DAYS * 86400, "path": PREFIX, "samesite": "strict", "secure": cookie_secure(request)}
    r.set_cookie(COOKIE, token, httponly=True, **opts)
    r.set_cookie(CSRF_COOKIE, csrf, httponly=False, **opts)  # lu par la page pour l'en-tête X-CSRF-Token
    return r


def setup_left() -> int:
    """Secondes restantes pour créer le premier compte ; 0 si un compte existe ou si le délai est passé."""
    if store().has_users():
        return 0
    return max(0, int(STARTED + SETUP_WINDOW - time.time()))


@app.get(API + "/setup", tags=["comptes"], summary="Premier compte à créer ? (page de connexion)")
def setup_state():
    needed = not store().has_users()
    return {"needed": needed, "seconds_left": setup_left() if needed else 0, "window_min": SETUP_WINDOW // 60}


@app.post(API + "/setup", tags=["comptes"], summary="Créer le premier compte admin (aucun compte encore)")
def setup(body: Login, request: Request):
    ip = ip_of(request)
    if store().too_many_failures(ip):
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    if store().has_users():
        return deny(409, "un compte existe déjà : se connecter")
    if not setup_left():
        return deny(403, f"délai de {SETUP_WINDOW // 60} minutes après le démarrage dépassé : redémarrer le conteneur")
    try:
        created = store().create_first_admin(body.username, body.password)
    except AuthError as e:
        return deny(400, str(e))
    if not created:
        return deny(409, "un compte existe déjà : se connecter")
    store().audit("premier compte admin créé (page)", body.username, ip)
    return session_response(store().login(body.username, body.password, ip), request)


@app.post(API + "/logout", tags=["comptes"], summary="Se déconnecter")
def logout(request: Request):
    store().logout(request.cookies.get(COOKIE))
    store().audit("déconnexion", (request.state.user or {}).get("username"), ip_of(request))
    r = JSONResponse({"ok": True})
    for c in (COOKIE, CSRF_COOKIE):
        r.delete_cookie(c, path=PREFIX)
    return r


@app.get(API + "/me", tags=["comptes"], summary="Compte connecté")
def me(request: Request):
    u = request.state.user or {}
    return {"username": u.get("username"), "role": u.get("role"), "auth": AUTH}


def admin_only(request: Request) -> JSONResponse | None:
    if AUTH and (request.state.user or {}).get("role") != "admin":
        return deny(403, "réservé aux comptes admin")
    return None


@app.get(API + "/users", tags=["comptes"], summary="Comptes (admin)")
def users(request: Request):
    return admin_only(request) or {"users": store().users()}


class NewUser(Login):
    role: Literal["admin", "viewer"] = "viewer"


class UserChange(BaseModel):
    role: Literal["admin", "viewer"] | None = None
    disabled: bool | None = None


class PasswordReset(BaseModel):
    password: str = Field(max_length=256)


def admin_write(request: Request, name: str | None = None) -> JSONResponse | None:
    """Garde des écritures sur les comptes : admin seulement, et pas sur son propre compte (rôle,
    désactivation, suppression : un admin ne se retire pas lui-même la main ; son mot de passe se change
    dans « Mon compte », avec l'actuel)."""
    if not AUTH:
        return deny(400, "comptes désactivés")
    if denied := admin_only(request):
        return denied
    if name is not None and name.casefold() == request.state.user["username"].casefold():
        return deny(400, "pas sur son propre compte : passer par un autre admin")
    return None


def account_done(request: Request, action: str, detail: str) -> dict:
    store().audit(action, request.state.user["username"], ip_of(request), detail)
    return {"ok": True}


@app.post(API + "/users", tags=["comptes"], summary="Créer un compte (admin)")
def user_create(body: NewUser, request: Request):
    if denied := admin_write(request):
        return denied
    try:
        store().create_user(body.username, body.password, body.role)
    except AuthError as e:
        return deny(400, str(e))
    return account_done(request, "compte créé", f"{body.username} ({body.role})")


@app.patch(API + "/users/{name}", tags=["comptes"], summary="Changer le rôle, activer ou désactiver un compte (admin)")
def user_update(name: str, body: UserChange, request: Request):
    if denied := admin_write(request, name):
        return denied
    try:
        store().update_user(name, body.role, body.disabled)
    except AuthError as e:
        return deny(400, str(e))
    what = [f"rôle {body.role}"] if body.role else []
    what += [] if body.disabled is None else ["désactivé" if body.disabled else "réactivé"]
    return account_done(request, "compte modifié", f"{name} : {', '.join(what) or 'rien'}")


@app.post(API + "/users/{name}/password", tags=["comptes"], summary="Donner un nouveau mot de passe à un compte (admin)")
def user_password(name: str, body: PasswordReset, request: Request):
    if denied := admin_write(request, name):
        return denied
    try:
        store().set_password(name, body.password)  # ferme aussi ses sessions
    except AuthError as e:
        return deny(400, str(e))
    return account_done(request, "mot de passe changé (admin)", name)


@app.delete(API + "/users/{name}", tags=["comptes"], summary="Supprimer un compte (admin)")
def user_delete(name: str, request: Request):
    if denied := admin_write(request, name):
        return denied
    try:
        store().delete_user(name)
    except AuthError as e:
        return deny(400, str(e))
    return account_done(request, "compte supprimé", name)


# ── Alertes (alerts.py) ───────────────────────────────────────────────────────────────────────────

class Channel(BaseModel):
    name: str = Field("", max_length=80)
    type: Literal["discord", "telegram", "webhook"] = "discord"
    config: dict[str, str] = {}
    enabled: bool = True


class ChannelChange(BaseModel):
    name: str | None = Field(None, max_length=80)
    config: dict[str, str] | None = None
    enabled: bool | None = None


class Rule(BaseModel):
    name: str | None = Field(None, max_length=80)
    kinds: list[str] | None = None
    machine: str | None = Field(None, max_length=120)
    match: str | None = Field(None, max_length=120)
    channels: list[int] | None = None
    cooldown_min: int | None = Field(None, ge=0, le=7 * 1440)
    resolved: bool | None = None
    enabled: bool | None = None


class Presets(BaseModel):
    names: list[str]


def alerts_call(request: Request, action: str, detail: str, fn) -> JSONResponse | dict:
    """Écriture sur les alertes : admin, refus lisible, trace dans le journal."""
    import alerts
    if denied := admin_write(request):
        return denied
    try:
        out = fn(core.alerts_store())
    except (alerts.AlertError, ValueError) as e:
        return deny(400, str(e))
    store().audit(action, request.state.user["username"], ip_of(request), detail)
    return {"ok": True, **(out if isinstance(out, dict) else {})}


@app.get(API + "/alerts", tags=["alertes"], summary="Canaux, règles, genres d'événements, préréglages, envois (admin)")
def alerts_state(request: Request):
    import alerts
    if denied := admin_only(request):
        return denied
    a = core.alerts_store()
    return {"channels": a.channels(), "rules": a.rules(), "sent": a.sent(), "active": a.active(),
            "kinds": [{"id": k, "label": v[0], "group": v[1]} for k, v in alerts.KINDS.items()],
            "groups": alerts.GROUPS, "presets": alerts.PRESETS}


@app.post(API + "/alerts/channels", tags=["alertes"], summary="Ajouter un canal (admin)")
def alerts_channel_add(body: Channel, request: Request):
    return alerts_call(request, "canal d'alerte ajouté", f"{body.name or body.type} ({body.type})",
                       lambda a: {"id": a.add_channel(body.name, body.type, body.config, body.enabled)})


@app.patch(API + "/alerts/channels/{cid}", tags=["alertes"], summary="Modifier un canal (admin ; secret vide = gardé)")
def alerts_channel_update(cid: int, body: ChannelChange, request: Request):
    return alerts_call(request, "canal d'alerte modifié", str(cid), lambda a: a.update_channel(cid, body.name, body.config, body.enabled))


@app.delete(API + "/alerts/channels/{cid}", tags=["alertes"], summary="Supprimer un canal (admin)")
def alerts_channel_delete(cid: int, request: Request):
    return alerts_call(request, "canal d'alerte supprimé", str(cid), lambda a: a.delete_channel(cid))


@app.post(API + "/alerts/channels/{cid}/test", tags=["alertes"], summary="Envoyer un message d'essai (admin)")
def alerts_channel_test(cid: int, request: Request):
    def test(a):
        ok, info = a.test_channel(cid)
        if not ok:
            raise ValueError(info)
        return {"message": info}
    return alerts_call(request, "essai d'alerte", str(cid), test)


@app.post(API + "/alerts/rules", tags=["alertes"], summary="Ajouter une règle (admin)")
def alerts_rule_add(body: Rule, request: Request):
    return alerts_call(request, "règle d'alerte ajoutée", body.name or "",
                       lambda a: {"id": a.add_rule(body.model_dump(exclude_none=True))})


@app.patch(API + "/alerts/rules/{rid}", tags=["alertes"], summary="Modifier une règle (admin)")
def alerts_rule_update(rid: int, body: Rule, request: Request):
    return alerts_call(request, "règle d'alerte modifiée", str(rid), lambda a: a.update_rule(rid, body.model_dump(exclude_none=True)))


@app.delete(API + "/alerts/rules/{rid}", tags=["alertes"], summary="Supprimer une règle (admin)")
def alerts_rule_delete(rid: int, request: Request):
    return alerts_call(request, "règle d'alerte supprimée", str(rid), lambda a: a.delete_rule(rid))


@app.post(API + "/alerts/presets", tags=["alertes"], summary="Ajouter des préréglages, désactivés (admin)")
def alerts_presets(body: Presets, request: Request):
    return alerts_call(request, "préréglages d'alerte ajoutés", ", ".join(body.names)[:200],
                       lambda a: {"added": a.add_presets(body.names)})


@app.get(API + "/audit", tags=["comptes"], summary="Journal des actions (admin)")
def audit(request: Request, limit: int = 200):
    return admin_only(request) or {"audit": store().audit_log(limit)}


class PasswordChange(BaseModel):
    current: str = Field(max_length=256)
    new: str = Field(max_length=256)


@app.get(API + "/me/sessions", tags=["comptes"], summary="Mes sessions ouvertes")
def my_sessions(request: Request):
    u = request.state.user or {}
    if not AUTH or not u:
        return deny(400, "comptes désactivés")
    return {"sessions": store().sessions_of(u["username"], request.cookies.get(COOKIE)), "days": auth_mod.SESSION_DAYS}


@app.post(API + "/me/sessions/revoke-others", tags=["comptes"], summary="Fermer mes autres sessions (autres appareils)")
def revoke_other_sessions(request: Request):
    u = request.state.user or {}
    if not AUTH or not u or not request.cookies.get(COOKIE):
        return deny(400, "session requise")
    n = store().revoke_others(u["username"], request.cookies.get(COOKIE))
    store().audit("autres sessions fermées", u["username"], ip_of(request), f"{n} session(s)")
    return {"ok": True, "closed": n, "message": f"{n} autre(s) session(s) fermée(s)"}


class SessionDays(BaseModel):
    days: int


@app.put(API + "/security/session-days", tags=["comptes"], summary="Durée des sessions, de 1 à 90 jours (admin)")
def set_session_days(body: SessionDays, request: Request):
    import system
    if denied := admin_write(request):
        return denied
    try:
        system.set_session_days(core, body.days)
    except AuthError as e:
        return deny(400, str(e))
    store().audit("durée des sessions changée", request.state.user["username"], ip_of(request), f"{body.days} jours")
    return {"ok": True, "days": body.days}


@app.post(API + "/me/password", tags=["comptes"], summary="Changer son mot de passe")
def change_password(body: PasswordChange, request: Request):
    u, ip = request.state.user or {}, ip_of(request)
    if not AUTH or not u:
        return deny(400, "comptes désactivés")
    if store().too_many_failures(ip):  # même limite qu'à la connexion : pas d'essais sans fin avec une session volée
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    if store().verify(u["username"], body.current, ip) is None:  # échec compté comme une connexion ratée
        return deny(401, "mot de passe actuel incorrect")
    try:
        store().set_password(u["username"], body.new)  # ferme aussi toutes ses sessions
    except AuthError as e:
        return deny(400, str(e))
    store().audit("mot de passe changé", u["username"], ip)
    return {"ok": True, "message": "mot de passe changé : se reconnecter"}


# ── Page et fichiers produits ─────────────────────────────────────────────────────────────────────

def find(rel: str) -> Path | None:
    """Fichier produit (volume) d'abord, sinon fichier de la page ; jamais hors de ces dossiers."""
    for root in (core.WEB, core.STATIC):
        try:
            f = (root / rel).resolve()
            base = root.resolve()
        except OSError:
            continue
        if f.is_relative_to(base) and f.is_file():
            return f
    return None


@app.get(PREFIX + "/{rel:path}", include_in_schema=False)
def files(rel: str):
    if rel == "":  # /myservices/ : le front
        return RedirectResponse(PREFIX + "/v2/", status_code=302)
    if rel.endswith("/"):
        rel += "index.html"
    f = find(rel)
    if f is None and find(rel + "/index.html"):  # dossier tapé sans « / » final (ex. /myservices/v2)
        return RedirectResponse(f"{PREFIX}/{quote(rel.strip('/'))}/", status_code=302)  # toujours sous /myservices/, jamais un autre site
    if f is None:
        return HTMLResponse(f'<!doctype html><meta charset="utf-8"><title>MyServices</title>'
                            f'<p style="font:16px system-ui;padding:2em">Page introuvable. '
                            f'<a href="{PREFIX}/">Retour à MyServices</a></p>', status_code=404)
    ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/json", "application/javascript", "image/svg+xml"):
        ctype += "; charset=utf-8"
    return FileResponse(f, media_type=ctype, headers={"Cache-Control": "no-cache, must-revalidate"})
