"""API routes: backups."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from msv.api import server as core
from msv.core.auth import db_path
from msv.api.common import API, admin_only, admin_write, deny, ip_of, session_admin, store

router = APIRouter()

def backups_call(request: Request, action: str, detail: str, fn, write: bool = True):
    from msv.backups import backups_admin
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


class BackupPatterns(BaseModel):
    patterns: list[str] = Field(max_length=40)
    by_host: dict[str, list[str]] | None = Field(default=None, description="Locations searched on one machine only, {ip: paths}")


@router.get(API + "/backups/settings", tags=["sauvegardes"], summary="Jeux de sauvegarde suivis et état de l'onglet (admin)")
def backups_settings(request: Request):
    return backups_call(request, "", "", lambda b: b.current(), write=False)


@router.post(API + "/backups/discover", tags=["sauvegardes"], summary="Chercher les dossiers de sauvegarde des machines lues par SSH, lecture seule (admin)")
def backups_discover(request: Request):
    def go(b):
        out = b.discover()
        try:  # date de la dernière recherche à la main, montrée dans « Découvertes » (Réglages → Découverte)
            f = Path(core.CFG["state_dir"]) / "backups-discover.json"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps({"at": time.time()}), encoding="utf-8")
        except OSError:
            pass
        return out
    return backups_call(request, "recherche de sauvegardes", "", go)


@router.put(API + "/backups/patterns", tags=["sauvegardes"], summary="Emplacements cherchés en plus de /home/backup, motifs glob permis (admin)")
def backups_patterns(body: BackupPatterns, request: Request):
    return backups_call(request, "emplacements de sauvegarde", f"{len(body.patterns)} emplacement(s)", lambda b: b.set_patterns(body.patterns, body.by_host))


@router.put(API + "/backups/settings", tags=["sauvegardes"], summary="Suivre des dossiers de sauvegarde : écrit l'inventaire, active l'onglet (admin)")
def backups_follow(body: BackupFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.follow([i.model_dump() for i in body.items])
        if not core.CFG.get("backups_url"):  # onglet Sauvegardes activé par le premier jeu
            system.set_backups_url(core, core.BACKUPS_FILE)
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
    copy_of: str = ""   # Backup Copy job: the job it copies (its set gets this job as a copy location)
    machines: dict[str, str] = {}   # VM (object) name -> machine IP, "" = none: wins over the match by name


class VeeamFollow(VeeamAccount):
    jobs: list[VeeamJob]


class HaFollow(BaseModel):
    connector: str
    label: str = ""
    max_age_days: float = 2.0


@router.post(API + "/backups/veeam/test", tags=["sauvegardes"], summary="Essayer la connexion à Veeam B&R sans rien enregistrer (admin)")
def backups_veeam_test(body: VeeamAccount, request: Request):
    return backups_call(request, "essai de connexion Veeam", body.url, lambda b: b.veeam_test(body.model_dump()))


@router.post(API + "/backups/veeam/discover", tags=["sauvegardes"], summary="Lister les jobs et dépôts de Veeam B&R, lecture seule, sans rien enregistrer (admin)")
def backups_veeam_discover(body: VeeamAccount, request: Request):
    return backups_call(request, "recherche des jobs Veeam", body.url, lambda b: b.veeam_discover(body.model_dump()))


@router.put(API + "/backups/veeam", tags=["sauvegardes"], summary="Enregistrer le compte Veeam (mot de passe chiffré) et suivre des jobs (admin)")
def backups_veeam_follow(body: VeeamFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.veeam_follow(body.model_dump(exclude={"jobs"}), [j.model_dump() for j in body.jobs])
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (Veeam)")
        return {"ok": True, **out}
    return backups_call(request, "jobs Veeam suivis", f"{body.url} : {len(body.jobs)} job(s)", go)


class RemoteAccount(BaseModel):
    name: str
    protocol: str = "ftp"
    host: str
    port: str = ""
    user: str = ""
    password: str = ""  # empty = the one already saved for this name; never sent back, never in the log
    share: str = ""


class RemoteBrowse(RemoteAccount):
    path: str = "/"


class RemoteFollow(RemoteAccount):
    path: str
    label: str = ""
    max_age_days: float = 2.0
    copy_of: str = ""


@router.post(API + "/backups/remote/test", tags=["sauvegardes"], summary="Essayer la connexion à un dossier distant (FTP, FTPS, Samba) sans rien enregistrer (admin)")
def backups_remote_test(body: RemoteAccount, request: Request):
    return backups_call(request, "essai de connexion dossier distant", body.host, lambda b: b.remote_test(body.model_dump()))


@router.post(API + "/backups/remote/browse", tags=["sauvegardes"], summary="Lister un dossier distant, lecture seule, sans rien enregistrer (admin)")
def backups_remote_browse(body: RemoteBrowse, request: Request):
    return backups_call(request, "", body.host, lambda b: b.remote_browse(body.model_dump(exclude={"path"}), body.path))


@router.put(API + "/backups/remote", tags=["sauvegardes"], summary="Enregistrer le compte d'un dossier distant (mot de passe chiffré) et le suivre (admin)")
def backups_remote_follow(body: RemoteFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.remote_follow(body.model_dump(exclude={"path", "label", "max_age_days", "copy_of"}), body.path, body.label, body.max_age_days, body.copy_of)
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (dossier distant)")
        return {"ok": True, **out}
    return backups_call(request, "dossier distant suivi", f"{body.host} : {body.path}", go)


class PbsChoice(BaseModel):
    connector: str


class PbsGroup(BaseModel):
    key: str
    label: str = ""
    max_age_days: float = 2.0


class PbsFollow(PbsChoice):
    groups: list[PbsGroup]


class SynologyChoice(BaseModel):
    connector: str


class SynologyTask(BaseModel):
    key: str
    label: str = ""
    max_age_days: float = 2.0


class SynologyFollow(SynologyChoice):
    tasks: list[SynologyTask]


@router.post(API + "/backups/synology/discover", tags=["sauvegardes"], summary="Lister les tâches Hyper Backup d'un NAS Synology par son connecteur, lecture seule (admin)")
def backups_synology_discover(body: SynologyChoice, request: Request):
    return backups_call(request, "", "", lambda b: b.synology_discover(body.connector))


@router.put(API + "/backups/synology", tags=["sauvegardes"], summary="Suivre des tâches Hyper Backup d'un NAS Synology (admin)")
def backups_synology_follow(body: SynologyFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.synology_follow(body.connector, [t.model_dump() for t in body.tasks])
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (Synology)")
        return {"ok": True, **out}
    return backups_call(request, "tâches Hyper Backup suivies", f"{body.connector} : {len(body.tasks)} tâche(s)", go)


@router.post(API + "/backups/pbs/discover", tags=["sauvegardes"], summary="Lister les groupes de sauvegarde d'un Proxmox Backup Server par son connecteur, lecture seule (admin)")
def backups_pbs_discover(body: PbsChoice, request: Request):
    return backups_call(request, "", "", lambda b: b.pbs_discover(body.connector))


@router.put(API + "/backups/pbs", tags=["sauvegardes"], summary="Suivre des groupes de sauvegarde de Proxmox Backup Server (admin)")
def backups_pbs_follow(body: PbsFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.pbs_follow(body.connector, [g.model_dump() for g in body.groups])
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (Proxmox Backup)")
        return {"ok": True, **out}
    return backups_call(request, "groupes Proxmox Backup suivis", f"{body.connector} : {len(body.groups)} groupe(s)", go)


class AgentBackup(BaseModel):
    ip: str
    tool: str
    label: str = ""
    max_age_days: float = 2.0


class AgentBackupsFollow(BaseModel):
    runs: list[AgentBackup]


@router.get(API + "/backups/agents/discover", tags=["sauvegardes"], summary="Veeam Agent et Sauvegarde Windows Server vus par les agents Windows, lecture seule (admin)")
def backups_agents_discover(request: Request):
    return backups_call(request, "", "", lambda b: b.agent_backups_discover(), write=False)


@router.put(API + "/backups/agents", tags=["sauvegardes"], summary="Suivre les sauvegardes Veeam Agent / Windows Server vues par les agents Windows (admin)")
def backups_agents_follow(body: AgentBackupsFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.agent_backups_follow([r.model_dump() for r in body.runs])
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (agents Windows)")
        return {"ok": True, **out}
    return backups_call(request, "sauvegardes des agents Windows suivies", f"{len(body.runs)} sauvegarde(s)", go)


class VzdumpGroup(BaseModel):
    ip: str
    dir: str
    kind: str
    vmid: str
    network: bool = False
    label: str = ""
    max_age_days: float = 2.0


class VzdumpFollow(BaseModel):
    groups: list[VzdumpGroup]


@router.post(API + "/backups/vzdump/discover", tags=["sauvegardes"], summary="Lister les sauvegardes vzdump des hôtes Proxmox VE lus par SSH, lecture seule (admin)")
def backups_vzdump_discover(request: Request):
    return backups_call(request, "", "", lambda b: b.vzdump_discover())


@router.put(API + "/backups/vzdump", tags=["sauvegardes"], summary="Suivre les sauvegardes vzdump de machines invitées Proxmox VE (admin)")
def backups_vzdump_follow(body: VzdumpFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.vzdump_follow([g.model_dump() for g in body.groups])
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (vzdump)")
        return {"ok": True, **out}
    return backups_call(request, "sauvegardes vzdump suivies", f"{len(body.groups)} machine(s) invitée(s)", go)


@router.post(API + "/backups/ha/check", tags=["sauvegardes"], summary="Lire les sauvegardes de Home Assistant par son connecteur, sans rien enregistrer (admin)")
def backups_ha_check(body: HaFollow, request: Request):
    return backups_call(request, "", "", lambda b: b.ha_check(body.connector))


@router.put(API + "/backups/ha", tags=["sauvegardes"], summary="Suivre la sauvegarde automatique de Home Assistant (admin)")
def backups_ha_follow(body: HaFollow, request: Request):
    from msv.collect import system

    def go(b):
        out = b.ha_follow(body.connector, body.label, body.max_age_days)
        if not core.CFG.get("backups_url"):
            system.set_backups_url(core, core.BACKUPS_FILE)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes (Home Assistant)")
        return {"ok": True, **out}
    return backups_call(request, "sauvegarde Home Assistant suivie", body.connector, go)


class BackupSetChange(BaseModel):
    label: str | None = Field(None, max_length=80)
    max_age_days: float | None = Field(None, ge=0.1, le=365)
    expect_offsite: bool | None = None
    archived: bool | None = None   # kept in the inventory and shown last, no longer watched
    schedule: str | None = Field(None, max_length=40, description="Expected schedule, free text")
    path: str | None = Field(None, max_length=300, description="Folder sets only: the folder read on the machine")
    retention: str | None = Field(None, max_length=60, description="How many archives are kept, free text")
    note: str | None = Field(None, max_length=300)
    mode: str | None = Field(None, description="« latest »: copies compared on the newest archive; « each »: on every archive")


@router.patch(API + "/backups/settings/{set_id}", tags=["sauvegardes"], summary="Modifier un jeu suivi : nom, seuil d'âge, copie hors machine exigée, archivé, attendu, dossier, rétention, note, comparaison (admin)")
def backups_set_update(set_id: str, body: BackupSetChange, request: Request):
    def go(b):
        b.update_set(set_id, body.label, body.max_age_days, body.expect_offsite, body.archived, body.schedule, body.path, body.retention, body.note, body.mode)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True}
    return backups_call(request, "sauvegarde modifiée", set_id, go)


class BackupLocationChange(BaseModel):
    ip: str | None = Field(None, max_length=64, description="Machine (with SSH access) that holds the folder")
    path: str | None = Field(None, max_length=300)
    pattern: str | None = Field(None, max_length=120, description="Archive names read in the folder, a glob (« *.tar.gz »)")
    depth: int | None = Field(None, ge=1, le=5, description="Sub-folder levels searched")
    via: str | None = Field(None, max_length=80, description="How the archives get there, free text (« rsync 04:00 »)")
    encrypted: bool | None = None
    every_days: int | None = Field(None, ge=1, le=31, description="Days between two runs of this copy (1 = daily, 7 = weekly): a copy that runs less often is not late between two runs")


@router.patch(API + "/backups/settings/{set_id}/locations/{index}", tags=["sauvegardes"], summary="Modifier un emplacement d'un jeu (0 = la source, puis ses copies) : machine, dossier, fichiers lus, profondeur, moyen, chiffré (admin)")
def backups_location_update(set_id: str, index: int, body: BackupLocationChange, request: Request):
    def go(b):
        b.update_location(set_id, index, body.ip, body.path, body.pattern, body.depth, body.via, body.encrypted, body.every_days)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True}
    return backups_call(request, "emplacement de sauvegarde modifié", set_id, go)


class BackupCopy(BaseModel):
    ip: str
    path: str = Field(max_length=300)
    network: bool = False   # network share (NAS) seen from the machine: an off-machine copy even on the origin


@router.post(API + "/backups/copies/find", tags=["sauvegardes"], summary="Chercher où sont copiées les sauvegardes suivies (partages réseau compris), lecture seule (admin)")
def backups_copies_find(request: Request):
    return backups_call(request, "recherche des copies de sauvegarde", "", lambda b: b.find_copies())


@router.post(API + "/backups/settings/{set_id}/copies", tags=["sauvegardes"], summary="Déclarer où un dossier suivi est copié : comparé à la source à chaque relevé (admin)")
def backups_copy_add(set_id: str, body: BackupCopy, request: Request):
    def go(b):
        out = b.add_copy(set_id, body.ip, body.path, body.network)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True, **out}
    return backups_call(request, "copie de sauvegarde déclarée", f"{set_id} -> {body.ip}:{body.path}", go)


@router.delete(API + "/backups/settings/{set_id}/copies/{index}", tags=["sauvegardes"], summary="Retirer une copie déclarée d'un jeu (admin)")
def backups_copy_remove(set_id: str, index: int, request: Request):
    def go(b):
        b.remove_copy(set_id, index)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True}
    return backups_call(request, "copie de sauvegarde retirée", f"{set_id} #{index}", go)


@router.delete(API + "/backups/settings/{set_id}", tags=["sauvegardes"], summary="Ne plus suivre un jeu de sauvegarde (admin)")
def backups_unfollow(set_id: str, request: Request):
    def go(b):
        b.unfollow(set_id)
        core.run_chain(["backups", "collect"], "Réglages → Sauvegardes")
        return {"ok": True}
    return backups_call(request, "sauvegarde retirée", set_id, go)


@router.get(API + "/system/logs", tags=["système"], summary="Journal du conteneur depuis son démarrage, comme docker logs (admin)")
def system_logs(request: Request, after: int = 0):
    from msv.core import applog
    return admin_only(request) or JSONResponse(applog.lines(max(after, 0)), headers={"Cache-Control": "no-store"})


@router.post(API + "/system/tasks/{name}/run", tags=["système"], summary="Lancer une tâche maintenant (admin)")
def system_run(name: str, request: Request):
    if denied := admin_write(request):
        return denied
    if name not in core.TASKS:
        return deny(400, "tâche inconnue")
    if not core.enabled(name):
        return deny(409, "tâche non configurée (rien à faire pour l'instant)")
    if not core.run_task(name, f"Réglages → Tâches et horaires, {request.state.user['username']}"):
        return deny(409, "déjà en cours")
    store().audit("tâche lancée", request.state.user["username"], ip_of(request), name)
    return {"ok": True}


class Confirm(BaseModel):
    password: str = Field(max_length=256)


class ExportBody(Confirm):
    parts: list[str] | None = Field(default=None, max_length=8)   # a missing list means every part


class ImportPreviewBody(BaseModel):
    archive: str = Field(max_length=96 << 20)   # base64 of the ZIP


class ImportApplyBody(ImportPreviewBody):
    password: str = Field(max_length=256)
    parts: list[str] = Field(max_length=8)
    replace_app_keys: bool = False   # replace the app's own SSH key too (the machines that authorized it will refuse the new one)


def _places():
    from msv.core import config_transfer as ct
    from msv.collect import system
    return ct.Places(system.api_config_dir(), Path(core.CFG["state_dir"]), db_path(core.CFG))


def _archive_bytes(b64: str) -> bytes | JSONResponse:
    import base64
    import binascii
    try:
        return base64.b64decode(b64, validate=True)
    except ValueError:   # binascii.Error is a ValueError
        return deny(400, "archive illisible (base64 invalide)")


def _confirmed(request: Request, password: str) -> JSONResponse | None:
    """Session admin + the user's own password, with the same lock-out as a login."""
    if denied := session_admin(request):
        return denied
    u, ip = request.state.user, ip_of(request)
    if store().too_many_failures(ip):
        return deny(429, "trop d'échecs : réessayer dans 15 minutes")
    if store().verify(u["username"], password, ip) is None:
        return deny(401, "mot de passe incorrect")
    return None


@router.get(API + "/system/config-parts", tags=["système"], summary="Parties exportables de la configuration et ce que cette installation en a (admin)")
def system_config_parts(request: Request):
    from msv.core import config_transfer as ct
    if denied := session_admin(request):
        return denied
    have = ct.present(_places())
    return {"parts": [{"id": p, "files": have.get(p, []), "sensitive": p in ct.SENSITIVE} for p in ct.PARTS]}


@router.post(API + "/system/export", tags=["système"], summary="Exporter la configuration en ZIP, tout ou certaines parties (session admin + mot de passe)")
def system_export(body: ExportBody, request: Request):
    from msv.core import config_transfer as ct
    if denied := _confirmed(request, body.password):
        return denied
    try:
        data = ct.export_config(_places(), body.parts, os.environ.get("MYSERVICES_VERSION", "dev"))
    except ct.TransferError as e:
        return deny(400, str(e))
    u = request.state.user
    store().audit("configuration exportée", u["username"], ip_of(request), ",".join(body.parts) if body.parts else "tout")
    name = f"myservices-config-{time.strftime('%Y%m%d-%H%M')}.zip"
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


@router.post(API + "/system/import/preview", tags=["système"], summary="Lire une archive de configuration sans rien écrire : parties, problèmes (session admin)")
def system_import_preview(body: ImportPreviewBody, request: Request):
    from msv.core import config_transfer as ct
    if denied := session_admin(request):
        return denied
    data = _archive_bytes(body.archive)
    if isinstance(data, JSONResponse):
        return data
    try:
        return ct.preview(data, _places())
    except ct.TransferError as e:
        return deny(400, str(e))


@router.post(API + "/system/import", tags=["système"], summary="Importer des parties d'une archive de configuration (session admin + mot de passe)")
def system_import(body: ImportApplyBody, request: Request):
    from msv.core import config_transfer as ct
    if denied := _confirmed(request, body.password):
        return denied
    data = _archive_bytes(body.archive)
    if isinstance(data, JSONResponse):
        return data
    try:
        out = ct.apply(data, body.parts, _places(), body.replace_app_keys)
    except ct.TransferError as e:
        return deny(400, str(e))
    store().audit("configuration importée", request.state.user["username"], ip_of(request), ",".join(body.parts))
    from msv.collect import system
    return {"ok": True, **out, **system.after_import(core, body.parts)}
