"""Schémas proposés, créés à la demande (bouton « Créer » de l'onglet Schémas) : réseau, services par machine, domaines, virtualisation.

Chacun se construit depuis data.json, avec l'assemblage commun archify_map.grouped(). Un schéma n'est produit que s'il a été demandé (réglage
« diagrams_extra ») ; `needs` dit ce qu'il faut pour qu'il ait quelque chose à montrer, `available()` le vérifie. Aucune donnée secrète :
noms, adresses, états.
"""
from __future__ import annotations

import ipaddress

from archify_map import grouped, slug

# id = nom du fichier sans .html ; (titre, ce que le schéma montre, besoin)
CATALOG: dict[str, tuple[str, str, str]] = {
    "reseau": ("Équipements et appareils du réseau",
               "La passerelle, les switchs et les bornes Wi-Fi, avec en dessous les appareils branchés sur chacun. Lu par MynetworK et UniFi.", "network"),
    "services": ("Services par machine",
                 "Chaque machine avec les services qu'elle fait tourner : conteneurs Docker, applis reconnues, serveurs web, ports en écoute.", "services"),
    "domaines": ("Domaines et leur chemin",
                 "Chaque domaine rangé sous ce qui le sert : un NPM (avec la machine et le service visés) ou un Apache (ses vhosts, par machine).", "domains"),
    "virtualisation": ("Machines virtuelles et conteneurs",
                       "Chaque hôte Proxmox avec ses machines virtuelles et conteneurs LXC, en marche ou arrêtés. Lu par le connecteur Proxmox.", "virtualization"),
}
ADDRESS = lambda ip: (ipaddress.ip_address(ip) if ip else ipaddress.ip_address("255.255.255.255"))   # noqa: E731


def _networks(data: dict) -> list[dict]:
    return [n for n in data.get("network") or [] if n.get("devices") or (n.get("unifi") or {}).get("devices") or (n.get("unifi") or {}).get("clients")]


def _services(data: dict) -> dict[str, list[dict]]:
    """Services par machine : un élément par service distinct (appli reconnue, titre ou nom), avec son type et son port."""
    out: dict[str, dict[str, dict]] = {}
    for h in data.get("hosts") or []:
        if h.get("type") == "redirect" or not h.get("machine"):
            continue
        svc = h.get("service") or {}
        name = (h.get("app") or {}).get("label") or svc.get("title") or svc.get("name") or h.get("name")
        if not name:
            continue
        kind = svc.get("kind") or "web"
        cur = out.setdefault(h["machine"], {}).setdefault(str(name).lower(), {"id": slug(str(name)), "label": str(name), "ports": [], "kind": kind, "domains": 0})
        if h.get("port") and h["port"] not in cur["ports"]:
            cur["ports"].append(h["port"])
        cur["domains"] += len(h.get("domains") or [])
    return {m: sorted(v.values(), key=lambda x: x["label"].lower()) for m, v in out.items()}


def _vhosts(data: dict) -> dict[str, list[dict]]:
    """Vhosts Apache lus sur chaque machine : un élément par nom principal et port."""
    out: dict[str, list[dict]] = {}
    for m in data.get("machine_list") or []:
        for v in ((m.get("info") or {}).get("vhosts") or []):
            names = v.get("names") or []
            if names:
                out.setdefault(m["name"], []).append({"name": names[0], "more": len(names) - 1, "port": v.get("port"), "docroot": v.get("docroot") or ""})
    return out


def _proxied(data: dict) -> dict[str, list[dict]]:
    """Domaines publiés par chaque NPM : domaine principal, machine et service visés."""
    out: dict[str, list[dict]] = {}
    for h in data.get("hosts") or []:
        if h.get("type") != "proxy" or not h.get("domains"):
            continue
        svc = h.get("service") or {}
        what = (h.get("app") or {}).get("label") or svc.get("title") or svc.get("name") or ""
        where = h.get("machine") or h.get("ip") or ""
        out.setdefault(h.get("npm") or "NPM", []).append({"name": h["domains"][0], "more": len(h["domains"]) - 1, "to": " · ".join(x for x in (where, what) if x),
                                                          "off": not h.get("enabled", True)})
    return out


def available(key: str, data: dict | None, backups_url: str = "") -> bool:
    """Le schéma a-t-il de quoi se construire ? (un connecteur réseau lu, des services vus, des domaines, un hôte Proxmox)"""
    data = data or {}
    need = CATALOG[key][2] if key in CATALOG else ""
    if need == "network":
        return bool(_networks(data))
    if need == "services":
        return bool(_services(data))
    if need == "domains":
        return bool(_proxied(data) or _vhosts(data))
    if need == "virtualization":
        return any(v.get("guests") or v.get("nodes") for v in data.get("virtualization") or [])
    return True


def build_reseau(data: dict) -> dict:
    """Passerelle (UniFi) au centre, un groupe par switch ou borne Wi-Fi avec ses appareils ; les autres appareils vus par le scanner à part."""
    nets = _networks(data)
    devices = [d for n in nets for d in (n.get("unifi") or {}).get("devices") or []]
    clients = [c for n in nets for c in (n.get("unifi") or {}).get("clients") or []]
    scan = [d for n in nets for d in n.get("devices") or []]
    gw = next((d for d in devices if d.get("type") in ("udm", "ugw", "uxg", "udr")), None)
    attach: dict[str, list[dict]] = {}
    for c in clients:
        attach.setdefault(c.get("ap_mac") or c.get("switch_mac") or "", []).append(c)

    def kid(c: dict) -> dict:
        where = f"Wi-Fi {c.get('essid') or ''} {c.get('signal_dbm') or ''} dBm".replace("  ", " ").replace(" dBm", "").strip() if not c.get("wired") else f"port {c.get('switch_port') or '?'}"
        return {"id": slug(c.get("mac") or c.get("ip") or c.get("name") or "x"), "label": c.get("name") or c.get("ip") or "?", "sublabel": f"{c.get('ip') or '?'} · {where}", "type": "frontend"}

    groups, seen = [], set()
    for d in sorted((d for d in devices if d is not gw), key=lambda d: (d.get("type") != "usw", d.get("name") or "")):
        kind = {"usw": "switch", "uap": "borne Wi-Fi"}.get(d.get("type"), d.get("type") or "appareil")
        mine = attach.get(d.get("mac") or "", [])
        seen.update(c.get("mac") for c in mine)
        groups.append({"key": d.get("mac") or d.get("name") or kind, "label": (d.get("name") or kind).replace("☠", "").strip(), "type": "database" if d.get("type") == "usw" else "cloud",
                       "via": kind, "sub": f"{kind} · {d.get('ip') or '?'}", "items": [kid(c) for c in sorted(mine, key=lambda c: c.get("name") or "")],
                       "link": "dashed" if d.get("state") not in (None, "connected") else None})
    direct = attach.get((gw or {}).get("mac") or "", []) + attach.get("", [])
    seen.update(c.get("mac") for c in direct)
    groups.insert(0, {"key": "direct", "label": "Sur la passerelle", "type": "backend", "via": "câble", "sub": "branchés directement", "items": [kid(c) for c in direct]})
    ips = {c.get("ip") for c in clients} | {d.get("ip") for d in devices}
    others = [d for d in sorted(scan, key=lambda d: ADDRESS(d.get("ip"))) if d.get("ip") not in ips]
    groups.append({"key": "scan", "label": "Autres appareils vus", "type": "external", "via": "scan", "sub": "scanner MynetworK", "dot": "amber",
                   "items": [{"id": slug(d.get("ip") or "x"), "label": d.get("hostname") or d.get("vendor") or d.get("ip") or "?",
                              "sublabel": f"{d.get('ip') or '?'} · {'en ligne' if d.get('status') == 'online' else 'hors ligne'}", "type": "frontend"} for d in others]})
    hub = {"label": (gw or {}).get("name", "Réseau local").replace("☠", "").strip(), "sublabel": "passerelle" + (f" · {gw['ip']}" if gw and gw.get("ip") else ""), "type": "security"}
    return grouped("Équipements et appareils du réseau", data.get("generated", ""), "reseau.html", hub, groups)


def build_services(data: dict) -> dict:
    """Une ligne de groupes : chaque machine avec ses services ; MyServices n'y figure pas (le schéma décrit ce que les machines font tourner)."""
    svc = _services(data)
    ip_of = {m["name"]: m["ip"] for m in data.get("machine_list") or []}
    groups = []
    for name in sorted(svc, key=lambda n: ADDRESS(ip_of.get(n))):
        items = [{"id": x["id"], "label": x["label"], "sublabel": f"{x['kind']} · :{','.join(str(p) for p in x['ports'][:3])}" + (f" · {x['domains']} domaine(s)" if x["domains"] else ""),
                  "type": "database" if x["kind"] in ("docker",) else "backend"} for x in svc[name]]
        groups.append({"key": name, "label": name, "type": "backend", "via": "", "sub": ip_of.get(name, ""), "items": items})
    return grouped("Services par machine", data.get("generated", ""), "services.html", None, groups)


def build_domaines(data: dict) -> dict:
    """Un groupe par NPM (domaines publiés, vers quelle machine et quel service) et par Apache (vhosts d'une machine)."""
    groups = []
    for npm, rows in sorted(_proxied(data).items()):
        groups.append({"key": f"npm-{npm}", "label": npm if npm.upper().startswith("NPM") else f"NPM {npm}", "type": "security", "via": "proxy", "link": None,
                       "items": [{"id": slug(r["name"]), "label": r["name"], "sublabel": (r["to"] + (f" · +{r['more']}" if r["more"] else "") + (" · désactivé" if r["off"] else ""))}
                                 for r in sorted(rows, key=lambda r: r["name"])]})
    for machine, rows in sorted(_vhosts(data).items()):
        seen, items = set(), []
        for r in sorted(rows, key=lambda r: (r["name"], r["port"] or 0)):
            if (r["name"], r["port"]) in seen:
                continue
            seen.add((r["name"], r["port"]))
            items.append({"id": slug(f"{r['name']}-{r['port']}"), "label": r["name"], "sublabel": f":{r['port']} · {r['docroot'] or 'vhost'}" + (f" · +{r['more']}" if r["more"] else "")})
        groups.append({"key": f"apache-{machine}", "label": f"Apache {machine}", "type": "backend", "via": "vhosts", "items": items})
    total = sum(len(g["items"]) for g in groups)
    hub = {"label": "Vos domaines", "sublabel": f"{total} domaine(s) · NPM et Apache", "type": "external"}
    spec = grouped("Domaines et leur chemin", data.get("generated", ""), "domaines.html", hub, groups)
    nginx = [m["name"] for m in data.get("machine_list") or [] if (m.get("info") or {}).get("nginx")]
    if nginx:
        spec.setdefault("cards", []).append({"dot": "amber", "title": "nginx installé (sites non lus)", "items": nginx[:30]})
    return spec


def build_virtualisation(data: dict) -> dict:
    """Un groupe par nœud Proxmox avec ses machines virtuelles et conteneurs (arrêtés en pointillé dans le détail)."""
    groups = []
    hubs = [v for v in data.get("virtualization") or [] if v.get("guests") or v.get("nodes")]
    for v in hubs:
        nodes = {n["name"]: n for n in v.get("nodes") or []}
        by_node: dict[str, list[dict]] = {k: [] for k in nodes}
        for g in v.get("guests") or []:
            if g.get("template"):
                continue
            by_node.setdefault(g.get("node") or "?", []).append(g)
        for node, guests in sorted(by_node.items()):
            n = nodes.get(node, {})
            groups.append({"key": f"{v.get('name')}-{node}", "label": node, "type": "database", "via": "nœud", "link": None if n.get("online", True) else "dashed",
                           "sub": ("en ligne" if n.get("online", True) else "hors ligne") + (f" · cpu {n['cpu_pct']:.0f} %" if n.get("cpu_pct") is not None else ""),
                           "items": [{"id": str(g.get("vmid") or slug(g.get("name") or "x")), "label": g.get("name") or f"#{g.get('vmid')}",
                                      "sublabel": f"{'VM' if g.get('type') == 'qemu' else 'LXC'} {g.get('vmid')} · {'en marche' if g.get('status') == 'running' else g.get('status') or '?'}",
                                      "type": "backend" if g.get("status") == "running" else "external"} for g in sorted(guests, key=lambda g: g.get("vmid") or 0)]})
    hub = {"label": hubs[0].get("label") or "Proxmox", "sublabel": f"{sum(len(g['items']) for g in groups)} invité(s)", "type": "security"} if hubs else None
    return grouped("Machines virtuelles et conteneurs", data.get("generated", ""), "virtualisation.html", hub, groups)


BUILD = {"reseau": build_reseau, "services": build_services, "domaines": build_domaines, "virtualisation": build_virtualisation}
