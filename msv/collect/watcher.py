#!/usr/bin/env python3
"""myservices-watcher : veille des changements de l'annuaire MyServices.

NE PROBE RIEN : lit uniquement <web_dir>/data.json, produit toutes les 15 min par
myservices.py (timer systemd), et compare avec l'état du run précédent. Tout le « qu'est-ce
qui a changé » est calculé ici en Python, de façon déterministe : aucun LLM.

Événements détectés :
  panne / rétabli   un service actif passe en panne (ou revient), confirmé sur
                    CONFIRM_RUNS runs consécutifs pour ignorer les redémarrages ;
  nouveau / disparu entrée NPM ou service hors NPM qui apparaît ou disparaît ;
  sécurité          host NPM actif sans ACL (ni access list ni garde advanced_config),
                    ou SSL non forcé ;
  UI sans domaine   nouvelle interface web joignable seulement en direct ;
  unhealthy         conteneur Docker dont le healthcheck est en échec ;
  données périmées  data.json plus vieux que STALE_MIN (cron myservices.py arrêté ?) ;
  machine / SSH     machine qui ne répond plus au ping, ou sshd qui ne répond plus
                    (et retours), confirmé comme les pannes ;
  DNS               nouveau problème DNS AdGuard : nom invalide ou absent, AdGuard qui
                    divergent, host à garde LAN résolu hors NPM, nom bloqué, réécriture
                    sans host NPM, instances désynchronisées, config illisible.

Historique : RETENTION_DAYS jours, exporté dans <web_dir>/events.json (à côté de data.json)
pour l'onglet Historique de la page.

Notification : la sortie standard ne contient QUE le résumé des changements (vide s'il n'y
en a pas, journal technique sur stderr) : un cron avec MAILTO ou tout planificateur qui transmet la sortie fait office d'alerte. Webhook Discord
direct en plus si discord_webhook est renseigné (config.json ou MYSERVICES_DISCORD_WEBHOOK).
L'état est TOUJOURS sauvegardé, baseline comprise (aucune alerte au premier passage).

Réglages (config.json) : web_dir, state_dir, public_url, collector_name, discord_webhook,
confirm_runs, stale_min, retention_days.
Usage : python3 -m msv.collect.watcher [--dry-run]
"""
from __future__ import annotations

import json
import time
import os
import socket
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from msv.alerts import notify
from msv.collect import pulse
from msv.collect import recheck
from msv.core.config import CFG, next_timer_run

NAME = "myservices-watcher"
DATA = Path(CFG["web_dir"]) / "data.json"
HEALTH_STATS = Path(CFG["web_dir"]) / "health" / "stats.json"
PULSE_FILE = DATA.with_name("pulse.json")
PORTS_FILE = DATA.with_name("ports.json")
RECHECK_FILE = DATA.with_name("recheck.json")
EVENTS = Path(CFG["web_dir"]) / "events.json"  # même dossier que DATA, lu par la page
STATE_DIR = Path(CFG["state_dir"])
STATE_FILE = STATE_DIR / f"{NAME}.json"
CONFIRM_RUNS = CFG["confirm_runs"]  # runs consécutifs avant d'annoncer une panne / un rétablissement
STALE_MIN = CFG["stale_min"]        # data.json plus vieux = collecteur myservices.py en retard
HISTORY_MAX = 5000  # plafond de l'historique (en plus de la rétention)
RETENTION_DAYS = CFG["retention_days"]
COLLECTOR = CFG["collector_name"] or socket.gethostname()

SEVERITY = {"panne": 3, "unhealthy": 3, "perime": 3, "securite": 2, "ui_hors": 1,
            "nouveau": 1, "disparu": 1, "retabli": 0, "dns": 2,
            "hors_ligne": 3, "ssh_down": 3, "en_ligne": 0, "ssh_ok": 0, "connecteur": 2, "connecteur_ok": 0, "connecteur_version": 1, "appareil": 1,
            "vm_arret": 2, "vm_marche": 0, "stockage": 2, "stockage_ok": 0, "menace": 2, "nextcloud": 1, "maj_image": 1, "maj_machine": 1, "jail_hausse": 2}
LABEL = {"panne": "🔴 Panne", "retabli": "🟢 Rétabli", "nouveau": "🆕 Nouveau", "disparu": "➖ Disparu",
         "securite": "🛡️ Sécurité", "ui_hors": "🌐 UI sans domaine", "unhealthy": "💔 Unhealthy",
         "perime": "⏱️ Données périmées", "hors_ligne": "📴 Machine hors ligne",
         "en_ligne": "📶 Machine en ligne", "ssh_down": "🔒 SSH injoignable", "ssh_ok": "🔑 SSH rétabli",
         "dns": "🧭 DNS", "connecteur": "🔌 Connecteur en panne", "connecteur_ok": "🔌 Connecteur rétabli", "connecteur_version": "🔌 Version non testée",
         "appareil": "📡 Nouvel appareil", "vm_arret": "⏹️ VM arrêtée", "vm_marche": "▶️ VM en marche",
         "stockage": "💽 Stockage presque plein", "stockage_ok": "💽 Stockage dégagé", "menace": "🚨 Nouvelle menace", "nextcloud": "☁️ Nextcloud à regarder",
         "maj_image": "🐳 Image à mettre à jour", "maj_machine": "📦 Mises à jour machine", "jail_hausse": "📈 Jail qui monte"}
STORAGE_FULL = 90   # % used of a Proxmox storage
SURGE_MIN, SURGE_FACTOR = 20, 3   # a jail « goes up » from this many bans in 24 h AND this many times its usual daily number
NPM_TYPES = {"proxy", "redirect", "dead", "stream"}  # entrées lues dans NPM (les autres : « local »)
DNS_LABEL = {"nom": "nom DNS invalide", "absent": "ne résout sur aucun AdGuard", "ecart": "réponses différentes selon l'AdGuard",
             "hors_lan": "garde LAN mais ne résout pas vers NPM", "bloque": "bloqué par AdGuard"}


# ---------------------------------------------------------------------------
# Lecture de data.json : même logique de statut que docs/myservices/index.html
# ---------------------------------------------------------------------------

def key(r: dict) -> str:
    return f'{r["type"]}:{r["id"]}'


def label(r: dict) -> str:
    if r.get("display_name"):   # the name set by hand on the service page
        return r["display_name"]
    return r["domains"][0] if r.get("domains") else (r.get("name") or f'{r.get("ip")}:{r.get("port")}')


def status(r: dict) -> str:
    """ok / warn / bad / off, calqué sur status() de la page."""
    p, b = r.get("public") or {}, r.get("backend") or {}
    if not r.get("enabled") or r.get("paused") or r.get("machine_off") or r.get("stopped"):  # en pause / machine éteinte ou conteneur arrêté voulu : jamais signalé
        return "off"
    t = r["type"]
    if t == "local" and b.get("internal"):  # écoute sur une IP interne : seul l'état SSH compte
        return "ok" if b.get("up") else "off"
    if t == "dead":
        return "ok" if p.get("code") == 404 else "warn"
    if t == "redirect":
        return "ok" if p.get("code") else "bad"
    if t in ("local", "stream"):
        return "ok" if b.get("up") else "bad"
    if b.get("internal"):
        return "ok" if p.get("code") and p["code"] < 500 else "bad"
    if b.get("up") is False or (p.get("code") or 0) >= 500:
        return "bad"
    if p.get("err") and not (p["err"] == "RemoteDisconnected" and r.get("closes_root")):  # 444 voulu sur /
        return "warn"
    return "ok"


def snapshot(r: dict, ports: dict | None = None, rechecks: dict | None = None) -> dict:
    """ports: the port pulse (ports.json), fresher than the collection. rechecks: the quick second probe of the public sites (recheck.py).
    pulse: it explains the status, so it is already confirmed."""
    s = r.get("service") or {}
    state = s.get("state") or ""
    live = (ports or {}).get(pulse.port_of(r))
    if live:
        r = {**r, "backend": {**r["backend"], "up": live["ping"]}}
    again = (rechecks or {}).get(key(r))
    if again:
        r = {**r, "public": again}
    st = status(r)
    return {
        "label": label(r),
        "type": r["type"],
        "machine": r.get("machine"),
        "target": f'{r.get("ip")}:{r.get("port")}' if r.get("ip") else r.get("target"),
        "status": st,
        "pulse": (live is not None and (st == "bad") != live["ping"]) or (again is not None and st == "bad"),   # a second probe still bad: confirmed
        "enabled": bool(r.get("enabled")),
        "no_acl": r["type"] == "proxy" and r.get("enabled") and not r.get("acl") and not r.get("acl_adv")
                  and not r.get("public_ok") and not r.get("public_ignored"),  # site public voulu, ou domaine ignoré (réglage Services)
        "ssl_weak": r["type"] == "proxy" and r.get("enabled") and bool(r.get("ssl")) and not r.get("ssl_forced"),
        "ui_hors": r["type"] == "local" and r.get("web") == "ui" and not r.get("direct_ok"),
        "unhealthy": "(unhealthy)" in state,
        "dns": sorted(f"{c}:{d}" for c, d in (r.get("dns") or {}).get("issues", [])),
        "service": s.get("name"),
        "alerts": r.get("alerts"),
    }


def dns_snaps(data: dict) -> dict:
    """Problèmes DNS hors lignes NPM (réécritures AdGuard, synchro, config) : {clé: libellé}."""
    g = data.get("dns") or {}
    out = {}
    for x in g.get("orphans", []):
        out[f'orphan:{x["domain"]}'] = f'réécriture {x["domain"]} → {x["answer"]} : {x["why"]}'
    for x in g.get("invalid", []):
        out[f'invalid:{x["domain"]}'] = f'réécriture au nom invalide {x["domain"]}'
    for x in g.get("rewrites_diff", []):
        if x.get("waiting"):   # adguardhome-sync has not had its turn yet: not a warning
            continue
        out[f'rwdiff:{x["domain"]}:{x["answer"]}'] = f'réécriture {x["domain"]} → {x["answer"]} seulement sur {x["only"]}'
    for x in g.get("user_rules_diff", []):
        if x.get("waiting"):
            continue
        out[f'rulediff:{x["rule"]}'] = f'règle perso {x["rule"]} seulement sur {x["only"]}'
    for ip, v in g.get("servers", {}).items():
        if not v.get("readable"):
            out[f"unreadable:{ip}"] = f'config AdGuard illisible sur {v.get("name")} ({ip})'
    return out


def machine_snaps(data: dict, live: dict | None = None) -> dict:
    """Ping et sshd par machine. ssh = None si pas d'accès SSH connu : jamais signalé. live : le pouls (pulse.json), plus frais que
    data.json et déjà confirmé : son ping prime, sans second délai de confirmation."""
    out, live = {}, live or {}
    for m in data.get("machine_list", []):
        pl = live.get(m["ip"])
        out[f'machine:{m["ip"]}'] = {"label": m["name"], "machine": m["name"], "target": m["ip"], "pulse": pl is not None,
                                     "ping": bool(pl["ping"] if pl else m.get("ping")) or bool(m.get("off")) or bool(m.get("disabled")),  # éteinte voulue ou non suivie : pas d'alerte
                                     "ssh": (m["ssh"].get("methods") is not None) if m.get("ssh") else None}
    return out


# ---------------------------------------------------------------------------
# Comparaison avec le run précédent
# ---------------------------------------------------------------------------

def diff(prev: dict, cur: dict, pending: dict) -> tuple[list[dict], dict]:
    """Événements entre deux snapshots + nouveau compteur de confirmation des pannes."""
    ev, new_pending = [], {}

    def add(kind, k, snap, detail):
        ev.append({"kind": kind, "key": k, "label": snap["label"], "machine": snap.get("machine"),
                   "target": snap.get("target"), "detail": detail})

    for k, c in cur.items():
        p = prev.get(k)
        if p is None:
            add("nouveau", k, c, f'{c["type"]} · {c.get("service") or "service non identifié"}')
            continue
        # Pannes / rétablissements : l'état doit tenir CONFIRM_RUNS runs de suite
        was_bad, is_bad = p["status"] == "bad", c["status"] == "bad"
        if c["enabled"] and was_bad != is_bad:
            n = pending.get(k, 0) + 1
            if n >= (1 if c.get("pulse") else CONFIRM_RUNS):
                add("panne" if is_bad else "retabli", k, c,
                    "injoignable ou erreur 5xx" if is_bad else "de nouveau joignable")
            else:
                new_pending[k] = n
                c["status"] = p["status"]  # on garde l'ancien état tant que non confirmé
        for flag, kind, detail in (("no_acl", "securite", "host NPM actif sans ACL"),
                                   ("ssl_weak", "securite", "SSL disponible mais non forcé"),
                                   ("ui_hors", "ui_hors", "interface web sans host NPM"),
                                   ("unhealthy", "unhealthy", "healthcheck Docker en échec")):
            if c[flag] and not p.get(flag):
                add(kind, k, c, detail)
        if "dns" in p:  # champ ajouté le 2026-10-08 : pas d'alerte au premier passage
            for x in c["dns"]:
                if x not in p["dns"]:
                    code, dom = x.split(":", 1)
                    add("dns", k, c, f"{dom} : {DNS_LABEL.get(code, code)}")
    for k, p in prev.items():
        if k not in cur:
            add("disparu", k, p, f'{p["type"]} retiré')
    ev = [e for e in ev if wanted(e, cur.get(e["key"]) or prev.get(e["key"]) or {})]
    ev.sort(key=lambda e: -SEVERITY[e["kind"]])
    return ev, new_pending


OUTAGE = ("panne", "retabli")


def wanted(e: dict, snap: dict) -> bool:
    """The alerts level set on the service page: « none » keeps no event of it, « down » only its outages and returns."""
    level = snap.get("alerts")
    return level != "none" and (level != "down" or e["kind"] in OUTAGE)


def diff_machines(prev: dict, cur: dict, pending: dict) -> tuple[list[dict], dict]:
    """Machine hors ligne / SSH injoignable (et retours), confirmés sur CONFIRM_RUNS runs."""
    ev, new_pending = [], {}
    for k, c in cur.items():
        p = prev.get(k)
        if p is None:
            continue  # machine ajoutée à services-meta.json : pas un événement réseau
        for flag, down, up, d_down, d_up in (("ping", "hors_ligne", "en_ligne", "ne répond plus au ping", "répond de nouveau au ping"),
                                             ("ssh", "ssh_down", "ssh_ok", "sshd ne répond plus", "sshd répond de nouveau")):
            if c[flag] is None or p.get(flag) is None or c[flag] == p[flag]:
                continue
            pk = f"{k}:{flag}"
            n = pending.get(pk, 0) + 1
            if n >= (1 if flag == "ping" and c.get("pulse") else CONFIRM_RUNS):   # a pulse is already confirmed
                ev.append({"kind": up if c[flag] else down, "key": k, "label": c["label"], "machine": c["machine"],
                           "target": c["target"], "detail": d_up if c[flag] else d_down})
            else:
                new_pending[pk] = n
                c[flag] = p[flag]
    return ev, new_pending


def connector_snaps(data: dict) -> dict:
    """État de chaque connecteur lu par le collecteur (data.json « connectors ») : True = lu."""
    return {f'connecteur:{c["type"]}/{c["name"]}': {"label": f'{c["type"]} {c["name"]}', "ok": bool(c.get("ok")),
                                                     "detail": c.get("message", ""), "version": c.get("version"),
                                                     "tested": c.get("version_tested")}
            for c in data.get("connectors", [])}


def network_snaps(data: dict) -> dict:
    """Devices seen by the network tools (MynetworK) and not followed here, keyed by MAC (an IP handed out again by DHCP is not a new
    device), else by IP."""
    followed = {m["ip"] for m in data.get("machine_list", [])}
    out = {}
    for c in data.get("network") or []:
        for d in c.get("devices") or []:
            if not d.get("ip") or d["ip"] in followed:
                continue
            out[f'appareil:{d.get("mac") or d["ip"]}'] = {"label": d.get("hostname") or d.get("vendor") or d["ip"], "target": d["ip"],
                                                          "detail": " · ".join(x for x in (d["ip"], d.get("mac"), d.get("vendor")) if x)}
    return out


def virt_snaps(data: dict) -> dict:
    """Proxmox guests (running or not) and storages (full or not), from data.json « virtualization » (connector or SSH)."""
    out = {}
    for c in data.get("virtualization") or []:
        if c.get("connector") not in ("proxmox", "esxi", "vcenter") or not c.get("ok") or c.get("stale"):
            continue   # host not read this time: no « stopped » for all its guests
        for g in c.get("guests") or []:
            if not g.get("template") and g.get("vmid") is not None:
                out[f'vm:{g.get("node")}/{g["vmid"]}'] = {"label": g.get("name") or str(g["vmid"]), "machine": g.get("node"),
                                                          "target": f'{"CT" if g.get("type") == "lxc" else "VM"} {g["vmid"]}', "up": g.get("status") == "running"}
        for st in c.get("storage") or []:
            if st.get("used_pct") is not None:
                out[f'stockage:{st.get("node")}/{st.get("name")}'] = {"label": st.get("name"), "machine": st.get("node"), "target": None,
                                                                      "up": st["used_pct"] < STORAGE_FULL, "pct": st["used_pct"]}
    return out


def diff_virt(prev: dict, cur: dict, pending: dict) -> tuple[list[dict], dict]:
    """Guest stopped / started again and storage filling past STORAGE_FULL % / freed, confirmed on CONFIRM_RUNS runs. A guest that
    appears or goes away (created, deleted, host not read) is not an event."""
    ev, new_pending = [], {}
    for k, c in cur.items():
        p = prev.get(k)
        if p is None or c["up"] == p["up"]:
            continue
        n = pending.get(k, 0) + 1
        if n < CONFIRM_RUNS:
            new_pending[k] = n
            c["up"] = p["up"]
            continue
        vm = k.startswith("vm:")
        kind = ("vm_marche" if c["up"] else "vm_arret") if vm else ("stockage_ok" if c["up"] else "stockage")
        detail = ("de nouveau en marche" if c["up"] else "arrêtée alors qu'elle tournait") if vm else f'rempli à {c["pct"]:g} %'
        ev.append({"kind": kind, "key": k, "label": c["label"], "machine": c["machine"], "target": c["target"], "detail": detail})
    return ev, new_pending


def threat_snaps(data: dict) -> dict | None:
    """Active threats read by LogviewR (attack correlation: one IP across jails, or a campaign from one AS). None: no LogviewR read
    this time (cut or failing), the known ones are kept."""
    rows = [c for c in data.get("security") or [] if c.get("ok") and not c.get("stale")]
    if not rows:
        return None
    out = {}
    for c in rows:
        for t in c.get("threats") or []:
            what = "IP qui passe d'un jail à l'autre" if t.get("kind") == "ip_escalation" else f"campagne depuis {t.get('asn') or 'un même réseau'}"
            out[f'menace:{c.get("name")}:{t.get("key")}'] = {
                "label": ", ".join(t.get("ips") or [])[:80] or "?", "target": ", ".join(t.get("jails") or []) or None,
                "detail": f'{what} : {t.get("ip_count")} IP, {t.get("bans") or "?"} bannissement(s) (LogviewR)'}
    return out


def nextcloud_snaps(data: dict) -> dict | None:
    """Points to look at of each Nextcloud (update, app update, public links without password, low space, debug), by stable key.
    None: no Nextcloud read this time (cut or failing), the known points are kept."""
    rows = [c for c in data.get("services_status") or [] if c.get("connector") == "nextcloud" and c.get("ok") and not c.get("stale")]
    if not rows:
        return None
    return {f'nextcloud:{c.get("name")}:{x["key"]}': {"label": c.get("name") or "Nextcloud", "text": x.get("text") or ""}
            for c in rows for x in c.get("checks") or [] if isinstance(x, dict) and x.get("key")}


def diff_points(kind: str, prev: dict | None, cur: dict | None) -> tuple[list[dict], dict | None]:
    """One event of `kind` when a point appears; none while it stays, none when it goes (it can come back as a new one). The first reading is the
    reference; cur None (the tool was not read this time) keeps what was known."""
    if cur is None:
        return [], prev
    if prev is None:
        return [], cur
    return [{"kind": kind, "key": k, "label": v["label"], "machine": v.get("machine"), "target": v.get("target"), "detail": v["text"]}
            for k, v in cur.items() if k not in prev], cur


def diff_nextcloud(prev: dict | None, cur: dict | None) -> tuple[list[dict], dict | None]:
    return diff_points("nextcloud", prev, cur)


def _image_updates(c: dict):
    """(environment, container name, image) of every container of the tool `c` that has a newer image."""
    for env in c.get("environments") or []:
        for u in env.get("updates") or []:
            name = str(u.get("container") or "")[:80]
            if name:
                yield env, name, str(u.get("image") or "")[:120]


def image_snaps(data: dict) -> dict | None:
    """Container images with a newer version (Dockhand, Dozzle, Portainer…), by stable key. None: no container tool read this time."""
    rows = [c for c in data.get("containers") or [] if c.get("ok") and not c.get("stale") and not c.get("links_only")]
    if not rows:
        return None
    return {f'maj_image:{c.get("name")}:{env.get("id")}:{name}': {
                "label": name, "machine": env.get("name") or env.get("host"), "target": image or None,
                "text": f"une version plus récente de l'image {image} est disponible" if image else "une version plus récente de l'image est disponible"}
            for c in rows for env, name, image in _image_updates(c)}


def _update_text(apt: dict) -> str:
    n, security = apt["upgradable"], apt.get("security")
    text = f"{n} mise(s) à jour en attente" + (f", dont {security} de sécurité" if security else "")
    sample = ", ".join(str(s)[:60] for s in (apt.get("sample") or [])[:5])
    return f"{text} : {sample}" if sample else text


def machine_update_snaps(hosts: list[dict] | None, prev: dict | None) -> dict | None:
    """Machines with pending system updates, by stable key. A machine not read this time keeps what was known: its return must not count as new.
    None: no health report yet."""
    if hosts is None:
        return None
    known, out = prev or {}, {}
    for h in hosts:
        key, apt = f'maj_machine:{h.get("id")}', h.get("apt") or {}
        if not h.get("reachable") or apt.get("available") is False:
            if key in known:
                out[key] = known[key]
        elif apt.get("upgradable"):
            name, _, ip = str(h.get("name") or h.get("id")).partition(" · ")
            out[key] = {"label": name, "machine": name, "target": ip or None, "text": _update_text(apt)}
    return out


def health_hosts() -> list[dict] | None:
    try:
        return json.loads(HEALTH_STATS.read_text(encoding="utf-8")).get("hosts")
    except (OSError, ValueError):
        return None


def jail_surge_snaps(data: dict) -> dict | None:
    """Fail2ban jails whose last 24 hours are far above their usual (statistics read by LogviewR): at least SURGE_MIN bans and SURGE_FACTOR times the
    average of the six days before. None: no statistics read this time."""
    rows = [c for c in data.get("security") or [] if c.get("ok") and not c.get("stale") and c.get("stats")]
    if not rows:
        return None
    out = {}
    for c in rows:
        for j in c["stats"].get("by_jail") or []:
            d1, d7 = j.get("d1") or 0, j.get("d7") or 0
            usual = max(1.0, (d7 - d1) / 6)
            if d1 >= SURGE_MIN and d1 >= SURGE_FACTOR * usual:
                out[f'jail_hausse:{c.get("name")}:{j.get("jail")}'] = {
                    "label": str(j.get("jail"))[:40], "machine": None, "target": c.get("name"),
                    "text": f"{d1} bannissement(s) en 24 h, contre {usual:.0f} par jour d'habitude (LogviewR)"}
    return out


def diff_threats(prev: dict | None, cur: dict | None) -> tuple[list[dict], dict | None]:
    """« New threat » once per cluster ; the first reading of LogviewR is the reference. A threat no longer active is forgotten after
    a week (kept meanwhile so that it does not come back as new)."""
    if cur is None:
        return [], prev
    if prev is None:
        return [], {k: {**v, "seen": time.time()} for k, v in cur.items()}
    now = time.time()
    ev = [{"kind": "menace", "key": k, "label": v["label"], "machine": None, "target": v["target"], "detail": v["detail"]}
          for k, v in cur.items() if k not in prev]
    keep = {k: v for k, v in prev.items() if now - v.get("seen", now) < 7 * 86400}
    return ev, {**keep, **{k: {**v, "seen": now} for k, v in cur.items()}}


def diff_network(prev: dict | None, cur: dict | None) -> tuple[list[dict], dict | None]:
    """« New device » events and the devices to remember. cur None: no network tool read this time (cut or failing), what was known
    is kept. prev None: first reading of a network tool, taken as the reference (no flood of « new »). Devices are never forgotten:
    one gone from the list then back is not new again."""
    if cur is None:
        return [], prev
    if prev is None:
        return [], cur
    ev = [{"kind": "appareil", "key": k, "label": v["label"], "machine": None, "target": v["target"],
           "detail": f'vu par MynetworK : {v["detail"]}'} for k, v in cur.items() if k not in prev]
    return ev, {**prev, **cur}


def diff_connectors(prev: dict, cur: dict, pending: dict) -> tuple[list[dict], dict]:
    """Connecteur qui ne lit plus son service (API changée, compte refusé, injoignable) et retour,
    confirmés sur CONFIRM_RUNS runs. Un connecteur ajouté ou retiré n'est pas un événement."""
    ev, new_pending = [], {}
    for k, c in cur.items():
        p = prev.get(k)
        # Le service est passé dans une version que MyServices n'a pas testée (son API a pu changer) : à surveiller, une fois
        if p and c["ok"] and c.get("version") and p.get("version") not in (None, c["version"]) and c.get("tested") is False:
            ev.append({"kind": "connecteur_version", "key": k, "label": c["label"], "machine": COLLECTOR, "target": None,
                       "detail": f'version {c["version"]} (avant : {p["version"]}), pas encore testée : à surveiller'})
        if p is None or c["ok"] == p["ok"]:
            continue
        n = pending.get(k, 0) + 1
        if n >= CONFIRM_RUNS:
            ev.append({"kind": "connecteur_ok" if c["ok"] else "connecteur", "key": k, "label": c["label"],
                       "machine": COLLECTOR, "target": None, "detail": "lit de nouveau son service" if c["ok"] else c["detail"]})
        else:
            new_pending[k] = n
            c["ok"] = p["ok"]
    return ev, new_pending


def prune(history: list[dict], now_dt: datetime) -> list[dict]:
    """Rétention RETENTION_DAYS jours (les anciens événements n'ont que « at », heure locale)."""
    keep = []
    for e in history:
        try:
            t = datetime.fromisoformat(e["ts"]) if e.get("ts") else datetime.strptime(e["at"], "%Y-%m-%d %H:%M").astimezone()
        except (KeyError, ValueError):
            continue
        if (now_dt - t).days < RETENTION_DAYS:
            keep.append(e)
    return keep[:HISTORY_MAX]


# ---------------------------------------------------------------------------
# État, sorties, notification
# ---------------------------------------------------------------------------

def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def message(events: list[dict], now: str) -> str:
    """Résumé court (≤ 1900 car.) : sortie standard (planificateur) et/ou webhook."""
    lines = [f"**MyServices** · {len(events)} changement(s) · {now}"]
    for e in events[:15]:
        lines.append(f'{LABEL[e["kind"]]} `{e["label"]}` ({e.get("machine") or "?"}) : {e["detail"]}')
    if len(events) > 15:
        lines.append(f"… et {len(events) - 15} autre(s)")
    if CFG["public_url"]:
        lines.append(CFG["public_url"].rstrip("/") + "/#historique")
    return "\n".join(lines)[:1900]


def notify_discord(text: str) -> str:
    url = CFG["discord_webhook"]
    if not url:
        return "pas de webhook Discord (discord_webhook vide)"
    body = json.dumps({"content": text}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json",
                                                           "User-Agent": NAME})
    try:
        urllib.request.urlopen(req, timeout=10).close()
        return "notification Discord envoyée"
    except OSError as e:
        return f"échec notification Discord : {e}"


def main() -> int:
    dry = "--dry-run" in sys.argv
    now_dt = datetime.now().astimezone()
    now = now_dt.strftime("%Y-%m-%d %H:%M")

    data = load_json(DATA, None)
    if data is None:
        print(f"✗ {DATA} illisible", file=sys.stderr)
        return 1
    state = load_json(STATE_FILE, {})
    ports = pulse.read(PORTS_FILE)
    rechecks = recheck.read(RECHECK_FILE, data.get("generated"))
    cur = {key(r): snapshot(r, ports, rechecks) for r in data["hosts"]}
    # Source coupée (Réglages → Sources) : ses éléments gardent leur dernier état connu, ni « disparus » à la
    # coupure, ni « nouveaux » au retour
    src = (data.get("page") or {}).get("sources") or {}
    for k, p in (state.get("snap") or {}).items():
        if k not in cur and ((src.get("npm") is False and p["type"] in NPM_TYPES)
                             or (src.get("apache") is False and str(p.get("service") or "").startswith("apache2"))):
            cur[k] = p
    baseline = "snap" not in state

    events, pending = ([], {}) if baseline else diff(state["snap"], cur, state.get("pending", {}))
    mcur = machine_snaps(data, pulse.read(PULSE_FILE))
    if "machines" in state:  # baseline machines à part : ajoutée après le premier déploiement
        mev, mpending = diff_machines(state["machines"], mcur, state.get("mpending", {}))
        events = sorted(mev + events, key=lambda e: -SEVERITY[e["kind"]])
    else:
        mpending = {}
    ccur = connector_snaps(data)
    if "connectors" in state:  # même principe que les machines : référence au premier passage
        cev, cpending = diff_connectors(state["connectors"], ccur, state.get("cpending", {}))
        events = sorted(cev + events, key=lambda e: -SEVERITY[e["kind"]])
    else:
        cpending = {}
    dcur = dns_snaps(data) if src.get("adguard") is not False else state.get("dns", {})
    if "dns" in state:  # même principe que les machines : baseline au premier passage
        events += [{"kind": "dns", "key": "_dns", "label": "AdGuard", "machine": None, "target": k, "detail": v}
                   for k, v in dcur.items() if k not in state["dns"]]
        events.sort(key=lambda e: -SEVERITY[e["kind"]])
    vcur = virt_snaps(data)
    if "virt" in state:   # reference on the first run, like the machines
        vev, vpending = diff_virt(state["virt"], vcur, state.get("vpending", {}))
        events = sorted(vev + events, key=lambda e: -SEVERITY[e["kind"]])
    else:
        vpending = {}
    vcur = {**(state.get("virt") or {}), **vcur}   # a host not read this time keeps the last known state of its guests
    tev, tcur = diff_threats(state.get("threats"), threat_snaps(data))
    xev, xcur = diff_nextcloud(state.get("nextcloud"), nextcloud_snaps(data))
    iev, icur = diff_points("maj_image", state.get("images"), image_snaps(data))
    uev, ucur = diff_points("maj_machine", state.get("machine_updates"), machine_update_snaps(health_hosts(), state.get("machine_updates")))
    jev, jcur = diff_points("jail_hausse", state.get("jails_up"), jail_surge_snaps(data))
    events = sorted(tev + xev + iev + uev + jev + events, key=lambda e: -SEVERITY[e["kind"]])
    nev, ncur = diff_network(state.get("network"), network_snaps(data) if data.get("network") else None)
    events = sorted(nev + events, key=lambda e: -SEVERITY[e["kind"]])
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(data["generated"])).total_seconds() / 60
    if age > STALE_MIN and not state.get("stale_reported"):
        events.insert(0, {"kind": "perime", "key": "_data", "label": "data.json", "machine": COLLECTOR,
                          "target": str(DATA), "detail": f"pas mis à jour depuis {age:.0f} min"})
    counts = {"services": len(cur), "en panne": sum(1 for c in cur.values() if c["status"] == "bad"),
              "désactivés": sum(1 for c in cur.values() if c["status"] == "off")}

    # A run between two collections (started by the pulse) sees the same data.json as the one before: only the ping of the machines and
    # the port of the services can have moved. What needs two collections to be confirmed (services, connectors, SSH...) must not count the same one twice.
    same_gen = state.get("gen") == data.get("generated") and "snap" in state
    if same_gen:
        moved = {e["key"] for e in events if e["kind"] in OUTAGE and (cur.get(e["key"]) or {}).get("pulse")}
        events = [e for e in events if e["key"] in moved or (str(e["key"]).startswith("machine:") and e["kind"] in ("hors_ligne", "en_ligne"))]
        for k, c in mcur.items():
            c["ssh"] = ((state.get("machines") or {}).get(k) or c).get("ssh", c["ssh"])
        mpending = {**state.get("mpending", {}), **{k: v for k, v in mpending.items() if not k.endswith(":ping")}}
        cur = {**state["snap"], **{k: cur[k] for k in moved}}
        pending, ccur, cpending = state.get("pending", {}), state.get("connectors", ccur), state.get("cpending", {})
        dcur, vcur, vpending = state.get("dns", dcur), state.get("virt", vcur), state.get("vpending", {})
        tcur, xcur, ncur = state.get("threats", tcur), state.get("nextcloud", xcur), state.get("network", ncur)
        icur, jcur, ucur = state.get("images", icur), state.get("jails_up", jcur), state.get("machine_updates", ucur)

    if dry:
        print(f"=== DRY RUN (baseline={baseline}) · {len(events)} événement(s) ===")
        for e in events:
            print(f'  {LABEL[e["kind"]]:<20} {e["label"]:<34} {e["detail"]}')
        return 0

    for e in events:
        e["at"], e["ts"] = now, now_dt.isoformat(timespec="seconds")
    history = prune(events + state.get("history", []), now_dt)
    info = "baseline initialisée (aucune alerte au 1er run)" if baseline else f"{len(events)} changement(s)"
    if events:
        if not baseline and os.environ.get("MYSERVICES_ALERTS_ENGINE") == "1":
            info += " · envoi par Réglages → Alertes"
        elif not baseline:
            text = message(events, now)
            print(text)  # stdout = message livré par le planificateur (mail cron, journal systemd…)
            info += " · " + notify_discord(text)
            if notify.telegram_on():
                info += " · " + notify.send_telegram(text)[1]
    EVENTS.write_text(json.dumps({"generated": now_dt.isoformat(timespec="seconds"),
                                                     "next_run": next_timer_run("myservices-watcher.timer"),
                                                     "retention_days": RETENTION_DAYS, "labels": LABEL,
                                                     "severity": SEVERITY, "events": history},
                                                    ensure_ascii=False), encoding="utf-8")
    # Sauvegarde SYSTÉMATIQUE, baseline comprise (cf bug secu-watcher du 2026-09-12)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"snap": cur, "pending": pending, "history": history,  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
                                      "machines": mcur, "mpending": mpending, "dns": dcur,
                                      "connectors": ccur, "cpending": cpending, "network": ncur, "virt": vcur, "vpending": vpending, "threats": tcur, "nextcloud": xcur, "images": icur, "machine_updates": ucur, "jails_up": jcur,
                                      "stale_reported": state.get("stale_reported", False) if same_gen else age > STALE_MIN,
                                      "gen": data.get("generated"), "last_run": now},
                                     ensure_ascii=False), encoding="utf-8")
    print(f"✓ {EVENTS} · {info} · " + " · ".join(f"{v} {k}" for k, v in counts.items()), file=sys.stderr)
    return 0


if __name__ == "__main__":
    from msv.core import app_user
    app_user.drop_root()   # docker compose exec : root -> compte 10001 (sa config SSH, fichiers de /data restés à lui)
    sys.exit(main())
