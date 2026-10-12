#!/usr/bin/env python3
"""myservices-watcher : veille des changements de l'annuaire MyServices.

NE PROBE RIEN : lit uniquement <web_dir>/data.json, produit toutes les 30 min par
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
Usage : python3 watcher.py [--dry-run]
"""
from __future__ import annotations

import json
import os
import socket
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import notify
from config import CFG, next_timer_run

NAME = "myservices-watcher"
DATA = Path(CFG["web_dir"]) / "data.json"
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
            "hors_ligne": 3, "ssh_down": 3, "en_ligne": 0, "ssh_ok": 0, "connecteur": 2, "connecteur_ok": 0, "connecteur_version": 1}
LABEL = {"panne": "🔴 Panne", "retabli": "🟢 Rétabli", "nouveau": "🆕 Nouveau", "disparu": "➖ Disparu",
         "securite": "🛡️ Sécurité", "ui_hors": "🌐 UI sans domaine", "unhealthy": "💔 Unhealthy",
         "perime": "⏱️ Données périmées", "hors_ligne": "📴 Machine hors ligne",
         "en_ligne": "📶 Machine en ligne", "ssh_down": "🔒 SSH injoignable", "ssh_ok": "🔑 SSH rétabli",
         "dns": "🧭 DNS", "connecteur": "🔌 Connecteur en panne", "connecteur_ok": "🔌 Connecteur rétabli", "connecteur_version": "🔌 Version non testée"}
NPM_TYPES = {"proxy", "redirect", "dead", "stream"}  # entrées lues dans NPM (les autres : « local »)
DNS_LABEL = {"nom": "nom DNS invalide", "absent": "ne résout sur aucun AdGuard", "ecart": "réponses différentes selon l'AdGuard",
             "hors_lan": "garde LAN mais ne résout pas vers NPM", "bloque": "bloqué par AdGuard"}


# ---------------------------------------------------------------------------
# Lecture de data.json : même logique de statut que docs/myservices/index.html
# ---------------------------------------------------------------------------

def key(r: dict) -> str:
    return f'{r["type"]}:{r["id"]}'


def label(r: dict) -> str:
    return r["domains"][0] if r.get("domains") else (r.get("name") or f'{r.get("ip")}:{r.get("port")}')


def status(r: dict) -> str:
    """ok / warn / bad / off, calqué sur status() de la page."""
    p, b = r.get("public") or {}, r.get("backend") or {}
    if not r.get("enabled") or r.get("paused") or r.get("machine_off"):  # en pause / machine éteinte voulue : jamais signalé
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


def snapshot(r: dict) -> dict:
    s = r.get("service") or {}
    state = s.get("state") or ""
    return {
        "label": label(r),
        "type": r["type"],
        "machine": r.get("machine"),
        "target": f'{r.get("ip")}:{r.get("port")}' if r.get("ip") else r.get("target"),
        "status": status(r),
        "enabled": bool(r.get("enabled")),
        "no_acl": r["type"] == "proxy" and r.get("enabled") and not r.get("acl") and not r.get("acl_adv")
                  and not r.get("public_ok"),  # site public voulu
        "ssl_weak": r["type"] == "proxy" and r.get("enabled") and bool(r.get("ssl")) and not r.get("ssl_forced"),
        "ui_hors": r["type"] == "local" and r.get("web") == "ui" and not r.get("direct_ok"),
        "unhealthy": "(unhealthy)" in state,
        "dns": sorted(f"{c}:{d}" for c, d in (r.get("dns") or {}).get("issues", [])),
        "service": s.get("name"),
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
        out[f'rwdiff:{x["domain"]}:{x["answer"]}'] = f'réécriture {x["domain"]} → {x["answer"]} seulement sur {x["only"]}'
    for x in g.get("user_rules_diff", []):
        out[f'rulediff:{x["rule"]}'] = f'règle perso {x["rule"]} seulement sur {x["only"]}'
    for ip, v in g.get("servers", {}).items():
        if not v.get("readable"):
            out[f"unreadable:{ip}"] = f'config AdGuard illisible sur {v.get("name")} ({ip})'
    return out


def machine_snaps(data: dict) -> dict:
    """Ping et sshd par machine. ssh = None si pas d'accès SSH connu : jamais signalé."""
    out = {}
    for m in data.get("machine_list", []):
        out[f'machine:{m["ip"]}'] = {"label": m["name"], "machine": m["name"], "target": m["ip"],
                                     "ping": bool(m.get("ping")) or bool(m.get("off")) or bool(m.get("disabled")),  # éteinte voulue ou non suivie : pas d'alerte
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
            if n >= CONFIRM_RUNS:
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
    ev.sort(key=lambda e: -SEVERITY[e["kind"]])
    return ev, new_pending


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
            if n >= CONFIRM_RUNS:
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
    cur = {key(r): snapshot(r) for r in data["hosts"]}
    # Source coupée (Réglages → Sources) : ses éléments gardent leur dernier état connu, ni « disparus » à la
    # coupure, ni « nouveaux » au retour
    src = (data.get("page") or {}).get("sources") or {}
    for k, p in (state.get("snap") or {}).items():
        if k not in cur and ((src.get("npm") is False and p["type"] in NPM_TYPES)
                             or (src.get("apache") is False and str(p.get("service") or "").startswith("apache2"))):
            cur[k] = p
    baseline = "snap" not in state

    events, pending = ([], {}) if baseline else diff(state["snap"], cur, state.get("pending", {}))
    mcur = machine_snaps(data)
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
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(data["generated"])).total_seconds() / 60
    if age > STALE_MIN and not state.get("stale_reported"):
        events.insert(0, {"kind": "perime", "key": "_data", "label": "data.json", "machine": COLLECTOR,
                          "target": str(DATA), "detail": f"pas mis à jour depuis {age:.0f} min"})
    counts = {"services": len(cur), "en panne": sum(1 for c in cur.values() if c["status"] == "bad"),
              "désactivés": sum(1 for c in cur.values() if c["status"] == "off")}

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
    STATE_FILE.write_text(json.dumps({"snap": cur, "pending": pending, "history": history,
                                      "machines": mcur, "mpending": mpending, "dns": dcur,
                                      "connectors": ccur, "cpending": cpending,
                                      "stale_reported": age > STALE_MIN, "last_run": now},
                                     ensure_ascii=False), encoding="utf-8")
    print(f"✓ {EVENTS} · {info} · " + " · ".join(f"{v} {k}" for k, v in counts.items()), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
