"""API routes: services."""
from __future__ import annotations

import ipaddress
import threading
import json
import time
from typing import Literal
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from msv.api import server as core
from msv.core import models
from msv.core.auth import db_path
from msv.api.common import API, BackupsOut, HealthOut, PNG, admin_only, admin_write, app, deny, ip_of, read_produced, session_admin, store, typed
from msv.api.routes.machines import network_stats
from msv.api.routes.history import events
from msv.api.routes.accounts import setup

router = APIRouter()

class ServiceKeys(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=500)


@router.get(API + "/services/new", tags=["services"], summary="Services apparus sur les machines ces 7 derniers jours, pas encore choisis (admin)")
def services_new(request: Request):
    from msv.core import history
    from msv.machines import new_services
    if denied := admin_only(request):
        return denied
    events = history.query(db_path(core.CFG), since=time.time() - new_services.WINDOW_DAYS * 86400, kind="nouveau", limit=5000)
    return {"items": new_services.pending(read_produced("data.json") or {}, events, core.CFG["state_dir"], _connector_endpoints())}


def _connector_endpoints() -> list[tuple[dict, tuple[str, ...]]]:
    """The set connectors with the Docker images of their type: what they read is not a « new service » to decide on."""
    import connectors
    try:
        return [(c, getattr(connectors.TYPES.get(c.get("type", "")), "images", ())) for c in connectors.declared(core.CFG)]
    except connectors.ConnectorError:
        return []


@router.post(API + "/services/new/follow", tags=["services"], summary="Suivre ces nouveaux services tels quels : plus proposés (admin)")
def services_new_follow(body: ServiceKeys, request: Request):
    from msv.machines import new_services
    if denied := admin_write(request):
        return denied
    new_services.follow(body.keys, core.CFG["state_dir"])
    store().audit("services suivis", request.state.user["username"], ip_of(request), ", ".join(body.keys)[:500])
    return {"ok": True}


class ManualService(BaseModel):
    name: str = Field(max_length=80)
    ip: str = Field(max_length=45)
    port: int = Field(ge=1, le=65535)
    scheme: str = "http"   # http, https, or tcp (a port without a web page)


class ManualServiceChange(BaseModel):
    name: str | None = Field(None, max_length=80)
    scheme: str | None = None
    port: int | None = Field(None, ge=1, le=65535)


class ManualServiceTry(BaseModel):
    ip: str = Field(max_length=45)
    port: int = Field(ge=1, le=65535)
    scheme: str = "http"


def manual_call(request: Request, action: str, detail: str, fn, collect: bool = True):
    """A change of the services declared by hand: admin only, readable refusal, audit line, then a collection so the page shows it"""
    from msv.machines import services_admin
    if denied := admin_write(request):
        return denied
    try:
        out = fn(services_admin)
    except services_admin.ServiceError as e:
        return deny(400, str(e))
    if action:
        store().audit(action, request.state.user["username"], ip_of(request), detail)
    if collect:
        core.run_chain(["collect"], "Services → déclaré à la main")
    return out


@router.get(API + "/services/manual", tags=["services"], summary="Services déclarés à la main (admin)")
def services_manual_list(request: Request):
    from msv.machines import services_admin
    if denied := admin_only(request):
        return denied
    return {"items": services_admin.list_manual()}


@router.post(API + "/services/manual", tags=["services"], summary="Déclarer un service à la main : nom, IP, port, protocole ; sondé à chaque relevé (admin)")
def services_manual_add(body: ManualService, request: Request):
    return manual_call(request, "service déclaré", f"{body.name} {body.ip}:{body.port}", lambda s: {"ok": True, "item": s.add(body.name, body.ip, body.port, body.scheme)})


@router.put(API + "/services/manual/{ip}/{port}", tags=["services"], summary="Modifier un service déclaré à la main (admin)")
def services_manual_update(ip: str, port: int, body: ManualServiceChange, request: Request):
    return manual_call(request, "service déclaré modifié", f"{ip}:{port}", lambda s: {"ok": True, "item": s.update(ip, port, body.name, body.scheme, body.port)})


@router.delete(API + "/services/manual/{ip}/{port}", tags=["services"], summary="Retirer un service déclaré à la main (admin)")
def services_manual_remove(ip: str, port: int, request: Request):
    def go(s):
        s.remove(ip, port)
        return {"ok": True}
    return manual_call(request, "service déclaré retiré", f"{ip}:{port}", go)


@router.post(API + "/services/manual/try", tags=["services"], summary="Essayer un service (connexion TCP, page web) sans rien enregistrer (admin)")
def services_manual_try(body: ManualServiceTry, request: Request):
    return manual_call(request, "", "", lambda s: s.try_service(body.ip, body.port, body.scheme), collect=False)


@router.post(API + "/services/new/ignore", tags=["services"], summary="Ne pas suivre un nouveau service : mis en pause, ni sonde ni alerte (admin)")
def services_new_ignore(body: ServiceKeys, request: Request):
    from msv.machines import new_services
    from msv.machines import setup
    if denied := admin_write(request):
        return denied
    data, done = read_produced("data.json") or {}, []
    for k in body.keys:
        try:
            done.append(new_services.ignore(k, data, setup.META, core.WEB, core.CFG["state_dir"]))
        except LookupError as e:
            return deny(404, str(e))
    store().audit("services non suivis", request.state.user["username"], ip_of(request), ", ".join(done)[:500])
    return {"ok": True, "paused": done}


class ServiceMeta(BaseModel):
    type: str = Field(max_length=20)
    id: str = Field(max_length=120)
    category: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    tags: list[str] = Field(default_factory=list, max_length=12)
    web: Literal["ui", "api", "none"] | None = None
    public: bool = False
    direct_ok: bool = False
    pause: bool = False
    name: str | None = Field(default=None, max_length=80)
    icon: str | None = Field(default=None, max_length=40, pattern=r"^[a-z0-9-]+$")
    app: str | None = Field(default=None, max_length=60)
    open_url: str | None = Field(default=None, max_length=300)
    alerts: Literal["down", "none"] | None = None


@router.get(API + "/services/meta", tags=["services"], summary="Réglages à la main d'un service (son entrée de services-meta.json) et les catégories qu'on peut lui donner (admin)")
def services_meta_read(type: str, id: str, request: Request):
    from msv.machines import new_services
    from msv.machines import setup
    if denied := admin_only(request):
        return denied
    data = read_produced("data.json") or {}
    row = next((r for r in data.get("hosts") or [] if (r.get("type"), str(r.get("id"))) == (type, id)), None)
    if not row:
        return deny(404, "service introuvable (déjà disparu ?)")
    key, entry = new_services.current_entry(setup.META, row)
    from msv.machines import known_apps
    return {"key": key, "entry": {k: v for k, v in entry.items() if k in new_services.EDITABLE}, "categories": new_services.categories(setup.META, data),
            "apps": known_apps.choices()}


@router.put(API + "/services/meta", tags=["services"], summary="Modifier les réglages d'un service : nom, icône, catégorie, description, étiquettes, appli, interface, adresse à ouvrir, public, accès direct, pause, alertes (admin)")
def services_meta_edit(body: ServiceMeta, request: Request):
    from msv.machines import new_services
    from msv.machines import setup
    if denied := admin_write(request):
        return denied
    data = read_produced("data.json") or {}
    row = next((r for r in data.get("hosts") or [] if (r.get("type"), str(r.get("id"))) == (body.type, body.id)), None)
    if not row:
        return deny(404, "service introuvable (déjà disparu ?)")
    if body.category and body.category not in new_services.categories(setup.META, data):
        return deny(400, "catégorie inconnue : choisir parmi les catégories existantes")
    from msv.machines import known_apps
    if body.app and body.app not in {a["key"] for a in known_apps.choices()}:
        return deny(400, "appli inconnue : choisir dans la liste")
    open_url = (body.open_url or "").strip()
    if open_url and (not open_url.startswith(("http://", "https://")) or any(c.isspace() for c in open_url)):
        return deny(400, "adresse à ouvrir : commencer par http:// ou https://")
    tags = [t.strip()[:30] for t in body.tags if t.strip()]
    fields = {"category": body.category, "description": (body.description or "").strip(), "tags": tags, "web": body.web,
              "public": body.public, "direct_ok": body.direct_ok, "pause": body.pause, "name": (body.name or "").strip(), "icon": body.icon,
              "app": body.app, "open_url": open_url, "alerts": body.alerts}
    try:
        key = new_services.edit_meta(setup.META, core.WEB, row, fields)
    except LookupError as e:
        return deny(400, str(e))
    store().audit("service modifié", request.state.user["username"], ip_of(request), key)
    return {"ok": True, "key": key}


def _stream_camera_known(connector: str, name: str, camera: str) -> bool:
    """The camera (or stream) was seen at the last collection, on a connector that offers pictures."""
    data = read_produced("data.json") or {}
    status = next((c for c in data.get("services_status") or [] if c.get("connector") == connector and c.get("name") == name), None)
    block = (status or {}).get("stream") or {}
    known = {c.get("name") for c in block.get("cameras") or []} | {x.get("name") for x in block.get("streams") or []}
    return bool(block.get("snapshot")) and camera in known


def _camera_picture(connector: str, name: str, camera: str) -> bytes | JSONResponse:
    """The picture asked from the connector, or the refusal to send back."""
    import connectors
    try:
        inst = next((c for c in connectors.instances(core.CFG, kind="status") if c.type == connector and c.name == name), None)
        if inst is None or not hasattr(inst, "snapshot"):
            return deny(404, "connecteur introuvable")
        return inst.snapshot(camera)
    except connectors.ConnectorError as e:
        return deny(502, str(e))


@router.get(API + "/stream/snapshot", tags=["services"], summary="Image du moment d'une caméra, lue à la demande et jamais gardée (tout utilisateur connecté)")
def stream_snapshot(connector: str, name: str, camera: str, request: Request):
    if not _stream_camera_known(connector, name, camera):
        return deny(404, "caméra inconnue (pas vue à la dernière collecte)")
    img = _camera_picture(connector, name, camera)
    if isinstance(img, Response):
        return img
    if img[:3] != b"\xff\xd8\xff" and img[:8] != b"\x89PNG\r\n\x1a\n":   # JPEG or PNG only
        return deny(502, "la réponse n'est pas une image")
    return Response(img, media_type=PNG if img[:4] == b"\x89PNG" else "image/jpeg", headers={"Cache-Control": "no-store"})   # not audited: the page asks one per tile


@router.get(API + "/domotique/curves", tags=["services"], summary="Courbes 24 h d'un capteur de la maison, lues à la demande (tout utilisateur connecté)")
def domotique_curves(connector: str, name: str, module: str):
    import connectors
    status = next((c for c in (read_produced("data.json") or {}).get("services_status") or [] if c.get("connector") == connector and c.get("instance") == name), None) or {}
    known = [*(status.get("modules") or []), *(status.get("netatmo") or {}).get("modules", []), *(status.get("home") or {}).get("modules", [])]
    m = next((x for x in known if x.get("id") == module), None)
    if m is None:
        return deny(404, "appareil inconnu (pas vu à la dernière collecte)")
    inst = next((c for c in connectors.instances(core.CFG, kind="status") if c.type == connector and c.name == name and hasattr(c, "curves")), None)
    if inst is None:
        return deny(404, "connecteur introuvable")
    try:
        return {"series": inst.curves(m)}
    except connectors.ConnectorError as e:
        return deny(502, str(e))


LIVE_MAX_S = 300        # a live feed stops by itself after this long: nothing keeps a camera open
LIVE_MAX_OPEN = 4       # feeds relayed at the same time, all users together
_live_open = 0
_live_lock = threading.Lock()


def _live_feed(upstream, user: str, ip: str, label: str):
    """Relays the camera's MJPEG feed chunk by chunk until the time limit, the end of the feed or the client leaving; always closes the source."""
    global _live_open
    t0 = time.monotonic()
    try:
        while time.monotonic() - t0 < LIVE_MAX_S:
            chunk = upstream.read(16384)
            if not chunk:
                break
            yield chunk
    finally:
        upstream.close()
        with _live_lock:
            _live_open -= 1
        store().audit("flux de caméra arrêté", user, ip, f"{label} · {round(time.monotonic() - t0)} s")


@router.get(API + "/stream/live", tags=["services"], summary="Flux vidéo en direct d'une caméra (MJPEG), relayé 5 minutes au plus, sur clic (tout utilisateur connecté)")
def stream_live(connector: str, name: str, camera: str, request: Request):
    global _live_open
    import connectors
    if not _stream_camera_known(connector, name, camera):
        return deny(404, "caméra inconnue (pas vue à la dernière collecte)")
    inst = next((c for c in connectors.instances(core.CFG, kind="status") if c.type == connector and c.name == name), None)
    if inst is None or not hasattr(inst, "mjpeg"):
        return deny(404, "ce connecteur n'offre pas de flux en direct")
    with _live_lock:
        if _live_open >= LIVE_MAX_OPEN:
            return deny(429, f"déjà {LIVE_MAX_OPEN} flux ouverts : fermez-en un")
        _live_open += 1
    try:
        upstream = inst.mjpeg(camera)
    except connectors.ConnectorError as e:
        with _live_lock:
            _live_open -= 1
        return deny(502, str(e))
    label = f"{name} · {camera}"[:200]
    store().audit("flux de caméra ouvert", request.state.user["username"], ip_of(request), label)
    return StreamingResponse(_live_feed(upstream, request.state.user["username"], ip_of(request), label),
                             media_type=upstream.headers.get("Content-Type") or "multipart/x-mixed-replace", headers={"Cache-Control": "no-store"})


class ServicePublic(BaseModel):
    domain: str = Field(max_length=253)
    public: bool = True


@router.put(API + "/services/public", tags=["services"], summary="Déclarer un site public voulu (hôte NPM sans liste d'accès), ou retirer la déclaration (admin)")
def services_public(body: ServicePublic, request: Request):
    from msv.machines import new_services
    from msv.machines import setup
    if denied := admin_write(request):
        return denied
    data = read_produced("data.json") or {}
    if not any(body.domain in (r.get("domains") or []) for r in data.get("hosts") or [] if r.get("type") == "proxy"):
        return deny(404, "aucun hôte NPM ne porte ce domaine")
    new_services.set_public(setup.META, core.WEB, body.domain, body.public)
    store().audit("site déclaré public" if body.public else "site public retiré", request.state.user["username"], ip_of(request), body.domain)
    return {"ok": True}


@router.delete(API + "/services/pause/{target}", tags=["services"], summary="Reprendre le suivi d'un service en pause (ip:port) (admin)")
def services_resume(target: str, request: Request):
    from msv.machines import new_services
    from msv.machines import setup
    if denied := admin_write(request):
        return denied
    ip, _, port = target.rpartition(":")
    try:
        ipaddress.ip_address(ip)
        if not 0 < int(port) < 65536:
            raise ValueError
    except ValueError:
        return deny(400, "ip:port attendu")
    new_services.set_pause(setup.META, core.WEB, f"{ip}:{int(port)}", None)
    store().audit("suivi repris", request.state.user["username"], ip_of(request), target)
    return {"ok": True}


@router.get(API + "/health", tags=["modèle"], summary="Santé des machines et niveau global (modèle commun)", response_model=HealthOut)
def health_v1():
    d = read_produced("health/stats.json") or {}
    items, skipped = typed(models.Health, d.get("hosts"))
    level = d.get("overall_level")
    return HealthOut(generated=d.get("timestamp"), overall=level if level in ("ok", "warn", "crit", "down", "na") else None,
                     hosts=items, skipped=skipped)


@router.get(API + "/backups", tags=["modèle"], summary="Jeux de sauvegarde et leurs emplacements (modèle commun)",
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
    collect: bool = True  # False: save only (service down, set up ahead), collection off and no test


def last_statuses() -> list[dict]:
    """Connector states of the last collection; an instance saved (or switched on) since then is marked « pending »: the page says it is
    being read again instead of showing the error of the old settings."""
    try:
        data = json.loads((core.WEB / "data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    try:
        at = datetime.fromisoformat(str(data.get("generated"))).timestamp()
    except ValueError:
        at = 0
    saved = {k: v for k, v in _saved().items() if v > at}
    rows = list(data.get("connectors", []))
    from msv.collect import fast
    rows += fast.statuses_missing(fast.read(core.WEB / "live.json"), {(st.get("type"), st.get("name")) for st in rows})   # read lightly, never by the collection
    tests = _tests()
    rows = [_with_test(st, tests.get(f"{st.get('type')}/{st.get('name')}"), at) for st in rows]
    return [{**st, "pending": True} if f"{st.get('type')}/{st.get('name')}" in saved else st for st in rows]


def _tests_file() -> Path:
    return Path(core.CFG["state_dir"]) / "connectors-tests.json"


def _tests() -> dict[str, dict]:
    try:
        got = json.loads(_tests_file().read_text(encoding="utf-8"))
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def _with_test(st: dict, test: dict | None, generated: float) -> dict:
    """A test made from the page, newer than the last collection (or on a connector the collection never reads), is the freshest state."""
    if not test or (test["at"] <= generated and st.get("version")):
        return st
    return {**st, "ok": test["ok"], "message": test["message"], "stale": False, "version": test.get("version") or st.get("version"),
            "version_tested": test.get("version_tested"), "found": test.get("found") or st.get("found") or []}


def remember_test(type_: str, name: str, out: dict) -> None:
    """Keep the answer of a test made from the page: the card shows it at once, the next collection takes over."""
    keep = {k: out.get(k) for k in ("ok", "message", "version", "version_tested", "found")}
    marks = {k: v for k, v in _tests().items() if time.time() - v["at"] < 7 * 86400}
    marks[f"{type_}/{name}"] = {**keep, "at": time.time()}
    try:
        f = _tests_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(marks), encoding="utf-8")
        tmp.replace(f)
    except OSError:
        pass   # a convenience: the card then waits for the collection, as before


def _saved_file() -> Path:
    return Path(core.CFG["state_dir"]) / "connectors-saved.json"


def _saved() -> dict[str, float]:
    try:
        got = json.loads(_saved_file().read_text(encoding="utf-8"))
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def reread_connector(type_: str, name: str, why: str) -> None:
    """Settings changed: remember when (see last_statuses) and run the collection now rather than at its next hour."""
    marks = {k: v for k, v in _saved().items() if time.time() - v < 86400}
    marks[f"{type_}/{name}"] = time.time()
    try:
        f = _saved_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(marks), encoding="utf-8")
        tmp.replace(f)
    except OSError:
        pass   # no mark: the page shows the old state until the collection, as before
    if core.enabled("collect"):
        core.run_chain(["collect"], why)


@router.get(API + "/connectors/settings", tags=["connecteurs"], summary="Connecteurs réglables : types, champs, instances (admin)")
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
    # Read over SSH without a connector (Proxmox by pvesh, ESXi, KVM, Incus, VirtualBox): listed with the others, nothing to add for them
    virt = [{"type": v.get("connector"), "name": v.get("name"), "label": v.get("label"), "ok": v.get("ok"), "stale": v.get("stale"),
             "message": v.get("message"), "version": v.get("version"), "ip": v.get("ip"), "via": "ssh"}
            for v in (read_produced("data.json") or {}).get("virtualization") or [] if v.get("via") == "ssh"]
    return {"types": settings.schema(), "instances": items,
            "others": [s for s in statuses if (s.get("type"), s.get("name")) not in shown] + virt}


def connector_call(request: Request, action: str, detail: str, fn) -> JSONResponse | dict:
    from connectors import settings
    if denied := admin_write(request):
        return denied
    try:
        out = fn(settings)
    except settings.SettingsError as e:
        return deny(400, str(e))
    settings_applied()
    if action:
        store().audit(action, request.state.user["username"], ip_of(request), detail)
    return out if isinstance(out, dict) else {"ok": True, "message": "enregistré : pris en compte au prochain passage de la collecte"}


def settings_applied() -> None:
    """A connector saved, turned on or off, or removed: the running configuration is read again in place (the readers, the health check
    and the pages see the change without a restart) and the readings cached from the former set of connectors go."""
    from msv.collect import network_stats
    from msv.collect import system
    from msv.collect import unifi_cards as uc
    system.reload_config(core)
    uc.reset()
    network_stats.reset()


@router.put(API + "/connectors/settings/{type_}", tags=["connecteurs"], summary="Ajouter ou modifier une instance (admin ; secret vide = gardé)")
def connector_save(type_: str, body: ConnectorConf, request: Request):
    from connectors import settings
    out = connector_call(request, "connecteur enregistré", f"{type_} {body.name}",
                         lambda s: s.save(type_, body.name, body.config, body.original))
    if not (isinstance(out, dict) and out.get("ok")) or body.name not in settings.names(type_):
        return out   # refused, or saved while switched off: nothing to read
    if not body.collect:
        settings.set_enabled(type_, body.name, False)
        return {"ok": True, "enabled": False, "message": "enregistré sans collecte : l'allumer quand le service répond (un test passe d'abord)"}
    ok, _ = settings.check_saved(type_, body.name)
    if not ok:   # never collect untested settings: saved, but the collection stays off until a test passes
        settings.set_enabled(type_, body.name, False)
        store().audit("connecteur coupé", request.state.user["username"], ip_of(request), f"{type_} {body.name} : test en échec")
        # the reason is shown by the page through the test route: no error text in this answer
        return {"ok": True, "enabled": False, "failed": True, "message": "enregistré, collecte coupée : le test a échoué"}
    reread_connector(type_, body.name, f"connecteur {type_} « {body.name} » enregistré")
    return {**out, "enabled": True, "message": "enregistré : relecture lancée, l'état se met à jour dans une minute"}


class Reveal(BaseModel):
    field: str = Field(max_length=64)
    password: str = Field(max_length=256)


@router.post(API + "/connectors/settings/{type_}/{name}/reveal", tags=["connecteurs"],
          summary="Afficher un secret enregistré (session admin + mot de passe, noté dans le journal d'audit)")
def connector_reveal(type_: str, name: str, body: Reveal, request: Request):
    from connectors import settings
    if denied := session_admin(request):
        return denied
    u, ip = request.state.user, ip_of(request)
    if store().too_many_failures(ip):
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    if store().verify(u["username"], body.password, ip) is None:
        return deny(403, "mot de passe incorrect")   # pas 401 : la page renverrait vers la connexion
    try:
        value = settings.reveal(type_, name, body.field)
    except settings.SettingsError as e:
        return deny(400, str(e))
    store().audit("secret affiché", u["username"], ip, f"{type_} {name} : {body.field}")
    return JSONResponse({"value": value}, headers={"Cache-Control": "no-store"})


class Toggle(BaseModel):
    enabled: bool
    force: bool = False   # turn the collection on without the test first (the source may simply be slow or down at that moment)


@router.patch(API + "/connectors/settings/{type_}/{name}", tags=["connecteurs"], summary="Allumer ou couper un connecteur (admin)")
def connector_toggle(type_: str, name: str, body: Toggle, request: Request):
    from connectors import settings
    if body.enabled and not body.force and not admin_write(request) and type_ in settings.TYPES:
        try:
            ok, msg = settings.check_saved(type_, name)
        except settings.SettingsError as e:
            return deny(400, str(e))
        if not ok:   # never collect untested settings
            return deny(409, f"collecte non allumée : le test a échoué ({msg}). Vous pouvez la rallumer quand même.")
    out = connector_call(request, "connecteur allumé" if body.enabled else "connecteur coupé", f"{type_} {name}",
                         lambda s: s.set_enabled(type_, name, body.enabled))
    if body.enabled and isinstance(out, dict) and out.get("ok"):
        reread_connector(type_, name, f"connecteur {type_} « {name} » rallumé")
    return out


@router.delete(API + "/connectors/settings/{type_}/{name}", tags=["connecteurs"], summary="Supprimer une instance (admin)")
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


@router.post(API + "/connectors/settings/npm/script/check", tags=["connecteurs"], summary="Vérifier le chemin de npm-api.sh sur une machine, sans rien lancer (admin)")
def npm_script_check(body: NpmScriptCheck, request: Request):
    return connector_call(request, "", "", lambda s: s.npm_script_check(body.api, body.ssh))


@router.post(API + "/connectors/settings/npm/script/install", tags=["connecteurs"],
          summary="Installer npm-api.sh (version figée, empreinte vérifiée) sur une machine par SSH (admin)")
def npm_script_install(body: NpmScriptInstall, request: Request):
    if (request.state.user or {}).get("token"):  # écrit sur une machine : session d'administrateur seulement, jamais un jeton d'API
        return deny(403, "installation sur une machine : session requise")
    return connector_call(request, "npm-api.sh installé", f"{body.ssh} : {body.directory}",
                          lambda s: s.npm_script_install(body.ssh, body.directory, body.ip, body.port, body.user, body.password))


@router.post(API + "/connectors/settings/{type_}/test", tags=["connecteurs"], summary="Essayer des réglages sans les enregistrer (admin)")
def connector_test(type_: str, body: ConnectorConf, request: Request):
    from connectors import settings
    out = connector_call(request, "", "", lambda s: s.test(type_, body.name, body.config, body.original))
    if isinstance(out, dict) and "ok" in out and body.name in settings.names(type_):
        remember_test(type_, body.name, out)   # only a saved instance: a form being filled in has no card yet
    return out
