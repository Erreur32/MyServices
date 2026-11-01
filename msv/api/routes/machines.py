"""API routes: machines."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from msv.api import server as core
from msv.api.common import API, _netscan_file, admin_only, admin_write, agents_store, deny, ip_of, machine_call, read_produced, store

router = APIRouter()

class MachineConf(BaseModel):
    machine: dict
    process: bool | None = None
    extra: list[dict] = []


@router.get(API + "/machines/settings", tags=["machines"], summary="Machines déclarées, alias SSH connus (admin)")
def machines_settings(request: Request):
    return machine_call(request, "", "", _listing_with_ssh_uses, write=False)


def _listing_with_ssh_uses(m) -> dict:
    out = m.listing()
    out["ssh_uses"] = _ssh_uses(out["machines"])
    return out


def _ssh_uses(machines: dict) -> dict[str, list[str]]:
    """What needs SSH on each machine beyond what an agent reads (Machines › SSH connections: « SSH optional » otherwise)."""
    from msv.machines import access_advice
    import connectors
    try:
        hosts = json.loads(Path(core.CFG["backups_meta"]).read_text(encoding="utf-8")).get("hosts") or []
    except (OSError, ValueError, AttributeError):
        hosts = []
    from msv.backups import backups
    reports = backups.agent_reports()   # its agent reads them: no need of SSH for backups on that machine
    hosts = [h for h in hosts if not (isinstance(h, dict) and backups.report_scan(reports.get(h.get("ip"))))] if isinstance(hosts, list) else []
    try:
        declared = connectors.declared(core.CFG)
    except connectors.ConnectorError:
        declared = []
    from connectors.adguard import agent_dns
    machines = {ip: ({k: v for k, v in m.items() if k != "adguard"} if m.get("adguard") and agent_dns(ip).get("adguard") else m) for ip, m in machines.items()}
    return access_advice.ssh_uses(machines, declared, hosts if isinstance(hosts, list) else [], (read_produced(core.DATA_FILE) or {}).get("virtualization") or [])


@router.get(API + "/machines/advice", tags=["machines"], summary="Méthode de lecture recommandée pour chaque machine suivie : SSH, agent, connecteur ou ping (admin)")
def machines_advice(request: Request):
    from msv.collect import netscan
    from msv.machines import access_advice

    def advise(m):
        try:
            data = json.loads((Path(core.CFG["web_dir"]) / core.DATA_FILE).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        found = netscan.state(_netscan_file()).get("found") or []
        states = {a["ip"]: a["state"] for a in agents_store().listing() if a["state"] != "révoqué"}   # agent installé : actif, silencieux ou en attente
        return {"advice": access_advice.advise_all([x for x in data.get("machine_list") or [] if not x.get("disabled")], m.listing()["machines"], found,
                                                   data.get("network"), states)}
    return machine_call(request, "", "", advise, write=False)


@router.get(API + "/assistant", tags=["système"], summary="Progression de l'assistant de démarrage ; null s'il n'a jamais servi (admin)")
def assistant_get(request: Request):
    from msv.core import assistant_state
    if denied := admin_only(request):
        return denied
    return {"state": assistant_state.load(Path(core.CFG["state_dir"]) / "assistant.json")}


@router.put(API + "/assistant", tags=["système"], summary="Enregistrer la progression de l'assistant de démarrage (admin)")
def assistant_put(body: dict, request: Request):
    from msv.core import assistant_state
    if denied := admin_only(request):   # pas admin_write : cette route ne touche à aucun compte, et doit marcher aussi sans comptes
        return denied
    return {"state": assistant_state.save(Path(core.CFG["state_dir"]) / "assistant.json", body)}


@router.post(API + "/machines/detect", tags=["machines"], summary="Détecter une machine (IP, nom ou alias), sans rien écrire (admin)")
def machines_detect(request: Request, target: str):
    return machine_call(request, "", "", lambda m: m.detect(target))


class RedetectBody(BaseModel):
    ips: list[str] | None = None


@router.post(API + "/machines/redetect", tags=["machines"], summary="Refaire la détection des machines déclarées : écarts proposés, rien n'est écrit (admin)")
def machines_redetect(request: Request, body: RedetectBody | None = None):
    return machine_call(request, "machines redétectées", ", ".join(body.ips) if body and body.ips else "toutes",
                        lambda m: m.redetect(body.ips if body else None))


@router.put(API + "/machines/settings/{ip}", tags=["machines"], summary="Ajouter ou modifier une machine (admin)")
def machines_save(ip: str, body: MachineConf, request: Request):
    def go(m):
        saved = m.save(ip, body.machine, body.process, body.extra)
        m.publish(ip, saved)   # name and tags shown by the pages right away, not after the next collection
        return {"ok": True, "machine": saved, "message": "enregistrée : prise en compte au prochain passage de la collecte"}
    return machine_call(request, "machine enregistrée", ip, go)


class AliasBody(BaseModel):
    ip: str
    user: str = "root"
    port: int = 22
    host: str | None = None   # SSH address when it differs from the machine IP (DNS name, another network)


@router.post(API + "/machines/ssh-alias", tags=["machines"], summary="Préparer l'accès SSH d'une machine : alias avec la clé de l'app (admin)")
def machines_ssh_alias(body: AliasBody, request: Request):
    return machine_call(request, "alias SSH préparé", f"{body.user}@{body.ip}:{body.port}", lambda m: m.add_alias(body.ip, body.user, body.port, body.host))


class ProbeBody(BaseModel):
    ip: str
    windows: bool = False


@router.post(API + "/machines/ssh-alias/test", tags=["machines"], summary="Tester l'accès SSH d'une machine pas encore déclarée (admin)")
def machines_ssh_alias_test(body: ProbeBody, request: Request):
    return machine_call(request, "", "", lambda m: m.probe_alias(body.ip, body.windows))


@router.delete(API + "/machines/ssh-alias/{ip}", tags=["machines"], summary="Retirer l'alias SSH préparé pour une machine dont l'ajout est abandonné (admin)")
def machines_ssh_alias_delete(ip: str, request: Request):
    return machine_call(request, "alias SSH retiré", ip, lambda m: m.remove_alias(ip))


@router.get(API + "/network/scan", tags=["réseau"], summary="Dernière recherche de machines sur le réseau local (admin)")
def network_scan_state(request: Request):
    from msv.collect import netscan
    return admin_only(request) or JSONResponse({**netscan.state(_netscan_file()), "ignored": [e["ip"] for e in core.CFG["netscan_ignored"]]},
                                               headers={"Cache-Control": "no-store"})


@router.post(API + "/network/scan", tags=["réseau"], summary="Chercher les machines du réseau local : ping, nom, ports (lecture seule) (admin)")
def network_scan_start(request: Request):
    from msv.collect import netscan

    def launch(m):
        if not netscan.start(m.known_ips(), _netscan_file(), net=",".join(core.CFG["netscan_nets"]) or None, discreet=core.CFG["netscan_discreet"]):
            raise m.MachineError("une recherche est déjà en cours")
        return netscan.state(_netscan_file())
    return machine_call(request, "recherche réseau lancée", "", launch)


class NetscanEvery(BaseModel):
    every_h: int | None = None
    nets: list[str] | None = None
    discreet: bool | None = None
    auto: bool | None = None


@router.get(API + "/network/settings", tags=["réseau"], summary="Fréquence de la recherche réseau automatique (admin)")
def network_settings(request: Request):
    from msv.collect import system
    return admin_only(request) or system.netscan_settings(core)


@router.put(API + "/network/settings", tags=["réseau"], summary="Changer la fréquence de la recherche réseau automatique, 0 = coupée (admin)")
def network_settings_set(body: NetscanEvery, request: Request):
    from msv.collect import system
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
        if body.auto is not None:
            out = system.set_auto_mode(core, body.auto)
            what.append("mode " + ("automatique" if body.auto else "manuel"))
    except ValueError as e:
        return deny(400, str(e))
    store().audit("recherche réseau", request.state.user["username"], ip_of(request), " ; ".join(what))
    return {"ok": True, **(out or system.netscan_settings(core))}


@router.get(API + "/unifi/cards", tags=["réseau"], summary="Appareils UniFi avec leurs ports, pour les cartes de l'onglet Réseau")
def unifi_cards():
    from msv.collect import unifi_cards as uc
    return uc.read(core.CFG)


@router.get(API + "/network/stats", tags=["réseau"], summary="Statistiques du scan et volume par client lus par MynetworK (onglet Réseau)")
def network_stats(traffic: str = "live"):
    from msv.collect import network_stats as ns
    return ns.read(core.CFG, traffic)


@router.get(API + "/network/diagnostics", tags=["réseau"], summary="Problèmes possibles du réseau : ports négociés sous leur maximum, équipements hors ligne…")
def network_diagnostics_route():
    from msv.collect import network_diagnostics as nd
    from msv.collect import unifi_cards as uc
    doc = uc.read(core.CFG)
    data = read_produced(core.DATA_FILE) or {}
    clients = [c for row in data.get("network") or [] for c in ((row.get("unifi") or {}).get("clients") or [])]
    from msv.collect import fast
    live = {ip: d for src in (fast.read(core.WEB / "live.json").get("sources") or {}).values() for ip, d in (src.get("devices") or {}).items()}   # fresher than data.json
    scan = [{**d, **{k: live[d["ip"]][k] for k in ("status", "ping_ms") if k in live.get(d["ip"], {})}} for row in data.get("network") or [] for d in row.get("devices") or [] if d.get("ip")]
    machines = [{"name": m.get("name"), "ip": m.get("ip"), "nics": ((m.get("info") or {}).get("nics")) or (((m.get("agent") or {}).get("hardware") or {}).get("nics")) or []}
                for m in data.get("machine_list") or [] if not m.get("disabled")]
    now = time.time()
    samples = nd.error_samples(_read_json(_port_errors_file(), []), doc["devices"], now)
    _write_json(_port_errors_file(), samples)
    found = nd.findings(doc["devices"], clients, scan, machines) + nd.error_rise_findings(samples, doc["devices"], clients, now)
    found.sort(key=lambda f: nd.SEVERITY[f["severity"]])
    items = nd.mark_accepted(found, nd.accepted_keys(_diag_accepted_file()))
    return {"source": doc["source"], "at": doc["at"], "error": doc["error"], "devices": len(doc["devices"]), "summary": nd.summary(items), "findings": items,
            "ok_ports": nd.ok_ports(doc["devices"], clients, items, machines), "sfp": nd.sfp_modules(doc["devices"]), "port_errors": nd.port_errors(doc["devices"])}


@router.get(API + "/connectors/requests", tags=["connecteurs"], summary="Request counters per connector and route since the server started (admin)")
def connectors_requests(request: Request):
    """Settings > Requests: calls per route over the last minute and hour, durations, HTTP codes, 429s and what is to watch (reqstats),
    measured in real conditions on any build."""
    from connectors import reqstats
    return admin_only(request) or dict(reqstats.snapshot(), version=os.environ.get("MYSERVICES_VERSION", "dev"), pulses=core.pulse_cost())


@router.post(API + "/connectors/requests/reset", tags=["connecteurs"], summary="Request counters back to zero (admin)")
def connectors_requests_reset(request: Request):
    from connectors import reqstats
    if denied := admin_only(request):
        return denied
    reqstats.reset()
    return {"ok": True}


def _port_errors_file() -> Path:
    return Path(core.CFG["state_dir"]) / "port-errors-samples.json"


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write_json(path: Path, value) -> None:
    """Written whole then renamed; a state that cannot be written only costs the comparison"""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(value), encoding="utf-8")  # NOSONAR S2083: path from the config (state_dir), never from a request; only the content is computed
        tmp.replace(path)
    except OSError:
        pass


def _diag_accepted_file() -> Path:
    return Path(core.CFG["state_dir"]) / "diagnostic-accepted.json"


class DiagAccept(BaseModel):
    key: str
    label: str = ""
    accepted: bool = True


@router.post(API + "/network/diagnostics/accepted", tags=["réseau"], summary="Marquer un constat du diagnostic comme normal, ou le rappeler (admin)")
def network_diagnostics_accept(body: DiagAccept, request: Request):
    from msv.collect import network_diagnostics as nd
    if denied := admin_only(request):
        return denied
    try:
        nd.set_accepted(_diag_accepted_file(), body.key, body.label, body.accepted)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("diagnostic : constat accepté" if body.accepted else "diagnostic : constat rappelé", request.state.user["username"], ip_of(request), body.label or body.key)
    return {"ok": True}


def _services_hidden_file() -> Path:
    return Path(core.CFG["state_dir"]) / "services-watch-hidden.json"


class ServiceHide(BaseModel):
    key: str
    sig: str = ""
    name: str = ""
    hidden: bool = True


@router.get(API + "/services/watch-hidden", tags=["services"], summary="Services masqués de « À surveiller » (et du point de l'onglet), avec la signature de leur problème")
def services_watch_hidden():
    from msv.core import services_hidden
    return services_hidden.read(_services_hidden_file())


@router.post(API + "/services/watch-hidden", tags=["services"], summary="Masquer un service de « À surveiller », ou l'afficher de nouveau (admin)")
def services_watch_hide(body: ServiceHide, request: Request):
    from msv.core import services_hidden
    if denied := admin_only(request):
        return denied
    try:
        services_hidden.set_hidden(_services_hidden_file(), body.key, body.sig, body.name, body.hidden)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("services : masqué de « À surveiller »" if body.hidden else "services : affiché de nouveau", request.state.user["username"], ip_of(request), body.name or body.key)
    return {"ok": True}


class LiveChecks(BaseModel):
    pulse_every: int | None = None
    pulse_confirm: int | None = None
    ports_every: int | None = None
    fast_every: int | None = None


@router.get(API + "/system/live-checks", tags=["système"], summary="Pouls et connecteurs rapides : réglages (admin)")
def live_checks(request: Request):
    from msv.collect import system
    return admin_only(request) or system.live_settings(core)


@router.put(API + "/system/live-checks", tags=["système"], summary="Changer le pouls (ping des machines) et les connecteurs rapides (admin)")
def live_checks_set(body: LiveChecks, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    values = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        out = system.set_live(core, values)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("pouls", request.state.user["username"], ip_of(request), " ; ".join(f"{k} = {v}" for k, v in values.items()))
    return {"ok": True, **out}


class IgnoreBody(BaseModel):
    ip: str
    name: str = ""


@router.post(API + "/network/ignored", tags=["réseau"], summary="Ne plus proposer un appareil trouvé par la recherche (admin)")
def network_ignore(body: IgnoreBody, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_netscan_ignored(core, body.ip, body.name, True)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("appareil ignoré", request.state.user["username"], ip_of(request), body.ip)
    return {"ok": True, **out}


@router.delete(API + "/network/ignored/{ip}", tags=["réseau"], summary="Proposer de nouveau un appareil ignoré (admin)")
def network_unignore(ip: str, request: Request):
    from msv.collect import system
    if denied := admin_write(request):
        return denied
    try:
        out = system.set_netscan_ignored(core, ip, "", False)
    except ValueError as e:
        return deny(400, str(e))
    store().audit("appareil de nouveau proposé", request.state.user["username"], ip_of(request), ip)
    return {"ok": True, **out}


@router.post(API + "/network/scan/stop", tags=["réseau"], summary="Arrêter la recherche en cours (admin)")
def network_scan_stop(request: Request):
    from msv.collect import netscan
    if denied := admin_only(request):
        return denied
    netscan.stop()
    return netscan.state(_netscan_file())


@router.delete(API + "/machines/settings/{ip}", tags=["machines"], summary="Retirer une machine (admin)")
def machines_delete(ip: str, request: Request):
    from msv.collect import system

    def go(m):
        name = (m._meta().get("machines", {}).get(ip) or {}).get("name") or ""
        m.delete(ip)
        m.unpublish(ip)   # gone from the pages now, not after the next collection
        # Removed by hand = not wanted: neither proposed by the network search nor added back by the auto mode (Settings -> Discovery
        # lists it, one click brings it back). An IPv6 or a name is not in the network search: nothing to remember.
        try:
            system.set_netscan_ignored(core, ip, name, True)
            ignored = True
        except ValueError:
            ignored = False
        return {"ok": True, "ignored": ignored}
    return machine_call(request, "machine retirée", ip, go)


class MachinePatch(BaseModel):
    fields: dict   # only these fields change; null removes one


@router.patch(API + "/machines/settings/{ip}", tags=["machines"], summary="Changer quelques champs d'une machine, le reste est gardé (admin)")
def machines_patch(ip: str, body: MachinePatch, request: Request):
    def go(m):
        saved = m.patch(ip, body.fields)
        m.publish(ip, saved)
        return {"ok": True, "machine": saved, "message": "enregistrée : prise en compte au prochain passage de la collecte"}
    return machine_call(request, "machine modifiée", ip, go)


@router.post(API + "/machines/settings/{ip}/check", tags=["machines"], summary="Vérifier une machine (SSH, Docker, AdGuard, santé) (admin)")
def machines_check(ip: str, request: Request):
    return machine_call(request, "", "", lambda m: m.check(ip))


@router.post(API + "/machines/settings/{ip}/recheck", tags=["machines"], summary="Relire la santé d'une seule machine, sans passage de collecte (admin)")
def machines_recheck(ip: str, request: Request):
    def go(m):
        nonlocal ip
        ip = m.resolve(ip)
        started = core.enabled("health") and core.run_task("health", f"relecture de {ip} (page de la machine)", ("--only", ip))
        return {"ok": True, "started": started, "busy": not started}
    return machine_call(request, "santé relue", ip, go)


@router.post(API + "/machines/settings/{ip}/refresh", tags=["machines"], summary="Relire une seule machine : collecte (SSH, Docker) et santé (admin)")
def machines_refresh(ip: str, request: Request):
    """Après un changement d'accès ou de réglage : seule cette machine est relue par SSH (les autres restent en cache), puis la
    santé de cette machine seule. Un passage déjà en cours n'est pas doublé : il reprendra le changement au suivant."""
    def go(m):
        nonlocal ip
        ip = m.resolve(ip)   # l'IP, ou le nom de la machine (la page envoie parfois le nom du connecteur)
        m.expire_inventory(ip)
        started = [t for t, args in (("collect", ()), ("health", ("--only", ip))) if core.enabled(t) and core.run_task(t, f"relecture de {ip} (Réglages → Machines)", args)]
        return {"ok": True, "started": started, "busy": not started}
    return machine_call(request, "machine relue", ip, go)
