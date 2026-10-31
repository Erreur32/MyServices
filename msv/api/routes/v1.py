"""API routes: v1."""
from __future__ import annotations

import json
import time
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from msv.api import server as core
from msv.core import models
from msv.api.common import API, find, read_produced, refresh_from, typed
from msv.api.routes.page import files

router = APIRouter()

@router.get(API + "/status", tags=["passages"], summary="État du collecteur (passage en cours, délai avant le suivant)")
def status_v1():
    return JSONResponse(core.status(), headers={"Cache-Control": "no-store"})


@router.post(API + "/refresh", tags=["passages"], summary="Demander un passage du collecteur",
          responses={202: {"description": "passage lancé"}, 409: {"description": "déjà en cours"},
                     429: {"description": "trop tôt (délai entre deux passages)"}})
def refresh_v1(request: Request):
    return refresh_from(request)


def stream_sources() -> dict:
    """What the event stream watches: the collector's state, the tasks, the stamps of the produced files."""
    return {"status": core.status, "tasks": tasks_v1, "manifest": lambda: produced_manifest()["files"]}


@router.get(API + "/stream", tags=["passages"], summary="Flux d'événements (SSE) : status, tasks, manifest, dès qu'ils changent")
def stream_v1():
    from msv.core import live_events
    q = live_events.subscribe()
    first = {k: fn() for k, fn in stream_sources().items()}
    # Content-Encoding set: the gzip middleware leaves the stream alone (it would buffer the events)
    return StreamingResponse(live_events.stream(q, first), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "Content-Encoding": "identity", "X-Accel-Buffering": "no"})


@router.get(API + "/tasks", tags=["passages"], summary="Tâches planifiées : horaires, dernier passage, résultat")
def tasks_v1():
    from msv.collect import system
    return {name: {"script": t["script"], "label": system.LABELS.get(name, name), "at": t["at"], "next": core.next_run(name),
                   "minutes": sorted(t["minutes"]),
                   "hours": None if t["hours"] is None else sorted(t["hours"]), "enabled": core.enabled(name),
                   "running": t["proc"] is not None, "started": t["start"], "ended": t["end"], "result": t["result"]}
            for name, t in core.TASKS.items()} | {"netscan": core.netscan_task()}


@router.get(API + "/connectors", tags=["connecteurs"], summary="État des connecteurs au dernier passage")
def connectors_v1():
    try:
        data = json.loads((core.WEB / "data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"generated": None, "connectors": []}
    return {"generated": data.get("generated"), "connectors": data.get("connectors", [])}


class MachinesOut(BaseModel):
    generated: str | None = None
    machines: list[models.Machine] = []
    skipped: int = 0


class ServicesOut(BaseModel):
    generated: str | None = None
    services: list[models.Service] = []
    skipped: int = 0


def produced_manifest() -> dict:
    """Stamp (mtime and size) of every produced file the page reads: the page asks this small document every few seconds and reads a
    file again only when its stamp moved, instead of revalidating each of them. A file served from elsewhere (health_url or
    backups_url as a full URL) is not listed: the page keeps its own pace for it."""
    hu, bu = str(core.CFG.get("health_url") or ""), str(core.CFG.get("backups_url") or "")
    rels = ["data.json", "pulse.json", "ports.json", "live.json", "events.json"]
    if hu and "://" not in hu:
        rels += [hu + "stats.json", hu + "events.json"]
    if bu and "://" not in bu:
        rels.append(bu)
    files = {}
    for rel in rels:
        f = find(rel.lstrip("/"))
        if f is not None:
            try:
                st = f.stat()
                files[rel] = f"{st.st_mtime_ns}-{st.st_size}"
            except OSError:
                pass
    return {"ts": time.time(), "files": files}


@router.get(API + "/manifest", tags=["page"], summary="Horodatage des fichiers produits (data.json, pouls, direct, événements, santé, sauvegardes)")
def manifest(request: Request):
    return JSONResponse(produced_manifest(), headers={"Cache-Control": "no-store"})


@router.get(API + "/machines", tags=["modèle"], summary="Machines du réseau (modèle commun)", response_model=MachinesOut)
def machines_v1():
    d = read_produced("data.json") or {}
    items, skipped = typed(models.Machine, d.get("machine_list"))
    return MachinesOut(generated=d.get("generated"), machines=items, skipped=skipped)


@router.get(API + "/services", tags=["modèle"], summary="Services exposés (modèle commun), filtrables par machine et par type",
         response_model=ServicesOut)
def services_v1(machine: str | None = None, type: Literal["proxy", "redirect", "dead", "stream", "local"] | None = None):
    d = read_produced("data.json") or {}
    items, skipped = typed(models.Service, d.get("hosts"))
    if machine:
        items = [s for s in items if (s.machine or "").casefold() == machine.casefold() or s.ip == machine]
    if type:
        items = [s for s in items if s.type == type]
    return ServicesOut(generated=d.get("generated"), services=items, skipped=skipped)
