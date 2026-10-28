"""API routes: accounts."""
from __future__ import annotations

import os
import time
from typing import Literal
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from msv.api import common
from msv.api import server as core
from msv.core import auth as auth_mod
from msv.core.auth import AuthError
from msv.api.common import API, COOKIE, CSRF_COOKIE, LEGACY, SETUP_WINDOW, admin_only, admin_write, deny, ip_of, store

router = APIRouter()

class Login(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


def cookie_secure(request: Request) -> bool:
    return request.url.scheme == "https" or os.environ.get("MYSERVICES_COOKIE_SECURE") == "1"


@router.post(API + "/login", tags=["comptes"], summary="Se connecter (cookie de session)")
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
    opts = {"max_age": auth_mod.SESSION_DAYS * 86400, "path": "/", "samesite": "strict", "secure": cookie_secure(request)}
    r.set_cookie(COOKIE, token, httponly=True, **opts)
    r.set_cookie(CSRF_COOKIE, csrf, httponly=False, **opts)  # lu par la page pour l'en-tête X-CSRF-Token
    return r


def setup_left() -> int:
    """Secondes restantes pour créer le premier compte ; 0 si un compte existe ou si le délai est passé."""
    if store().has_users():
        return 0
    return max(0, int(common.STARTED + SETUP_WINDOW - time.time()))


@router.get(API + "/setup", tags=["comptes"], summary="Premier compte à créer ? (page de connexion)")
def setup_state():
    from msv.alerts import mailer
    needed = not store().has_users()
    return {"needed": needed, "seconds_left": setup_left() if needed else 0, "window_min": SETUP_WINDOW // 60,
            "mail": mailer.ready(core.CFG)}   # « Forgot your password? » sends a link only when e-mails are set up


@router.post(API + "/setup", tags=["comptes"], summary="Créer le premier compte admin (aucun compte encore)")
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


@router.post(API + "/logout", tags=["comptes"], summary="Se déconnecter")
def logout(request: Request):
    store().logout(request.cookies.get(COOKIE))
    store().audit("déconnexion", (request.state.user or {}).get("username"), ip_of(request))
    r = JSONResponse({"ok": True})
    for c in (COOKIE, CSRF_COOKIE):
        r.delete_cookie(c, path="/")
        r.delete_cookie(c, path=LEGACY)   # cookie set before 0.10.2, when the cookie path was /myservices
    return r


def _avatar_version(username: str) -> str | None:
    from msv.core import avatars
    got = store().avatar(username)
    return avatars.version(got[0]) if got else None


@router.get(API + "/me", tags=["comptes"], summary="Compte connecté")
def me(request: Request):
    u = request.state.user or {}
    from msv.core import about
    from msv.alerts import mailer
    return {"username": u.get("username"), "role": u.get("role"), "auth": common.AUTH, "version": os.environ.get("MYSERVICES_VERSION", "dev"),
            "email": store().email_of(u["username"]) if common.AUTH and u.get("username") and not u.get("token") else None,
            "mail_ready": mailer.ready(core.CFG), "mail_error": "" if mailer.LAST["ok"] else mailer.LAST["error"],   # the profile warns when « Forgot your password? » links cannot be sent
            "avatar": _avatar_version(u.get("username")) if common.AUTH and u.get("username") and not u.get("token") else None,
            # image de développement : le dépôt git d'où elle vient (describe) et la version prévue d'après le journal des changements
            "git": os.environ.get("MYSERVICES_GIT", ""), "planned": about.planned(about.changelog(Path(core.HERE) / "CHANGELOG.md")),
            # last release written in this build's changelog: an image built from a branch shows it (« 0.10.1+ · main abc1234 »)
            "released": about.released(about.changelog(Path(core.HERE) / "CHANGELOG.md")),
            # a newer release published, from the last check kept (no request here), automatic or by « Check now »
            "update": about.cached(Path(core.CFG["state_dir"]), os.environ.get("MYSERVICES_VERSION", "dev"))}


@router.get(API + "/users", tags=["comptes"], summary="Comptes (admin)")
def users(request: Request):
    return admin_only(request) or {"users": store().users()}


class NewUser(Login):
    role: Literal["admin", "viewer"] = "viewer"


class UserChange(BaseModel):
    role: Literal["admin", "viewer"] | None = None
    disabled: bool | None = None


class PasswordReset(BaseModel):
    password: str = Field(max_length=256)


def account_done(request: Request, action: str, detail: str) -> dict:
    store().audit(action, request.state.user["username"], ip_of(request), detail)
    return {"ok": True}


@router.post(API + "/users", tags=["comptes"], summary="Créer un compte (admin)")
def user_create(body: NewUser, request: Request):
    if denied := admin_write(request):
        return denied
    try:
        store().create_user(body.username, body.password, body.role)
    except AuthError as e:
        return deny(400, str(e))
    return account_done(request, "compte créé", f"{body.username} ({body.role})")


@router.patch(API + "/users/{name}", tags=["comptes"], summary="Changer le rôle, activer ou désactiver un compte (admin)")
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


@router.post(API + "/users/{name}/password", tags=["comptes"], summary="Donner un nouveau mot de passe à un compte (admin)")
def user_password(name: str, body: PasswordReset, request: Request):
    if denied := admin_write(request, name):
        return denied
    try:
        store().set_password(name, body.password)  # ferme aussi ses sessions
    except AuthError as e:
        return deny(400, str(e))
    return account_done(request, "mot de passe changé (admin)", name)


@router.delete(API + "/users/{name}", tags=["comptes"], summary="Supprimer un compte (admin)")
def user_delete(name: str, request: Request):
    if denied := admin_write(request, name):
        return denied
    try:
        store().delete_user(name)
    except AuthError as e:
        return deny(400, str(e))
    return account_done(request, "compte supprimé", name)
