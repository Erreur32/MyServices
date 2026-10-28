"""API routes: history."""
from __future__ import annotations

import ipaddress

from fastapi import APIRouter, Request

from msv.api import server as core
from msv.core.auth import db_path
from msv.api.common import API, admin_write, deny

router = APIRouter()

@router.get(API + "/events", tags=["historique"], summary="Événements (pannes, rétablissements, santé…), un an")
def events(since: float | None = None, until: float | None = None, kind: str | None = None, machine: str | None = None,
           source: str | None = None, q: str | None = None, limit: int = 500):
    from msv.core import history
    return {"events": history.query(db_path(core.CFG), since, until, kind, machine, source, q, limit)}


@router.get(API + "/events/per-day", tags=["historique"], summary="Nombre d'événements par jour et par genre")
def events_per_day(days: int = 30):
    from msv.core import history
    return {"days": history.per_day(db_path(core.CFG), days)}


@router.get(API + "/availability", tags=["historique"], summary="Disponibilité des services, machines et sondes Uptime Kuma sur une période (taux, temps de réponse, une case par jour ou par heure)")
def availability_report(days: int = 30):
    from msv.collect import availability
    return availability.report(db_path(core.CFG), days)


HISTORY_HOURS = (24, 72, 168)


@router.get(API + "/machines/history", tags=["historique"], summary="Historique des cadres de la page Machines (joignables, santé, processeur et mémoire moyens) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé")
def machines_history(hours: int = 24):
    from msv.collect import availability
    from msv.core import metrics
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    db = db_path(core.CFG)
    return {"hours": h, "reach": availability.reach_series(db, h), "health": tile_history.series(db, tile_history.HEALTH, h),
            "cpu": metrics.average(db, "cpu", h), "mem": metrics.average(db, "mem", h)}


@router.get(API + "/network/history", tags=["historique"], summary="Historique des cadres de la page Réseau (équipements, clients, appareils en ligne, débit de la Freebox et d'UniFi) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé")
def network_history(hours: int = 24):
    from msv.collect import bandwidth
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    db = db_path(core.CFG)
    return {"hours": h, **{k.split(".")[1]: tile_history.series(db, k, h) for k in tile_history.NETWORK},
            "bw": {k.removeprefix("bw."): tile_history.series(db, k, h) for k in bandwidth.KEYS}}


@router.get(API + "/backups/history", tags=["historique"], summary="Historique des cadres de la page Sauvegardes (à jour, en retard, absentes ou en erreur) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé")
def backups_history(hours: int = 24):
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    return {"hours": h, **{k.split(".")[1]: tile_history.series(db_path(core.CFG), k, h) for k in tile_history.BACKUPS}}


@router.get(API + "/agents/history", tags=["historique"], summary="Historique des cadres de la page Agents (actifs, à mettre à jour) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé (admin)")
def agents_history(request: Request, hours: int = 24):
    from msv.collect import tile_history
    if denied := admin_write(request):
        return denied
    h = hours if hours in HISTORY_HOURS else 24
    return {"hours": h, **{k.split(".")[1]: tile_history.series(db_path(core.CFG), k, h) for k in tile_history.AGENTS}}


@router.get(API + "/ai/history", tags=["historique"], summary="Historique des cadres de la page IA et agents (GPU, mémoire, moteurs, modèles, agents) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé")
def ai_history(hours: int = 24):
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    return {"hours": h, **{k.split(".")[1]: tile_history.series(db_path(core.CFG), k, h) for k in tile_history.AI}}


@router.get(API + "/virtualization/history", tags=["historique"], summary="Historique des cadres de la page Virtualisation (hôtes, machines, processeur, mémoire, stockage, sauvegardes) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé")
def virtualization_history(hours: int = 24):
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    return {"hours": h, **{k.split(".")[1]: tile_history.series(db_path(core.CFG), k, h) for k in tile_history.VIRT}}


@router.get(API + "/dns/history", tags=["historique"], summary="Historique des cadres de la page DNS (serveurs qui répondent, latence des DNS publics) sur 24 h, 72 h ou 7 jours : [heure, valeur, total] par relevé")
def dns_history(hours: int = 24):
    from msv.collect import dns_probe
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    db = db_path(core.CFG)
    return {"hours": h, "local": tile_history.series(db, dns_probe.LOCAL, h),
            "external": [{"name": name, "ip": ip, "ms": tile_history.series(db, dns_probe.ext_keys(ip)[0], h), "up": tile_history.series(db, dns_probe.ext_keys(ip)[1], h)}
                         for name, ip in dns_probe.EXTERNAL]}


@router.get(API + "/services/history", tags=["historique"], summary="Historique des cadres de la page Services (en ligne, en panne, avertissement) sur 24 h, 72 h ou 7 jours : [heure, répondent, total] par relevé")
def services_history(hours: int = 24):
    from msv.collect import availability
    from msv.collect import tile_history
    h = hours if hours in HISTORY_HOURS else 24
    return {"hours": h, "up": availability.service_series(db_path(core.CFG), h), "warn": tile_history.series(db_path(core.CFG), tile_history.SERVICES_WARN, h),
            "health": tile_history.series(db_path(core.CFG), tile_history.SERVICES_HEALTH, h)}


@router.get(API + "/machines/{ip}/metrics", tags=["historique"], summary="Processeur, mémoire, disque le plus plein et température d'une machine sur 24 h")
def machine_metrics(ip: str):
    from msv.core import metrics
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return deny(400, "IP attendue")
    return metrics.series(db_path(core.CFG), ip)
