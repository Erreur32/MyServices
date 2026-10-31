"""API routes: alerts."""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Literal
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from msv.api import server as core
from msv.diagram.diagram_nav import ARCHIFY_URL, DIAGRAMS
from msv.api.common import API, PNG, admin_only, admin_write, agents_store, deny, ip_of, store

router = APIRouter()

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
    from msv.alerts import alerts
    if denied := admin_write(request):
        return denied
    try:
        out = fn(core.alerts_store())
    except (alerts.AlertError, ValueError) as e:
        return deny(400, str(e))
    store().audit(action, request.state.user["username"], ip_of(request), detail)
    return {"ok": True, **(out if isinstance(out, dict) else {})}


@router.get(API + "/alerts", tags=["alertes"], summary="Canaux, règles, genres d'événements, préréglages, envois (admin)")
def alerts_state(request: Request):
    from msv.alerts import alerts
    if denied := admin_only(request):
        return denied
    a = core.alerts_store()
    return {"channels": a.channels(), "rules": a.rules(), "sent": a.sent(), "active": a.active(),
            "kinds": [{"id": k, "label": v[0], "group": v[1]} for k, v in alerts.KINDS.items()],
            "groups": alerts.GROUPS, "presets": alerts.PRESETS}


@router.post(API + "/alerts/channels", tags=["alertes"], summary="Ajouter un canal (admin)")
def alerts_channel_add(body: Channel, request: Request):
    return alerts_call(request, "canal d'alerte ajouté", f"{body.name or body.type} ({body.type})",
                       lambda a: {"id": a.add_channel(body.name, body.type, body.config, body.enabled)})


@router.patch(API + "/alerts/channels/{cid}", tags=["alertes"], summary="Modifier un canal (admin ; secret vide = gardé)")
def alerts_channel_update(cid: int, body: ChannelChange, request: Request):
    return alerts_call(request, "canal d'alerte modifié", str(cid), lambda a: a.update_channel(cid, body.name, body.config, body.enabled))


@router.delete(API + "/alerts/channels/{cid}", tags=["alertes"], summary="Supprimer un canal (admin)")
def alerts_channel_delete(cid: int, request: Request):
    return alerts_call(request, "canal d'alerte supprimé", str(cid), lambda a: a.delete_channel(cid))


@router.post(API + "/alerts/channels/{cid}/test", tags=["alertes"], summary="Envoyer un message d'essai (admin)")
def alerts_channel_test(cid: int, request: Request):
    def test(a):
        ok, info = a.test_channel(cid)
        if not ok:
            raise ValueError(info)
        return {"message": info}
    return alerts_call(request, "essai d'alerte", str(cid), test)


@router.post(API + "/alerts/rules", tags=["alertes"], summary="Ajouter une règle (admin)")
def alerts_rule_add(body: Rule, request: Request):
    return alerts_call(request, "règle d'alerte ajoutée", body.name or "",
                       lambda a: {"id": a.add_rule(body.model_dump(exclude_none=True))})


@router.patch(API + "/alerts/rules/{rid}", tags=["alertes"], summary="Modifier une règle (admin)")
def alerts_rule_update(rid: int, body: Rule, request: Request):
    return alerts_call(request, "règle d'alerte modifiée", str(rid), lambda a: a.update_rule(rid, body.model_dump(exclude_none=True)))


@router.delete(API + "/alerts/rules/{rid}", tags=["alertes"], summary="Supprimer une règle (admin)")
def alerts_rule_delete(rid: int, request: Request):
    return alerts_call(request, "règle d'alerte supprimée", str(rid), lambda a: a.delete_rule(rid))


@router.post(API + "/alerts/presets", tags=["alertes"], summary="Ajouter des préréglages, désactivés (admin)")
def alerts_presets(body: Presets, request: Request):
    return alerts_call(request, "préréglages d'alerte ajoutés", ", ".join(body.names)[:200],
                       lambda a: {"added": a.add_presets(body.names)})


def about_payload(force: bool) -> dict:
    from msv.core import about
    version = os.environ.get("MYSERVICES_VERSION", "dev")
    got = about.latest(Path(core.CFG["state_dir"]), force=force, enabled=bool(core.CFG.get("update_check", True)), current=version)
    tag = (got.get("release") or {}).get("tag")
    return {"version": version, "latest": got.get("release"), "checked_at": got.get("checked_at"), "error": got.get("error"), "enabled": got.get("enabled", True),
            "update_available": about.newer(tag, version), "running": about.core_version(version),
            "released": about.released(about.changelog(Path(core.HERE) / "CHANGELOG.md")),
            "changelog": about.changelog(Path(core.HERE) / "CHANGELOG.md"), "repo": f"https://github.com/{about.REPO}"}


@router.get(API + "/about", tags=["système"], summary="Version installée, dernière version publiée, journal des changements")
def about_info(request: Request):
    return about_payload(False)


@router.post(API + "/about/check", tags=["système"], summary="Vérifier maintenant la dernière version publiée (admin)")
def about_check(request: Request):
    if denied := admin_write(request):
        return denied
    return about_payload(True)


class UpdateSettings(BaseModel):
    auto: bool | None = None


@router.put(API + "/about/settings", tags=["système"], summary="Vérification automatique des mises à jour (admin)")
def about_settings(body: UpdateSettings, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    out = system.set_update_settings(core, auto=body.auto)
    store().audit("réglages des mises à jour", request.state.user["username"], ip_of(request), json.dumps(out))
    return out


@router.get(API + "/diagrams", tags=["schémas"], summary="Schémas de l'infra (Archify) : titre, fichier, date ; ceux à créer d'un clic")
def diagrams(request: Request):
    from msv.diagram import archify_extra
    from msv.diagram.diagram_nav import optional
    data = None
    try:
        data = json.loads((core.WEB / core.DATA_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    asked = set(core.CFG.get("diagrams_extra") or [])
    out = []
    for key, title, what, needs in [*DIAGRAMS, *optional()]:
        f = core.WEB / f"{key}.html"
        opt = key in archify_extra.CATALOG
        out.append({"id": key, "title": title, "what": what, "file": f"{key}.html", "exists": f.exists(), "updated": f.stat().st_mtime if f.exists() else None,
                    "bytes": f.stat().st_size if f.exists() else 0, "needs": needs, "optional": opt, "enabled": key in asked,
                    "available": archify_extra.available(key, data) if opt else needs != "backups" or bool(core.CFG.get("backups_url"))})
    return {"diagrams": out, "archify": bool(core.ARCHIFY and Path(core.ARCHIFY).exists()), "archify_url": ARCHIFY_URL,
            "build": {"running": core.MAP_STATE["running"], "started": core.MAP_STATE["started"], "last_seconds": core.MAP_STATE["last_seconds"],
                      "next_run": core.next_run("collect")}}


class DiagramAsk(BaseModel):
    enabled: bool


@router.put(API + "/diagrams/{key}", tags=["schémas"], summary="Créer (ou retirer) un schéma proposé : réseau, services, domaines, virtualisation (admin)")
def diagram_set(key: str, body: DiagramAsk, request: Request):
    from msv.diagram import archify_extra
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    if key not in archify_extra.CATALOG:
        return deny(404, "schéma inconnu")
    if body.enabled and not (core.ARCHIFY and Path(core.ARCHIFY).exists()):
        return deny(409, "Archify n'est pas installé dans cette image")
    try:
        data = json.loads((core.WEB / core.DATA_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = None
    if body.enabled and not archify_extra.available(key, data):
        return deny(409, "rien à montrer pour l'instant : " + archify_extra.CATALOG[key][1])
    system.set_diagram_extra(core, key, body.enabled)
    threading.Thread(target=core.build_map, daemon=True, name="diagrams").start()
    store().audit("schéma " + ("créé" if body.enabled else "retiré"), request.state.user["username"], ip_of(request), key)
    return {"ok": True}


@router.post(API + "/diagrams/rebuild", tags=["schémas"], summary="Regénérer les schémas maintenant (admin ; refusé si une génération est déjà en cours)")
def diagrams_rebuild(request: Request):
    if denied := admin_write(request):
        return denied
    if not (core.ARCHIFY and Path(core.ARCHIFY).exists()):
        return deny(409, "Archify n'est pas installé dans cette image")
    if core.MAP_STATE["running"]:
        return deny(409, "une génération est déjà en cours")
    threading.Thread(target=core.build_map, daemon=True, name="diagrams").start()
    store().audit("schémas regénérés", request.state.user["username"], ip_of(request), "")
    return {"ok": True}


def current_proposals(data: dict) -> list[dict]:
    """Proposals of the last collection without the connectors saved since: the discovery list changes at once."""
    from msv.machines import known_apps
    from connectors import settings
    try:
        saved = [c for _, _, c in settings._entries(settings._raw())]
    except settings.SettingsError:
        return data.get("proposals") or []
    return known_apps.still_proposed(data.get("proposals") or [], saved)


def key_refused(data: dict) -> list[dict]:
    """Machines whose SSH key is refused and that nothing else reads: one read by its agent needs no key."""
    machines = data.get("machine_list") or []
    by_agent, names = {m["ip"] for m in machines if m.get("agent")}, {m["ip"]: m["name"] for m in machines}
    return [{"ip": c["ip"], "name": names.get(c["ip"])} for c in data.get("connectors") or []
            if c.get("type") == "docker" and not c.get("ok") and c.get("ip") and c["ip"] not in by_agent]


@router.get(API + "/discoveries", tags=["système"], summary="Qui découvre quoi : automatique, à la main, à faire (admin)")
def discoveries(request: Request):
    from msv.backups import backups_admin
    from msv.machines import discoveries as disc
    from msv.collect import netscan
    if denied := admin_only(request):
        return denied
    state = Path(core.CFG["state_dir"])

    def stamp(name: str, key: str = "at"):
        try:
            return json.loads((state / name).read_text(encoding="utf-8")).get(key)
        except (OSError, ValueError, AttributeError):
            return None
    try:
        data = json.loads((core.WEB / core.DATA_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    col, bk = core.TASKS["collect"], core.TASKS["backups"]
    net = netscan.state(state / "network-scan.json") if (state / "network-scan.json").exists() else {}
    try:
        checked = len(json.loads((state / "backups-auto.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        checked = 0
    ssh = backups_admin._machines()
    last = col["end"] or None
    stale = bool(data.get("generated")) and (time.time() - datetime.fromisoformat(data["generated"]).timestamp()) > 90 * 60
    ignored = {x.get("ip") for x in core.CFG.get("netscan_ignored") or []}
    known = {m["ip"] for m in data.get("machine_list") or []}
    try:
        waiting = [{"ip": a["ip"], "name": a["name"]} for a in agents_store().listing() if a["state"] == "en attente"]
    except Exception:  # noqa: BLE001 : base d'agents absente : rien à rappeler
        waiting = []
    items = disc.build({
        "unknown_hosts": sum(1 for h in net.get("found") or [] if h["ip"] not in known and h["ip"] not in ignored and not h.get("known")),
        "key_refused": key_refused(data),
        "agents_waiting": waiting,
        "collect_last": last, "collect_next": core.next_run("collect"), "collect_ok": not stale,
        "net_has_run": bool(net.get("ended") or net.get("started")), "net_last": net.get("ended") or net.get("started"), "net_every_h": core.CFG["netscan_every"],
        "backups_auto": core.CFG.get("backups_auto", True), "ssh_machines": len(ssh), "auto_checked": sum(1 for ip in ssh if ip in _read_list(state / "backups-auto.json")) if checked else 0,
        "backups_search_last": stamp("backups-discover.json"), "backups_enabled": bool(core.CFG.get("backups_url")),
        "backups_last": bk["end"] or None, "backups_next": core.next_run("backups"), "proposals": current_proposals(data),
        "muted": core.CFG.get("discoveries_muted") or [], "auto_mode": core.CFG["auto_mode"],
    })
    return {"auto": core.CFG["auto_mode"], "items": items, "muted": core.CFG.get("discoveries_muted") or [], "todo": sum(1 for x in items if x["state"] == disc.TODO), "suggest": sum(1 for x in items if x["state"] == disc.SUGGEST)}


@router.get(API + "/ha/{name}/addon-icon/{slug}", tags=["connecteurs"], summary="Icône d'un module complémentaire de Home Assistant (lue avec le jeton, en cache)")
def ha_addon_icon(name: str, slug: str):
    """Home Assistant serves add-on icons only with its token: read here, kept a week in the cache, sent as an image"""
    import re
    import connectors
    if not re.fullmatch(r"[a-z0-9_-]{1,64}", slug):
        return deny(404, "introuvable")
    cache = Path(core.CFG["cache_dir"]).expanduser() / "ha-icons" / f"{slug}.png"
    try:
        if cache.is_file() and time.time() - cache.stat().st_mtime < 7 * 86400:  # NOSONAR S2083: file name = the slug checked above, in the app's cache
            return Response(cache.read_bytes(), media_type=PNG, headers={"Cache-Control": "max-age=86400"})  # NOSONAR S2083: same checked slug
        ha = next((c for c in connectors.instances(core.CFG, kind="status") if c.type == "home-assistant" and c.name == name), None)
        if ha is None:
            return deny(404, "introuvable")
        data = ha.addon_icon(slug)
    except Exception:  # NOSONAR S5754: no icon is not an error, the page shows a generic one  # noqa: BLE001
        return deny(404, "introuvable")
    cache.parent.mkdir(parents=True, exist_ok=True)  # NOSONAR S2083: the app's cache folder
    cache.write_bytes(data)  # NOSONAR S2083: the name is the slug checked above, under the app's cache folder
    return Response(data, media_type=PNG, headers={"Cache-Control": "max-age=86400"})


class MuteBody(BaseModel):
    id: str
    muted: bool = True


@router.put(API + "/discoveries/muted", tags=["découvertes"], summary="Couper ou rétablir le rappel d'une découverte à faire (admin)")
def discovery_mute(body: MuteBody, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_discovery_muted(core, body.id, body.muted)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("rappel de découverte " + ("coupé" if body.muted else "rétabli"), request.state.user["username"], ip_of(request), body.id)
    return {"ok": True, "muted": out}


def _read_list(f: Path) -> list:
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
