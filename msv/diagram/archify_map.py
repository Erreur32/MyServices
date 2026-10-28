#!/usr/bin/env python3
"""Cartes de l'infra au format Archify (diagrammes d'architecture), générées depuis les fichiers de la page.

  python3 -m msv.diagram.archify_cli [web_dir] [dossier de sortie] [schémas proposés à créer, séparés par des virgules]
  node <archify>/bin/archify.mjs deliver architecture <dossier>/carte.archify.json carte.html --json

carte.archify.json (data.json, + health/stats.json s'il existe) : Internet, chaque instance NPM et AdGuard,
chaque machine (en ligne ou non, niveau de santé en icône et en étiquette). Liaisons : NPM -> machines qu'il
publie (nombre de hosts), AdGuard -> NPM (réécritures DNS). Encadré : machines dont la santé n'est pas OK.
acces.archify.json : comment chaque machine est lue (SSH avec compte et port, agent, ou aucun accès).
alertes.archify.json (si alerts-summary.json existe, écrit par server.py) : collecte -> historique -> alertes / notifications -> canaux.
Un schéma dont la spécification n'a pas changé n'est pas listé (donc pas regénéré).
sauvegardes.archify.json (seulement si backups.json existe) : machines de backups-meta.json, liaisons
origine -> machine qui garde une copie (nombre de jeux, âge de la plus récente). Encadré : points d'attention.
Placement en grille sans croisement. Aucune donnée secrète : noms, IP, niveaux et comptes seulement.
"""
from __future__ import annotations

import ipaddress
import json
import re
import sys
from collections import Counter
from pathlib import Path


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "x"


W, H = 230, 74  # taille d'un bloc : libellés courts, lisibles au minimum de 6 px
MAX_COLS = 12  # limite du schéma Archify
# Niveau (santé, sauvegardes) -> icône de coin et mot de l'étiquette
ICON = {"ok": "success", "warn": "waiting", "crit": "failure", "down": "failure"}
WORD = {"ok": "OK", "warn": "à surveiller", "crit": "critique", "down": "injoignable"}


def place(comps: list[dict], targets: list[str]) -> int:
    """Grille sans croisement : Internet en haut, NPM au centre avec un AdGuard de chaque côté, puis les
    machines publiées par NPM (une ligne, sous NPM), puis les autres machines (sans liaison). Rend la
    largeur en colonnes."""
    by = {c["id"]: c for c in comps}
    dns = [c for c in comps if c["id"].startswith("dns_")]
    npm = [c for c in comps if c["id"].startswith("npm_")]
    rest = [c for c in comps if c["id"].startswith("m_") and c["id"] not in targets]
    cols = max(len(targets), 2 * len(dns) + len(npm), 3, min(len(rest), 6))
    mid = cols // 2
    by["internet"].update(row=0, col=mid)
    for i, c in enumerate(npm):
        c.update(row=1, col=mid + i)
    for i, c in enumerate(dns):  # alternés à gauche et à droite du NPM : leurs liaisons ne se croisent pas
        c.update(row=1, col=mid - 1 - i // 2 if i % 2 == 0 else mid + len(npm) + i // 2)
    start = (cols - len(targets)) // 2
    for i, cid in enumerate(targets):
        by[cid].update(row=2, col=start + i)
    for i, c in enumerate(rest):
        c.update(row=3 + i // cols, col=i % cols)
    for c in comps:
        c["size"] = [W, H]
    return cols


def health_by_ip(stats: dict | None) -> dict:
    """Machines de health/stats.json par IP (leur nom est « Nom · IP »)."""
    return {h["name"].rsplit(" · ", 1)[-1]: h for h in (stats or {}).get("hosts", [])}


def health_note(h: dict) -> str:
    """« Nom : critique (disque 93 %) » pour l'encadré santé."""
    full = max((d.get("used_pct", 0) for d in h.get("disks", []) if d.get("warning") or d.get("critical")), default=None)
    return f"{h['name'].rsplit(' · ', 1)[0]} : {WORD.get(h['level'], h['level'])}" + (f" (disque {full} %)" if full else "")


def build(data: dict, health: dict | None = None) -> dict:
    machines = {m["ip"]: m for m in data.get("machine_list", [])}
    hb = health_by_ip(health)
    comps, conns = [{"id": "internet", "type": "external", "label": "Internet", "sublabel": "accès publics"}], []
    npm_ips = data.get("npm_instances") or {}
    for name, ip in npm_ips.items():
        comps.append({"id": f"npm_{slug(name)}", "type": "security", "label": name if name.upper().startswith("NPM") else f"NPM {name}",
                      "sublabel": ip or "proxy inverse"})
        conns.append({"from": "internet", "to": f"npm_{slug(name)}"})
    for ip, s in ((data.get("dns") or {}).get("servers") or {}).items():
        cid = f"dns_{slug(ip)}"
        comps.append({"id": cid, "type": "cloud", "label": f"AdGuard {s.get('name', ip)}",
                      "sublabel": ip})
        for name in npm_ips:
            conns.append({"from": cid, "to": f"npm_{slug(name)}", "label": "DNS", "variant": "dashed"})
    per_machine = Counter((h.get("npm"), h.get("host_ip") or h.get("ip")) for h in data.get("hosts", [])
                          if h.get("type") in ("proxy", "redirect") and h.get("enabled"))
    for ip, m in sorted(machines.items(), key=lambda x: ipaddress.ip_address(x[0])):
        cid = f"m_{slug(ip)}"
        state = "éteinte" if m.get("off") else "en ligne" if m.get("ping") else "hors ligne"
        comps.append(with_level({"id": cid, "type": "database" if m.get("gateway") else "backend", "label": m["name"][:22],
                                 "sublabel": f"{ip} · {state}"}, hb.get(ip, {}).get("level"), "santé "))
    targets = []
    for (npm, ip), n in sorted(per_machine.items(), key=lambda x: -x[1]):
        if npm in npm_ips and ip in machines:
            conns.append({"from": f"npm_{slug(npm)}", "to": f"m_{slug(ip)}", "label": f"{n} hosts", "route": "orthogonal-v"})
            targets.append(f"m_{slug(ip)}")
    cols = place(comps, targets)
    spec = diagram("Carte du réseau", data.get("generated", ""), "carte.html", cols, comps, conns)
    bad = sorted((h for h in hb.values() if h.get("level") in ("warn", "crit", "down")),
                 key=lambda h: ("down", "crit", "warn").index(h["level"]))
    if bad:
        spec["cards"] = [alert_card("Santé à regarder", [h["level"] for h in bad], [health_note(h) for h in bad])]
    return spec


def alert_card(title: str, levels: list[str], items: list[str]) -> dict:
    """Encadré sous la carte : rouge s'il y a du critique ou de l'injoignable, orange sinon."""
    return {"dot": "rose" if {"crit", "down"} & set(levels) else "amber", "title": title, "items": items}


def with_level(c: dict, level: str | None, tag: str) -> dict:
    """Composant marqué de son niveau (icône de coin, étiquette) ; inchangé sans niveau connu."""
    if level in ICON:
        c.update(icon=ICON[level], tag=tag + WORD[level])
    return c


def diagram(title: str, generated: str, output: str, cols: int, comps: list, conns: list) -> dict:
    return {
        "schema_version": 1, "diagram_type": "architecture",
        "layout": {"mode": "grid", "cols": cols, "cellW": W, "cellH": H, "gapX": 40, "gapY": 90},
        "meta": {"title": title, "subtitle": f"MyServices · {generated[:16].replace('T', ' ')}",
                 "output": output, "quality_profile": "standard"},
        "components": comps,
        "connections": conns,
    }


def age(days: float | None) -> str:
    if days is None:
        return "jamais"
    return f"{max(1, round(days * 24))} h" if days < 1 else f"{days:.0f} j"


def build_backups(bk: dict) -> dict:
    """Machines de sauvegarde : celles qui produisent des jeux en haut, celles qui ne font que garder des
    copies (NAS, stockage) en dessous ; une liaison par couple origine -> copie."""
    hosts = bk.get("hosts", [])
    comps, conns, holders = [], [], set()
    for h in hosts:
        for cp in h.get("copies", []):
            holders.add(cp["host"])
            conns.append({"from": f"b_{slug(h['id'])}", "to": f"b_{slug(cp['host'])}",
                          "label": f"{cp['sets']} jeu{'x' if cp['sets'] > 1 else ''} · {age(cp.get('age'))}",
                          "route": "orthogonal-v", **({"variant": "dashed"} if cp.get("level") != "ok" else {})})
    sources = [h for h in hosts if h.get("sets")]
    # Stockages rangés sous la moyenne de leurs producteurs : moins de liaisons croisées
    pos = {h["id"]: i for i, h in enumerate(sources)}
    feeders = {h["id"]: [pos[s["id"]] for s in sources for cp in s.get("copies", []) if cp["host"] == h["id"]] for h in hosts}
    others = sorted((h for h in hosts if not h.get("sets")),
                    key=lambda h: sum(feeders[h["id"]]) / len(feeders[h["id"]]) if feeders[h["id"]] else len(sources))
    cols = min(max(len(sources), len(others), 1), MAX_COLS)
    first_row = 0
    for group in (sources, others):
        start = (cols - len(group)) // 2 if len(group) < cols else 0
        for i, h in enumerate(group):
            last = h.get("last_local")
            role = f"dernier {age(last['age'])}" if last else "stockage" if h["id"] in holders or h.get("storage") else ""
            comps.append(with_level({"id": f"b_{slug(h['id'])}", "type": "backend" if h.get("sets") else "database",
                                     "label": h["label"][:22], "sublabel": " · ".join(x for x in (h.get("ip"), role) if x) or "machine",
                                     "row": first_row + i // cols, "col": start + i % cols, "size": [W, H]}, h.get("level"), ""))
        first_row += -(-len(group) // cols) + 1  # une ligne vide entre producteurs et stockages
    ids = {c["id"] for c in comps}
    conns = [c for c in conns if c["from"] in ids and c["to"] in ids]  # copie vers une machine hors liste : ignorée
    if not comps:
        comps.append({"id": "aucune", "type": "external", "label": "Aucune machine", "row": 0, "col": 0, "size": [W, H]})
    spec = diagram("Carte des sauvegardes", bk.get("generated", ""), "sauvegardes.html", cols, comps, conns)
    issues = bk.get("issues", [])
    if issues:
        spec["cards"] = [alert_card("Sauvegardes à regarder", [i["level"] for i in issues],
                                    [f"{i['set']} : {i['text']}" for i in issues[:8]]
                                    + ([f"… et {len(issues) - 8} autre(s)"] if len(issues) > 8 else []))]
    return spec


CONNECTOR_LABEL = {"docker": "Docker", "process": "Ports", "npm": "NPM", "adguard": "AdGuard", "beszel": "Beszel", "uptime-kuma": "Uptime Kuma",
                   "dozzle": "Dozzle", "web-check": "Web-Check", "home-assistant": "Home Assistant", "mynetwork": "MynetworK", "logviewr": "LogviewR",
                   "dockhand": "Dockhand", "proxmox": "Proxmox VE", "proxmox-backup": "Proxmox Backup", "veeam": "Veeam", "discord": "Discord", "telegram": "Telegram"}


def grid(comps: list[dict], first_row: int, cols: int) -> int:
    """Range les composants (sans position) en lignes de `cols` colonnes à partir de `first_row`, centrés ; rend la ligne suivante."""
    for i in range(0, len(comps), cols):
        row = comps[i:i + cols]
        start = (cols - len(row)) // 2
        for j, c in enumerate(row):
            c.update(row=first_row + i // cols, col=start + j, size=[W, H])
    return first_row + -(-len(comps) // cols)


PER_GROUP = 12                                # éléments dessinés par groupe (le reste est dans un encadré du dessous)
CARD_MAX = 30                                 # lignes d'un encadré « suite »


def grouped(title: str, generated: str, output: str, hub: dict | None, groups: list[dict], per_group: int = PER_GROUP) -> dict:
    """Schéma « groupes sous un point central » : un bloc par groupe sur une ligne, dessous ses éléments dans un cadre, sans croisement de liaisons.
    hub : {label, sublabel, type} ou None. groupe : {key, label, type, via, items: [{id, label, sublabel, level?, type?}], link?}. Au plus 12 colonnes
    (limite d'Archify) : les groupes en trop et les éléments au-delà de `per_group` vont dans des encadrés de suite."""
    present = [g for g in groups if g["items"]]
    spare, present = present[MAX_COLS:], present[:MAX_COLS]
    widths = {g["key"]: min(len(g["items"][:per_group]), 3) for g in present}
    while sum(widths.values()) > MAX_COLS:
        widths[max(widths, key=widths.get)] -= 1
    cols = max(sum(widths.values()), 3)
    top = 1 if hub else 0
    comps, conns, bounds, centres = [], [], [], []
    col0 = (cols - sum(widths.values())) // 2
    n_items = 0
    for g in present:
        w, shown = widths[g["key"]], g["items"][:per_group]
        centre = col0 + (w - 1) // 2
        centres.append(centre)
        gid = f"g_{slug(g['key'])}"[:50]
        comps.append({"id": gid, "type": g.get("type", "backend"), "label": g["label"][:24], "sublabel": f"{len(g['items'])} élément(s)" if not g.get("sub") else g["sub"][:36],
                      "row": top, "col": centre, "size": [W, H]})
        ids = [gid]
        for i, it in enumerate(shown):
            cid = f"i{n_items}_{slug(it['id'])}"[:60]   # commence par une lettre (règle d'Archify) ; le rang rend l'identifiant unique
            c = {"id": cid, "type": it.get("type", "backend"), "label": it["label"][:24], "sublabel": it.get("sublabel", "")[:36], "row": top + 1 + i // w, "col": col0 + i % w, "size": [W, H]}
            comps.append(with_level(c, it.get("level"), ""))
            ids.append(cid)
            n_items += 1
            if i < w:                                    # liaison seulement vers la première ligne : les suivantes sont dans le cadre
                conns.append({"from": gid, "to": cid, "route": "orthogonal-v"})
        bounds.append({"kind": "region", "label": f"{g['label']} · {len(g['items'])}"[:48], "wraps": ids, "pad": 12})
        col0 += w
    if hub:
        hub_col = (centres[0] + centres[-1]) // 2 if centres else cols // 2
        comps.insert(0, {"id": "hub", "type": hub.get("type", "security"), "label": hub["label"][:24], "sublabel": hub.get("sublabel", "")[:36], "row": 0, "col": hub_col, "size": [W, H]})
        for g in present:
            if g.get("via"):
                conns.insert(0, {"from": "hub", "to": f"g_{slug(g['key'])}"[:50], "label": g["via"], "route": "orthogonal-v", **({"variant": g["link"]} if g.get("link") else {})})
    spec = diagram(title, generated, output, cols, comps, conns)
    spec["boundaries"] = bounds
    cards = []
    for g in present:
        extra = g["items"][per_group:]
        if extra:
            cards.append({"dot": g.get("dot", "emerald"), "title": f"{g['label']} (suite)", "items": [f"{x['label']} · {x.get('sublabel', '')}".rstrip(" ·") for x in extra[:CARD_MAX]]
                          + ([f"… et {len(extra) - CARD_MAX} autre(s)"] if len(extra) > CARD_MAX else [])})
    if spare:
        cards.append({"dot": "amber", "title": "Autres groupes non dessinés", "items": [f"{g['label']} : {len(g['items'])}" for g in spare[:CARD_MAX]]})
    if cards:
        spec["cards"] = cards
    return spec


ACCESS_GROUPS = [("ssh", "Lues par SSH", "database", "SSH"), ("agent", "Lues par l'agent", "backend", "agent"),
                 ("api", "Lues par un connecteur", "cloud", "API"), ("none", "Sans accès", "external", "")]


def access_of(m: dict) -> tuple[str, str]:
    """(méthode principale, détail) d'une machine : SSH d'abord, puis l'agent, puis un connecteur (Home Assistant, Proxmox…), sinon ping seulement.
    Les autres façons de la lire sont ajoutées au détail (« + agent », « + Beszel »)."""
    s, a = m.get("ssh"), m.get("agent")
    api = [x.get("label") or x.get("type") for x in (m.get("api") or []) if x.get("label") or x.get("type")]
    extra = ([] if not s or not a else ["agent"]) + ([] if not api or not (s or a) else api)
    if s:
        main, base = "ssh", f"{s.get('user') or '?'}@{m['ip']}:{s.get('port', 22)}"
    elif a:
        main, base = "agent", f"{m['ip']} · agent"
    elif api:
        main, base = "api", f"{m['ip']} · {', '.join(api)}"
        extra = []
    else:
        main, base = "none", f"{m['ip']} · ping seulement"
    return main, base + (" · + " + ", ".join(extra) if extra else "")


def build_access(data: dict, health: dict | None = None) -> dict:
    """« Accès aux machines » : MyServices, un bloc par façon de lire (SSH, agent, connecteur, sans accès), et dessous chaque machine dans un cadre
    avec son niveau de santé, son compte et son port. Une machine apparaît sous sa méthode principale ; les autres sont dans son détail."""
    hb = health_by_ip(health)
    items: dict[str, list[dict]] = {k: [] for k, *_ in ACCESS_GROUPS}
    for m in sorted((m for m in data.get("machine_list", []) if not m.get("disabled")), key=lambda m: ipaddress.ip_address(m["ip"])):
        main, detail = access_of(m)
        items[main].append({"id": slug(m["ip"]), "label": m["name"], "sublabel": detail, "level": hb.get(m["ip"], {}).get("level")})
    groups = [{"key": k, "label": label, "type": typ, "via": via, "items": items[k], "dot": "amber" if k == "none" else "emerald"} for k, label, typ, via in ACCESS_GROUPS]
    hub = {"label": "MyServices", "sublabel": "clé SSH de l'app · agents · connecteurs", "type": "security"}
    return grouped("Accès aux machines", data.get("generated", ""), "acces.html", hub, groups)


def build_alert_chain(info: dict, generated: str) -> dict:
    """« Chaîne d'alertes et de notifications » : de la collecte jusqu'aux canaux (Discord, Telegram, webhook), avec les nombres du moment."""
    ch = info.get("channels") or []
    comps = [
        {"id": "collect", "type": "backend", "label": "Collecte", "sublabel": "data.json · " + info.get("collect_at", ""), "row": 0, "col": 0},
        {"id": "watch", "type": "backend", "label": "Veille et santé", "sublabel": "événements · " + info.get("watch_at", ""), "row": 0, "col": 1},
        {"id": "history", "type": "database", "label": "Historique", "sublabel": "un an, SQLite", "row": 0, "col": 2},
        {"id": "rules", "type": "security", "label": "Alertes", "sublabel": f"{info.get('rules', 0)} règle(s) active(s)", "row": 1, "col": 1},
        {"id": "notifs", "type": "cloud", "label": "Notifications", "sublabel": f"{info.get('reports', 0)} rapport(s) · {info.get('live', 0)} en direct", "row": 1, "col": 3},
    ]
    conns = [{"from": "collect", "to": "watch"}, {"from": "watch", "to": "history"},
             {"from": "history", "to": "rules", "label": "nouveaux", "route": "orthogonal-v"}, {"from": "history", "to": "notifs", "label": "en direct", "route": "orthogonal-v"}]
    cols = max(4, len(ch))
    start = (cols - len(ch)) // 2
    for i, c in enumerate(ch):
        cid = f"ch_{i}"
        comps.append({"id": cid, "type": "external", "label": f"{CONNECTOR_LABEL.get(c['type'], c['type'])} · {c['name']}"[:24],
                      "sublabel": "actif" if c.get("enabled") else "coupé", "row": 2, "col": start + i,
                      "icon": "success" if c.get("enabled") else "waiting"})
        conns.append({"from": "rules", "to": cid, "route": "orthogonal-v", **({} if c.get("enabled") else {"variant": "dashed"})})
        conns.append({"from": "notifs", "to": cid, "route": "orthogonal-v", **({} if c.get("enabled") else {"variant": "dashed"})})
    for c in comps:
        c["size"] = [W, H]
    return diagram("Chaîne d'alertes et de notifications", generated, "alertes.html", cols, comps, conns)


def stable(spec: dict) -> str:
    """Spécification sans l'horodatage du sous-titre : sert à ne regénérer un schéma que s'il a vraiment changé."""
    return json.dumps({**spec, "meta": {k: v for k, v in spec["meta"].items() if k != "subtitle"}}, sort_keys=True)


def read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))  # NOSONAR S8707: command-line tool, the paths are the ones its operator typed
    except (OSError, ValueError):
        return None
