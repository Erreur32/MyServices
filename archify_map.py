#!/usr/bin/env python3
"""Cartes de l'infra au format Archify (diagrammes d'architecture), générées depuis les fichiers de la page.

  python3 archify_map.py [web_dir] [dossier de sortie]
  node <archify>/bin/archify.mjs deliver architecture <dossier>/carte.archify.json carte.html --json

carte.archify.json (data.json, + health/stats.json s'il existe) : Internet, chaque instance NPM et AdGuard,
chaque machine (en ligne ou non, niveau de santé en icône et en étiquette). Liaisons : NPM -> machines qu'il
publie (nombre de hosts), AdGuard -> NPM (réécritures DNS). Encadré : machines dont la santé n'est pas OK.
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


def read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main() -> int:
    """Écrit les spécifications dans le dossier de sortie et affiche leur chemin, une par ligne."""
    web = Path(sys.argv[1] if len(sys.argv) > 1 else "web")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ".")
    data = read(web / "data.json")
    if data is None:
        sys.exit(f"{web / 'data.json'} illisible")
    specs = {"carte": build(data, read(web / "health" / "stats.json"))}
    if (bk := read(web / "backups.json")) is not None:
        specs["sauvegardes"] = build_backups(bk)
    for name, spec in specs.items():
        f = out / f"{name}.archify.json"
        f.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
