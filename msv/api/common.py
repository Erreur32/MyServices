"""Shared part of the API: the app, its guards (allowed networks, session, CSRF, origin), the stores and the helpers the routes use."""
from __future__ import annotations

import ipaddress
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.middleware.gzip import GZipMiddleware

from msv.api import server as core
from msv.core import auth as auth_mod, models
from msv.core.auth import AuthError, Store, db_path

# The app lives at the root of the site: http://<host>:8090/ (page), /api/v1/ (API), /mcp, /agent/… Before 0.10.2 everything sat under /myservices/
# (and the page under /myservices/v2/): that old prefix is still understood, see LegacyPrefix below, so bookmarks, agents already installed on
# Windows PCs, API tokens and MCP clients keep working.
PREFIX = ""


LEGACY = "/myservices"


API = "/api/v1"


PNG = "image/png"


app = FastAPI(title="MyServices", version="2", docs_url=API + "/docs", redoc_url=None,
              openapi_url=API + "/openapi.json")


app.add_middleware(GZipMiddleware, minimum_size=1000)   # data.json (~200 Ko) et les longues listes : 5 à 10 fois moins d'octets sur le réseau


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
       # The React front: scripts stay strict. Styles may be inline, because the UniFi device cards (a custom element) build their face plate
       # with <style> tags and style attributes: with style-src 'self' alone they showed a bare text list.
       "front": _CSP_BASE + "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
       "map": _CSP_BASE + "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                          "img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:"}


def csp_for(path: str) -> str | None:
    if path.startswith(API + "/docs"):
        return None
    if path in ("/", "/index.html"):   # the React front: strict scripts, inline styles for the UniFi cards
        return CSP["front"]
    if path.startswith("/login."):   # the sign-in page: strict policy
        return CSP["login"]
    if path.endswith("/carte.html"):
        return CSP["map"]
    return CSP["page"]


AUTH = os.environ.get("MYSERVICES_AUTH", "1") != "0"


COOKIE, CSRF_COOKIE = "ms_session", "ms_csrf"


# Accessibles sans session : page de connexion et ce qu'elle charge, connexion, santé du conteneur
PUBLIC = {"/healthz", "/agent/install.ps1", "/agent/agent.ps1", "/agent/install.sh", "/agent/agent.py", "/login.html", "/login.js", "/login.css", "/favicon.svg",
          API + "/login", API + "/setup", API + "/password/forgot", API + "/password/reset"}


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


MCP = "/mcp"


AGENT_REPORT = API + "/agent/report"  # seule route d'un agent : jeton msv_agent_, ni session ni CSRF
AGENT_PATHS = {AGENT_REPORT, *(p for p in PUBLIC if p.startswith("/agent/"))}   # all a machine outside MYSERVICES_ALLOW may reach


TOKENS = None


AGENTS = None


def tokens_store():
    global TOKENS
    if TOKENS is None:
        from msv.core import tokens
        TOKENS = tokens.Tokens(db_path(core.CFG))
    return TOKENS


def agents_store():
    global AGENTS
    if AGENTS is None:
        from msv.machines import agents
        AGENTS = agents.Agents(db_path(core.CFG))
    return AGENTS


def agent_guard(request: Request, raw: str) -> JSONResponse | None:
    """Jeton d'agent valable : la fiche est posée dans request.state.agent."""
    from msv.machines import agents
    store_, ip = agents_store(), ip_of(request)
    if store_.too_many_bad(ip):
        return JSONResponse({"error": "trop de jetons refusés : réessayer dans 15 minutes", "code": "TOO_MANY_BAD_TOKENS"},
                            status_code=429, headers={**SECURITY_HEADERS, "Retry-After": str(agents.BAD_WINDOW)})
    try:
        request.state.agent = store_.check(raw)
    except agents.AgentError as e:
        if str(e) in ("TOKEN_MISSING", "TOKEN_INVALID"):   # a revoked token is a known agent still retrying, not a guess
            store_.note_bad(ip)
        return JSONResponse({"error": str(e), "code": str(e)}, status_code=401, headers=SECURITY_HEADERS)
    return None


def token_guard(request: Request, path: str, raw: str) -> JSONResponse | None:
    """Jeton d'API (routes REST) ou MCP (/mcp) : valable, bonne sorte, niveau suffisant pour la route."""
    from msv.core import tokens
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
    host = request.client.host if request.client else None
    if not client_allowed(host) and not (request.url.path in AGENT_PATHS and agents_store().allows_ip(host)):
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
            return RedirectResponse(f"/login.html?next={quote(path)}", status_code=302, headers=SECURITY_HEADERS)
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


class LegacyPrefix:
    """Understands the old /myservices/… addresses (before 0.10.2 the whole app sat under /myservices/, the page under /myservices/v2/).
    - API, MCP and agent paths, and any write: answered as if asked at the root (the path is rewritten, no redirect), so agents installed on
      Windows PCs, API tokens, MCP clients and scripts keep working untouched; the guard then sees the root path, so access rules do not change.
    - Pages and files (GET / HEAD): redirected to the same address at the root (« /myservices/v2/ » -> « / »), so bookmarks lead to the new URLs.
    Runs before the guard, as the outermost middleware."""
    ALIASED = ("/api/", "/mcp", "/agent/")

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if scope["type"] != "http" or not (path == LEGACY or path.startswith(LEGACY + "/")):
            return await self.app(scope, receive, send)
        rest = path[len(LEGACY):] or "/"
        if rest.startswith(self.ALIASED) or scope["method"] not in ("GET", "HEAD"):
            scope = dict(scope, path=rest, raw_path=rest.encode())
            return await self.app(scope, receive, send)
        if rest == "/v2" or rest.startswith("/v2/"):
            rest = rest[3:] or "/"
        # One single leading slash and no backslash: a « //host » or « /\host » target would send the visitor to another site
        target = "/" + quote(rest.lstrip("/\\"), safe="/%:@!$&'()*+,;=~-._")
        qs = scope.get("query_string", b"")
        if qs:
            target += "?" + qs.decode("latin-1")
        await RedirectResponse(target, status_code=302, headers=SECURITY_HEADERS)(scope, receive, send)


app.add_middleware(LegacyPrefix)


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}


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


def machine_call(request: Request, action: str, detail: str, fn, write: bool = True):
    from msv.machines import machines_admin
    if denied := (admin_write(request) if write else admin_only(request)):
        return denied
    try:
        out = fn(machines_admin)
    except machines_admin.MachineError as e:
        return deny(400, str(e))
    if action:
        store().audit(action, request.state.user["username"], ip_of(request), detail)
    return out


def _netscan_file():
    return Path(core.CFG["state_dir"]) / "network-scan.json"


def session_admin(request: Request) -> JSONResponse | None:
    """Jetons : gérés seulement depuis une session admin (jamais par un jeton : pas d'escalade)."""
    if denied := admin_write(request):
        return denied
    if request.state.user.get("token"):
        return deny(403, "gestion des jetons : session requise")
    return None


def admin_only(request: Request) -> JSONResponse | None:
    if AUTH and (request.state.user or {}).get("role") != "admin":
        return deny(403, "réservé aux comptes admin")
    return None


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


def find(rel: str) -> Path | None:
    """Produced file (volume) first, then a file of the page, then the compiled front (assets/, icons/…); never outside these folders."""
    for root in (core.WEB, core.STATIC, core.STATIC / "v2"):
        try:
            f = (root / rel).resolve()
            base = root.resolve()
        except OSError:
            continue
        if f.is_relative_to(base) and f.is_file():
            return f
    return None
