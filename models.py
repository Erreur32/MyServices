"""Modèle de données commun de MyServices (pydantic) : Machine, Service, Santé, Sauvegarde, Événement, Alerte.

Ce sont les formes que le collecteur, la santé, la veille, l'historique et les alertes écrivent déjà (data.json,
health/stats.json, backups.json, events, règles d'alerte) et que le front lit (front/src/types.ts) : ici elles sont
écrites une fois, vérifiables, et documentées dans l'OpenAPI de l'API v1. Un connecteur renvoie ces formes (ou des
dicts qui s'y plient) ; un champ en plus ne casse rien (extra="allow"), un champ de base manquant ou mal typé est refusé
par validate(), qui sert aux tests et à `manage.py`.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

Level = Literal["ok", "warn", "crit", "down", "na"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="allow")  # le reste du contenu (propre à chaque source) est gardé tel quel


class SshAccess(_Model):
    alias: str
    port: int = 22
    user: str | None = None


class Machine(_Model):
    """Une machine du réseau (data.json « machine_list »)."""
    ip: str
    name: str
    role: str | None = None
    ping: bool = False
    off: bool = False
    disabled: bool = False
    ttl: int | None = None
    detected: list[str] = []
    ssh: SshAccess | None = None


class ServiceInfo(_Model):
    kind: str            # docker, process, apache, nginx…
    name: str


class Service(_Model):
    """Un service exposé (data.json « categories » / « hosts »)."""
    type: Literal["proxy", "redirect", "dead", "stream", "local"]
    enabled: bool
    domains: list[str] = []
    name: str | None = None
    ip: str | None = None
    port: int | None = None
    machine: str | None = None
    service: ServiceInfo | None = None


class Disk(_Model):
    mount: str
    used_pct: float
    size_gb: float | None = None
    avail_gb: float | None = None
    warning: bool = False
    critical: bool = False


class Health(_Model):
    """Santé d'une machine (health/stats.json « hosts »), quelle que soit la source (SSH, agent, Beszel)."""
    id: str
    name: str            # « Nom · IP »
    reachable: bool
    level: Level
    disks: list[Disk] = []
    source: Literal["ssh", "agent", "beszel"] | None = None
    sources: list[str] = []
    read_at: str | None = None   # when this machine was last read (ISO 8601)


class BackupLocation(_Model):
    host: str
    label: str
    level: str
    age: float | None = None
    via: str | None = None


class Backup(_Model):
    """Un jeu de sauvegarde et ses emplacements (backups.json « sets »)."""
    id: str
    label: str
    origin: str
    schedule: str
    level: str
    archived: bool = False
    offsite: int = 0
    locations: list[BackupLocation] = []


class Event(_Model):
    """Événement de la veille ou de la santé (events.json, table « events » de l'historique)."""
    kind: str
    key: str | None = None
    label: str | None = None
    machine: str | None = None
    target: str | None = None
    detail: str | None = None
    ts: str | float | None = None
    at: str | None = None


class Alert(_Model):
    """Règle d'alerte (Réglages → Alertes) : quels genres d'événements partent vers quels canaux."""
    name: str
    kinds: list[str]
    resolved: bool = True
    cooldown_min: int = 0


def validate(model: type[BaseModel], items: list[dict]) -> list[str]:
    """Éléments qui ne se plient pas au modèle : « n° : champ : raison », en clair. Liste vide = tout est conforme."""
    out = []
    for i, it in enumerate(items):
        try:
            model.model_validate(it)
        except ValidationError as e:
            out += [f"{model.__name__} #{i} : {'.'.join(str(p) for p in err['loc'])} : {err['msg']}" for err in e.errors()]
    return out


def snapshot_problems(data: dict | None = None, health: dict | None = None, backups: dict | None = None) -> list[str]:
    """Contrôle des fichiers produits (data.json, health/stats.json, backups.json) contre le modèle commun."""
    out = []
    if data:
        out += validate(Machine, data.get("machine_list", []))
        out += validate(Service, data.get("hosts", []))
    if health:
        out += validate(Health, health.get("hosts", []))
    if backups:
        out += validate(Backup, backups.get("sets", []))
    return out
