"""API routes: notifications."""
from __future__ import annotations

import threading
from typing import Literal
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from msv.api import common
from msv.api import server as core
from msv.core import auth as auth_mod
from msv.core.auth import AuthError
from msv.api.common import API, COOKIE, admin_only, admin_write, deny, ip_of, store

router = APIRouter()

class NotificationBody(BaseModel):
    name: str | None = Field(None, max_length=80)
    kind: Literal["report", "events"] | None = None
    config: dict | None = None
    channels: list[int] | None = None
    enabled: bool | None = None


class ExampleNames(BaseModel):
    names: list[str]


def notif_call(request: Request, action: str, detail: str, fn) -> JSONResponse | dict:
    from msv.alerts import alerts
    from msv.alerts import notifications
    if denied := admin_write(request):
        return denied
    try:
        out = fn(core.notifications_store())
    except (notifications.NotificationError, alerts.AlertError, ValueError, TypeError) as e:
        return deny(400, str(e))
    store().audit(action, request.state.user["username"], ip_of(request), detail)
    return {"ok": True, **(out if isinstance(out, dict) else {})}


@router.get(API + "/notifications", tags=["notifications"], summary="Notifications personnalisées, capteurs, machines, exemples (admin)")
def notifications_state(request: Request):
    from msv.alerts import alerts
    from msv.alerts import notifications
    if denied := admin_only(request):
        return denied
    n = core.notifications_store()
    _, data = n._data()
    names = {m["ip"]: m["name"] for m in data.get("machine_list") or [] if not m.get("disabled")}
    sent = [x for x in core.alerts_store().sent(200) if (x.get("rule") or "").startswith("🔔")][:30]
    return {"notifications": n.list(), "channels": core.alerts_store().channels(), "sent": sent,
            "sensors": [{"id": k, "label": v[0], "icon": v[1]} for k, v in notifications.SENSORS.items()],
            "machines": [{"ip": ip, "name": nm} for ip, nm in names.items()],
            "kinds": [{"id": k, "label": v[0], "group": v[1]} for k, v in alerts.KINDS.items()], "groups": alerts.GROUPS,
            "examples": [{"name": e["name"], "kind": e["kind"]} for e in notifications.EXAMPLES]}


@router.post(API + "/notifications", tags=["notifications"], summary="Ajouter une notification (admin)")
def notifications_add(body: NotificationBody, request: Request):
    return notif_call(request, "notification ajoutée", body.name or "", lambda n: {"id": n.add(body.model_dump(exclude_none=True))})


@router.patch(API + "/notifications/{nid}", tags=["notifications"], summary="Modifier une notification (admin)")
def notifications_update(nid: int, body: NotificationBody, request: Request):
    return notif_call(request, "notification modifiée", str(nid), lambda n: n.update(nid, body.model_dump(exclude_none=True)))


@router.delete(API + "/notifications/{nid}", tags=["notifications"], summary="Supprimer une notification (admin)")
def notifications_delete(nid: int, request: Request):
    return notif_call(request, "notification supprimée", str(nid), lambda n: n.delete(nid))


@router.post(API + "/notifications/{nid}/send", tags=["notifications"], summary="Envoyer maintenant un vrai message de cette notification (admin)")
def notifications_send(nid: int, request: Request):
    return notif_call(request, "notification envoyée maintenant", str(nid), lambda n: {"results": n.send_now(nid)})


@router.post(API + "/notifications/examples", tags=["notifications"], summary="Ajouter des exemples, désactivés (admin)")
def notifications_examples(body: ExampleNames, request: Request):
    return notif_call(request, "exemples de notification ajoutés", ", ".join(body.names)[:200], lambda n: {"added": n.add_examples(body.names)})


@router.get(API + "/audit", tags=["comptes"], summary="Journal des actions (admin)")
def audit(request: Request, limit: int = 200):
    return admin_only(request) or {"audit": store().audit_log(limit)}


class PasswordChange(BaseModel):
    current: str = Field(max_length=256)
    new: str = Field(max_length=256)


@router.get(API + "/me/sessions", tags=["comptes"], summary="Mes sessions ouvertes")
def my_sessions(request: Request):
    u = request.state.user or {}
    if not common.AUTH or not u:
        return deny(400, "comptes désactivés")
    return {"sessions": store().sessions_of(u["username"], request.cookies.get(COOKIE)), "days": auth_mod.SESSION_DAYS}


@router.post(API + "/me/sessions/revoke-others", tags=["comptes"], summary="Fermer mes autres sessions (autres appareils)")
def revoke_other_sessions(request: Request):
    u = request.state.user or {}
    if not common.AUTH or not u or not request.cookies.get(COOKIE):
        return deny(400, SESSION_NEEDED)
    n = store().revoke_others(u["username"], request.cookies.get(COOKIE))
    store().audit("autres sessions fermées", u["username"], ip_of(request), f"{n} session(s)")
    return {"ok": True, "closed": n, "message": f"{n} autre(s) session(s) fermée(s)"}


class SessionDays(BaseModel):
    days: int


@router.put(API + "/security/session-days", tags=["comptes"], summary="Durée des sessions, de 1 à 90 jours (admin)")
def set_session_days(body: SessionDays, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    try:
        system.set_session_days(core, body.days)
    except AuthError as e:
        return deny(400, str(e))
    store().audit("durée des sessions changée", request.state.user["username"], ip_of(request), f"{body.days} jours")
    return {"ok": True, "days": body.days}


SESSION_NEEDED = "session requise"   # account changes (e-mail, avatar): a signed-in person, never an API token


class EmailBody(BaseModel):
    email: str = Field(max_length=254)


@router.put(API + "/me/email", tags=["comptes"], summary="Mon adresse e-mail (lien de mot de passe oublié)")
def set_my_email(body: EmailBody, request: Request):
    u = request.state.user or {}
    if not common.AUTH or not u or u.get("token"):
        return deny(400, "comptes désactivés" if not AUcommon.TH else SESSION_NEEDED)
    try:
        email = store().set_email(u["username"], body.email)
    except AuthError as e:
        return deny(400, str(e))
    store().audit("adresse e-mail changée", u["username"], ip_of(request))
    return {"ok": True, "email": email}


class AvatarBody(BaseModel):
    image: str = Field(max_length=720_000)   # data URL, base64 of 512 KB at most


@router.put(API + "/me/avatar", tags=["comptes"], summary="Mon avatar : PNG, JPEG, WebP, GIF ou SVG (512 Ko au plus, SVG nettoyé)")
def set_my_avatar(body: AvatarBody, request: Request):
    from msv.core import avatars
    u = request.state.user or {}
    if not common.AUTH or not u or u.get("token"):
        return deny(400, "comptes désactivés" if not AUcommon.TH else SESSION_NEEDED)
    try:
        raw, mime = avatars.from_data_url(body.image)
    except avatars.AvatarError as e:
        return deny(400, str(e))
    store().set_avatar(u["username"], raw, mime)
    store().audit("avatar changé", u["username"], ip_of(request), mime)
    return {"ok": True, "avatar": avatars.version(raw)}


@router.delete(API + "/me/avatar", tags=["comptes"], summary="Retirer mon avatar")
def delete_my_avatar(request: Request):
    u = request.state.user or {}
    if not common.AUTH or not u or u.get("token"):
        return deny(400, "comptes désactivés" if not AUcommon.TH else SESSION_NEEDED)
    store().set_avatar(u["username"], None, None)
    store().audit("avatar retiré", u["username"], ip_of(request))
    return {"ok": True, "avatar": None}


@router.get(API + "/users/{name}/avatar", tags=["comptes"], summary="Avatar d'un compte (image ; 404 sans avatar)")
def user_avatar(name: str, request: Request):
    from msv.core import avatars
    if not common.AUTH or not request.state.user:
        return deny(404, "aucun avatar")
    got = store().avatar(name)
    if got is None:
        return deny(404, "aucun avatar")
    raw, mime = got
    # an SVG opened on its own runs nothing (sandbox), and the browser never guesses another type
    return Response(raw, media_type=mime, headers={"Content-Security-Policy": avatars.SERVE_CSP, "X-Content-Type-Options": "nosniff",
                                                    "Cache-Control": "private, max-age=86400", "Content-Disposition": "inline"})


class IconBody(BaseModel):
    image: str = Field(max_length=720_000)   # data URL, base64 of 512 KB at most
    name: str | None = Field(default=None, max_length=80)


@router.get(API + "/icons", tags=["icônes"], summary="Icônes importées pour les machines et les services")
def icons_list(request: Request):
    from msv.core import custom_icons
    if common.AUTH and not request.state.user:
        return deny(401, "session requise")
    return {"icons": custom_icons.listing(), "max": custom_icons.MAX_ICONS}


@router.post(API + "/icons", tags=["icônes"], summary="Importer une icône : PNG, JPEG, WebP, GIF ou SVG (512 Ko au plus, SVG nettoyé) (admin)")
def icons_add(body: IconBody, request: Request):
    from msv.core import avatars
    from msv.core import custom_icons
    if denied := admin_write(request):
        return denied
    try:
        raw, _ = avatars.from_data_url(body.image)
        key = custom_icons.add(raw, body.name)
    except (avatars.AvatarError, custom_icons.IconError) as e:
        return deny(400, str(e))
    store().audit("icône importée", request.state.user["username"], ip_of(request), key)
    return {"ok": True, "key": key}


@router.get(API + "/icons/{key}", tags=["icônes"], summary="Une icône importée (image ; 404 si inconnue)")
def icons_get(key: str, request: Request):
    from msv.core import avatars
    from msv.core import custom_icons
    if common.AUTH and not request.state.user:
        return deny(404, "aucune icône")
    got = custom_icons.get(key)
    if got is None:
        return deny(404, "aucune icône")
    raw, mime = got
    # same guard as an avatar: an SVG opened on its own runs nothing, and the type is never guessed. The key is a fingerprint: cache for good
    return Response(raw, media_type=mime, headers={"Content-Security-Policy": avatars.SERVE_CSP, "X-Content-Type-Options": "nosniff",   # NOSONAR S5131: checked by avatars.check, sent with a sandbox CSP and nosniff
                                                    "Cache-Control": "private, max-age=31536000, immutable", "Content-Disposition": "inline"})


@router.delete(API + "/icons/{key}", tags=["icônes"], summary="Supprimer une icône importée, si aucune machine ni aucun service ne l'utilise (admin)")
def icons_delete(key: str, request: Request):
    from msv.core import custom_icons
    if denied := admin_write(request):
        return denied
    try:
        meta_text = Path(core.CFG["meta"]).read_text(encoding="utf-8")
    except OSError:
        meta_text = ""
    if custom_icons.used(key, meta_text):
        return deny(409, "icône encore utilisée par une machine ou un service : en choisir une autre d'abord")
    if not custom_icons.remove(key):
        return deny(404, "icône inconnue")
    store().audit("icône supprimée", request.state.user["username"], ip_of(request), key)
    return {"ok": True}


class Forgot(BaseModel):
    identity: str = Field(max_length=254)


FORGOT_ANSWER = "si un compte correspond et a une adresse e-mail, un lien vient d'y être envoyé (valable 30 minutes)"


@router.post(API + "/password/forgot", tags=["comptes"], summary="Mot de passe oublié : lien envoyé par e-mail (même réponse, compte connu ou non)")
def password_forgot(body: Forgot, request: Request):
    from msv.alerts import mailer
    ip = ip_of(request)
    if not common.AUTH:
        return deny(400, "comptes désactivés")
    if not mailer.ready(core.CFG):
        return deny(503, "envoi d'e-mails non réglé : demander à un administrateur")
    if store().too_many_failures(ip):
        return deny(429, "trop de demandes : réessayer dans 15 minutes")
    store().note_failure(ip)   # every request counts: no guessing of names or addresses
    row = store().reset_target(body.identity)
    token = store().create_reset(row["id"], ip) if row else None
    if token:
        subject, text = mailer.reset_text(core.CFG["page_url"], token, row["username"], auth_mod.RESET_MIN)
        def go(to=row["email"], name=row["username"]):   # sent aside: the answer takes the same time, account known or not
            try:
                mailer.send(core.CFG, to, subject, text)
                store().audit("lien de mot de passe envoyé", name, ip)
            except mailer.MailError as e:
                store().audit("lien de mot de passe non envoyé", name, ip, str(e))
        threading.Thread(target=go, daemon=True).start()
    store().audit("mot de passe oublié demandé", (body.identity or "")[:64], ip)
    return {"ok": True, "message": FORGOT_ANSWER}


class Reset(BaseModel):
    token: str = Field(max_length=128)
    password: str = Field(max_length=256)


@router.get(API + "/password/reset", tags=["comptes"], summary="Lien de réinitialisation encore valable ?")
def password_reset_state(token: str = ""):
    return {"valid": store().reset_valid(token)}


@router.post(API + "/password/reset", tags=["comptes"], summary="Nouveau mot de passe par un lien reçu par e-mail (une fois, 30 min)")
def password_reset(body: Reset, request: Request):
    ip = ip_of(request)
    if store().too_many_failures(ip):
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    try:
        name = store().use_reset(body.token, body.password)
    except AuthError as e:
        if not store().reset_valid(body.token):
            store().note_failure(ip)   # a wrong or old link counts as a failed sign-in
        return deny(400, str(e))
    store().audit("mot de passe réinitialisé (lien e-mail)", name, ip)
    return {"ok": True, "message": "mot de passe changé : se connecter"}


@router.get(API + "/system/mail", tags=["système"], summary="Envoi d'e-mails : réglages, sans le mot de passe (admin)")
def mail_get(request: Request):
    from msv.collect import system
    return admin_only(request) or system.mail_settings(core)


class MailConf(BaseModel):
    host: str = Field("", max_length=253)
    port: int = 587
    security: str = Field("starttls", max_length=10)
    user: str = Field("", max_length=254)
    password: str | None = Field(None, max_length=256)   # left empty it is kept, « - » clears it
    sender: str = Field("", max_length=254)
    page_url: str = Field("", max_length=300)


@router.put(API + "/system/mail", tags=["système"], summary="Envoi d'e-mails : serveur SMTP, expéditeur, adresse de la page (admin)")
def mail_put(body: MailConf, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_mail_settings(core, body.host, body.port, body.security, body.user, body.password, body.sender, body.page_url)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("envoi d'e-mails réglé", request.state.user["username"], ip_of(request), body.host)
    return out


@router.post(API + "/system/mail/test", tags=["système"], summary="Envoyer un e-mail de test à sa propre adresse (admin)")
def mail_test(request: Request, body: MailConf | None = None):
    """With a body: tries those values without saving them; without: the saved settings."""
    from msv.alerts import mailer
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    u = request.state.user
    owner = (u["token"].get("created_by") or "") if u.get("token") else u["username"]  # a token writes to its creator
    to = store().email_of(owner)
    if not to:
        return deny(400, "votre compte n'a pas d'adresse e-mail : l'ajouter dans Profil" if not u.get("token")
                    else "le compte qui a créé ce jeton n'a pas d'adresse e-mail : l'ajouter dans Profil")
    try:
        cfg = system.mail_trial(core.CFG, body.host, body.port, body.security, body.user, body.password, body.sender, body.page_url) if body and body.host else core.CFG
    except ValueError as e:
        return deny(400, str(e))
    try:
        mailer.send(cfg, to, "MyServices : e-mail de test",
                    f"Bonjour,\n\nL'envoi d'e-mails de MyServices fonctionne.\nAdresse de la page : {cfg.get('page_url')}\n\n-- MyServices\n")
    except mailer.MailError as e:
        return deny(502, str(e))
    store().audit("e-mail de test envoyé", request.state.user["username"], ip_of(request), to)
    return {"ok": True, "message": f"e-mail de test envoyé à {to}"}


@router.post(API + "/me/password", tags=["comptes"], summary="Changer son mot de passe")
def change_password(body: PasswordChange, request: Request):
    u, ip = request.state.user or {}, ip_of(request)
    if not common.AUTH or not u:
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
