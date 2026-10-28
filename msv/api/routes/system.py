"""API routes: system."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from msv.api import common
from msv.api import server as core
from msv.api.common import API, admin_only, admin_write, deny, ip_of, store

router = APIRouter()

@router.get(API + "/system", tags=["système"], summary="Clé SSH de l'app, tâches et horaires, informations (admin)")
def system_state(request: Request):
    from msv.collect import system
    if denied := admin_only(request):
        return denied
    from connectors.process import host_docker
    return {"ssh": system.ssh_key(core), "tasks": system.tasks(core), "info": system.info(core, common),
            "netscan": core.netscan_task(), "scheduler": {"beat": core.SCHED_BEAT["ts"]}, "host_docker": host_docker()}


class Schedule(BaseModel):
    at: str | None = Field(None, max_length=120)


@router.put(API + "/system/tasks/{name}/schedule", tags=["système"], summary="Changer l'horaire d'une tâche (vide = défaut) (admin)")
def system_schedule(name: str, body: Schedule, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_schedule(core, name, body.at)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("horaire changé", request.state.user["username"], ip_of(request), f"{name} : {out['at']}")
    return {"ok": True, **out}
