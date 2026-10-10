"""Registre des connecteurs : types connus et instances configurées.

Instances lues dans config.json :
  « connectors » : [{"type": "npm", "name": "lan", …réglages}, …]   (format v2)
  plus les anciennes clés, converties au vol pour ne rien casser : « npm » / « npm_api » (NPM),
  « discord_webhook » / « health_webhook » (Discord), « telegram_token » + « telegram_chat_id » (Telegram).
Instances tirées de services-meta.json (meta) : chaque machine avec SSH (Docker par SSH), ses process
en écoute (« process_hosts ») et son « adguard » (AdGuard par SSH).
Un nom est unique par type ; la première instance d'un type garde ses id bruts (historique du watcher).
"""
from __future__ import annotations

from connectors.adguard import AdGuard
from connectors.alerts import Discord, Telegram
from connectors.base import Connector, ConnectorError, Context
from connectors.beszel import Beszel
from connectors.docker_ssh import DockerSSH
from connectors.dozzle import Dozzle
from connectors.npm import NPM
from connectors.process import Process
from connectors.uptime_kuma import UptimeKuma
from connectors.webcheck import WebCheck

TYPES: dict[str, type[Connector]] = {c.type: c for c in (DockerSSH, Process, NPM, AdGuard, Beszel, UptimeKuma, Dozzle, WebCheck, Discord, Telegram)}


def declared(cfg: dict, meta: dict | None = None) -> list[dict]:
    """Réglages de toutes les instances, anciennes clés comprises, chacune avec son « type »."""
    out = [dict(c) for c in cfg.get("connectors") or []]
    for ip, m in (meta or {}).get("machines", {}).items():
        if m.get("ssh"):  # machine lue par SSH : ses conteneurs
            out.append({"type": "docker", "name": ip, "ssh": m["ssh"], "ip": ip, "label": m.get("name", ip)})
        if m.get("adguard") and m.get("ssh"):
            out.append({"type": "adguard", "name": ip, "ssh": m["ssh"], "target": m["adguard"], "ip": ip,
                        "label": m.get("name", ip)})
    machines = (meta or {}).get("machines", {})
    for ip, alias in (meta or {}).get("process_hosts", {}).items():  # services hors Docker (même hors machines)
        if alias:
            out.append({"type": "process", "name": ip, "ssh": alias, "ip": ip, "label": machines.get(ip, {}).get("name", ip)})
    npm = [dict(i, type="npm") for i in cfg.get("npm") or []]
    if not npm and cfg.get("npm_api"):
        npm = [{"type": "npm", "name": "NPM", "api": cfg["npm_api"]}]
    alerts = []
    if cfg.get("discord_webhook"):
        alerts.append({"type": "discord", "name": "alertes", "webhook": cfg["discord_webhook"], "scope": "all"})
    if cfg.get("health_webhook") and cfg.get("health_webhook") != cfg.get("discord_webhook"):
        alerts.append({"type": "discord", "name": "santé", "webhook": cfg["health_webhook"], "scope": "health"})
    if cfg.get("telegram_token") or cfg.get("telegram_chat_id"):
        alerts.append({"type": "telegram", "name": "telegram", "token": cfg.get("telegram_token", ""),
                       "chat_id": cfg.get("telegram_chat_id", "")})
    return out + npm + alerts


def instances(cfg: dict, ctx: Context | None = None, kind: str | None = None, meta: dict | None = None) -> list[Connector]:
    """Instances prêtes, filtrées par apport (kind) ; ConnectorError si un réglage est faux."""
    ctx = ctx or Context()
    out, seen = [], set()
    for conf in declared(cfg, meta):
        cls = TYPES.get(conf.get("type", ""))
        if cls is None:
            raise ConnectorError(f"connecteur « {conf.get('type')} » inconnu (types : {', '.join(sorted(TYPES))})")
        if kind is not None and kind not in cls.kinds:
            continue  # seul ce qui est demandé est validé : une alerte mal réglée n'arrête pas la collecte
        name = conf.get("name")
        if not name or (cls.type, name) in seen:
            raise ConnectorError(f"{cls.label} : chaque instance doit avoir un « name » unique")
        seen.add((cls.type, name))
        missing = cls.validate(conf)
        if missing:
            raise ConnectorError(f"{cls.label} {name} : {', '.join(missing)}")
        out.append(cls(conf, ctx))
    return out


def for_image(image: str) -> list[type[Connector]]:
    """Types qui reconnaissent cette image Docker (« jc21/nginx-proxy-manager:latest »)."""
    base = image.split("@")[0].rsplit(":", 1)[0] if ":" in image.split("/")[-1] else image.split("@")[0]
    base = base.removeprefix("docker.io/").removeprefix("library/")
    return [c for c in TYPES.values() if any(base == i or base.endswith("/" + i) for i in c.images)]
