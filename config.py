"""Configuration MyServices : config.json (à côté de ce fichier) + surcharges d'environnement.

Ordre de priorité : variable MYSERVICES_<CLÉ> > config.json > DEFAULTS.
Fichier lu : $MYSERVICES_CONFIG, sinon config.json du dossier du projet (absent = DEFAULTS).
Les chemins relatifs sont résolus depuis le dossier du projet, « ~ » est développé.
Modèle commenté : config.example.json.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

DEFAULTS = {
    "npm": [],                           # instances Nginx Proxy Manager (voir npmapi.py), une ou plusieurs
    "npm_api": "",                       # ancien format : chemin de npm-api.sh = une seule instance
    "connectors": [],                    # connecteurs v2 (voir connectors/) : [{"type", "name", …réglages}]
    "meta": "services-meta.json",        # inventaire des machines, catégories, surcharges
    "backups_meta": "backups-meta.json",  # inventaire des sauvegardes (backups.py, facultatif : absent = pas lancé)
    "web_dir": "web",                    # dossier servi par nginx : data.json et events.json y sont écrits
    "cache_dir": "~/.cache/myservices",  # caches SSH / docker du collecteur
    "state_dir": "~/.local/state/myservices",  # état du watcher (dernier passage, pannes en attente)
    "sshlist": "",                       # script sshlist optionnel (accès SSH et notes en plus de ~/.ssh/config)
    "public_url": "",                    # URL de la page, ajoutée aux notifications (vide = pas de lien)
    "collector_name": "",                # nom de la machine collectrice dans les alertes (vide = hostname)
    "discord_webhook": "",               # webhook Discord du watcher (vide = pas d'envoi)
    "health_webhook": "",                # webhook Discord de health.py (vide = discord_webhook)
    "telegram_token": "",                # jeton du bot Telegram (@BotFather), alertes du watcher et de health.py
    "telegram_chat_id": "",              # conversation Telegram qui reçoit (vide = pas d'envoi)
    "docker_cache_ttl": 7200,            # s, inventaire docker + infos machines (session SSH)
    "ssh_cache_ttl": 1800,               # s, test des méthodes d'authentification SSH
    "cache_slack": 300,                  # s, marge pour qu'un cache expire au passage suivant
    "probe_timeout": 4,                  # s, sondes TCP / HTTP
    "dns_qps": 8,                        # requêtes DNS/s par AdGuard (ratelimit AdGuard par défaut : 20/s par /24)
    "stale_min": 75,                     # min, data.json plus vieux = collecteur arrêté (alerte du watcher)
    "confirm_runs": 2,                   # passages consécutifs avant d'annoncer une panne / un rétablissement
    "retention_days": 90,                # historique du watcher
    "netscan_every": 6,                  # h, recherche réseau automatique (après une première faite à la main) ; 0 = coupée
    "netscan_nets": [],                  # recherche réseau : réseaux en CIDR (chacun /24 au plus) ; vide = celui de l'hôte
    "session_days": 14,                  # j, durée d'une session de la page (Réglages → Comptes), 1 à 90
    "netscan_ignored": [],               # recherche réseau : appareils à ne plus proposer, [{"ip": "…", "name": "…"}] (Réglages → Recherche réseau)
    "netscan_discreet": False,           # recherche réseau : ne lit ni le TTL ni l'adresse MAC (pas de système deviné par là)
    # Page web : intégrations facultatives (vide = onglet ou lien masqué)
    "health_url": "",                    # dossier health-watcher (stats.json, events.json, index) vu de la page
    "backups_url": "",                   # backups.json vu de la page : "backups.json" (backups.py) ou script externe
    "links": [],                         # liens ajoutés en tête et pied de page : [{"label": "…", "url": "…"}]
    "schedule": {},
    "sources": {},                       # sources de services activables (Réglages → Sources) : {"npm": false} ; absent = activée                      # version Docker : horaires des tâches, {"collect": "10,40 *"} (Réglages → Système)
}
PATHS = ("npm_api", "meta", "backups_meta", "web_dir", "cache_dir", "state_dir", "sshlist")


def _path(v: str) -> str:
    if not v:
        return ""
    p = Path(os.path.expanduser(v))
    return str(p if p.is_absolute() else HERE / p)


def load() -> dict:
    cfg = dict(DEFAULTS)
    f = Path(os.environ.get("MYSERVICES_CONFIG") or HERE / "config.json")
    if f.exists():
        try:
            user = json.loads(f.read_text(encoding="utf-8"))
        except ValueError as e:
            sys.exit(f"{f} illisible : {e}")
        if any(isinstance(v, (str, list, dict)) and "enc:v1:" in json.dumps(v) for v in user.values()):
            import secrets_store  # secrets chiffrés (version Docker) : déchiffrés ici, en mémoire seulement
            try:
                user = secrets_store.decrypt_all(user, f)
            except secrets_store.SecretError as e:
                sys.exit(f"{f} : {e}")
        unknown = sorted(k for k in user if k not in DEFAULTS and not k.startswith("_"))
        if unknown:
            print(f"{f} : clé(s) inconnue(s) ignorée(s) : {', '.join(unknown)}", file=sys.stderr)
        cfg.update({k: v for k, v in user.items() if k in DEFAULTS})
    for k, default in DEFAULTS.items():
        env = os.environ.get(f"MYSERVICES_{k.upper()}")
        if env is not None:
            if isinstance(default, int):
                cfg[k] = int(env)
            elif isinstance(default, list):
                cfg[k] = json.loads(env)
            else:
                cfg[k] = env
    for k in PATHS:
        cfg[k] = _path(cfg[k])
    for k in ("npm", "connectors"):  # coupés dans Réglages (« enabled »: false) : réglages gardés, rien de lu
        cfg[k] = [c for c in cfg[k] if c.get("enabled", True) is not False]
    return cfg


SOURCES = {"npm": True, "apache": True, "adguard": True, "fail2ban": False}  # défauts : Fail2ban attend son connecteur


def sources(cfg: dict) -> dict:
    """Sources activées : défauts, remplacés par « sources » de config.json."""
    return {k: bool((cfg.get("sources") or {}).get(k, v)) for k, v in SOURCES.items()}


def next_timer_run(timer: str) -> str | None:
    """Prochain déclenchement d'un timer systemd (ISO 8601), None sans systemd ou timer inactif.
    Lu par le collecteur et le watcher pendant leur passage : la page affiche le prochain sans
    connaître les horaires (choisis à l'installation)."""
    try:  # list-timers en JSON (systemd ≥ 250) : « next » en µs ; plus ancien = None, la page s'en passe
        out = subprocess.run(["systemctl", "list-timers", timer, "--all", "--output=json", "--no-pager"],
                             capture_output=True, text=True, timeout=5).stdout
        nxt = json.loads(out)[0].get("next")
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError, AttributeError):
        return None
    return datetime.fromtimestamp(nxt / 1e6, timezone.utc).isoformat(timespec="seconds") if nxt else None


CFG = load()
