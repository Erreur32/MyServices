"""Qui découvre quoi, et quand : ce qui se fait tout seul, ce qui demande un clic, et ce qui reste à faire.

Une « découverte » est une recherche que MyServices fait pour compléter ce qu'il sait (services, machines, sauvegardes, cron…). Certaines
tournent seules à chaque passage, d'autres une seule fois puis seules, d'autres seulement quand on les lance. Cette liste le dit en clair,
avec la dernière fois, la prochaine fois et l'action à faire s'il y en a une. Voir GET /api/v1/discoveries.

État d'une entrée : « todo » = nécessaire (sans ça, MyServices ne voit pas tout ou une machine n'est plus lue), compté dans la cloche ;
« suggest » = facultatif (relier une appli, suivre une machine trouvée…), proposé sans insister ; « ok » / « info » = rien à faire.
"""
from __future__ import annotations

AUTO, FIRST, MANUAL = "auto", "first", "manual"      # mode : toute seule / une fois à la main puis seule / à la main seulement
TODO, SUGGEST = "todo", "suggest"                    # nécessaire / facultatif


def build(i: dict) -> list[dict]:
    """Entrées pour la page. `i` : collect_last / collect_next / collect_ok (epoch, bool), net_last, net_every_h, net_has_run,
    backups_last, backups_next, backups_enabled, backups_search_last, backups_auto (bool), ssh_machines, auto_checked,
    proposals, redetect_hint (nombre de machines), has_ssh_machines."""
    out: list[dict] = []

    def add(id_, title, mode, what, last=None, next_=None, state="ok", note="", action=None, app=None, machine=None):
        """app / machine ({ip, name}) : l'appli trouvée et la machine visée, que la page met en forme (gras, logo du système)."""
        out.append({"id": id_, "title": title, "mode": mode, "what": what, "last": last, "next": next_, "state": state, "note": note, "action": action,
                    "app": app, "machine": machine})

    add("services", "Services, conteneurs et ports", AUTO,
        "Relus à chaque collecte : conteneurs Docker, ports en écoute, pages web, applis reconnues. Rien à faire.",
        i.get("collect_last"), i.get("collect_next"), "ok" if i.get("collect_ok", True) else TODO,
        "" if i.get("collect_ok", True) else "la collecte est en retard : voir Réglages → Tâches et horaires",
        {"label": "Lancer maintenant", "run": "collect"})
    add("new", "Nouveaux services et services disparus", AUTO,
        "Repérés à chaque collecte et notés dans l'onglet Historique (« Nouveau », « Disparu »). Rien à faire.", i.get("collect_last"), i.get("collect_next"))

    net_every = i.get("net_every_h") or 0
    if not i.get("net_has_run"):
        add("network", "Machines du réseau (recherche réseau)", AUTO if net_every else MANUAL,
            f"Se lance toute seule : la première dans la minute, puis toutes les {net_every:g} h (lecture seule, un /24 au plus)." if net_every
            else "Répétition automatique coupée (Réglages → Découverte) : à lancer à la main.",
            None, None, "ok" if net_every else "info", "première recherche dans la minute" if net_every else "jamais lancée",
            {"label": "Lancer la recherche", "run": "netscan", "href": "#settings/network/scan"})
    else:
        nxt = (i["net_last"] + net_every * 3600) if net_every and i.get("net_last") else None
        add("network", "Machines du réseau (recherche réseau)", AUTO if net_every else MANUAL,
            f"Se répète toute seule toutes les {net_every:g} h (lecture seule, un /24 au plus)." if net_every else "Répétition automatique coupée : à relancer à la main.",
            i.get("net_last"), nxt, "ok" if net_every else "info", "", {"label": "Chercher maintenant", "run": "netscan", "href": "#settings/network/scan"})

    add("redetect", "Réglages des machines déjà enregistrées (rôle, système, applis)", MANUAL,
        "Ne se met pas à jour tout seul : après un changement (nouvelle appli, passage à Windows, nouveau port), cliquer sur « Redétecter » dans Réglages → Machines.",
        None, None, "info", "", {"label": "Ouvrir Réglages → Machines", "href": "#settings/machines"})

    n, done = i.get("ssh_machines", 0), i.get("auto_checked", 0)
    if not i.get("backups_auto", True):
        add("backups-default", "Dossier /home/backup", MANUAL, "Suivi automatique coupé (réglage backups_auto) : à chercher à la main.", None, None, "info")
    else:
        add("backups-default", "Dossier /home/backup", FIRST,
            "Vérifié une seule fois, à la première lecture SSH de chaque machine : s'il existe, la sauvegarde est suivie tout de suite. "
            "Si vous la retirez ensuite, elle ne revient pas.", None, None, "ok" if done >= n else "info", f"{done} machine(s) vérifiée(s) sur {n}",
            {"label": "Voir Réglages → Sauvegardes", "href": "#settings/backups"})
    add("backups-other", "Autres dossiers de sauvegarde", MANUAL,
        "Jamais automatique : cliquer sur « Chercher » dans Réglages → Sauvegardes (ajoutez vos emplacements dans « Autres emplacements »), puis cocher et suivre.",
        i.get("backups_search_last"), None, SUGGEST if n and not i.get("backups_search_last") else "info",
        "pas encore cherché" if n and not i.get("backups_search_last") else "", {"label": "Chercher des sauvegardes", "href": "#settings/backups"})
    add("cron", "Tâches planifiées de sauvegarde (cron, timers)", AUTO,
        "Lues par SSH à chaque passage des sauvegardes ; les nouvelles apparaissent dans l'onglet Sauvegardes. Rien à faire."
        if i.get("backups_enabled") else "Lues à chaque passage des sauvegardes, une fois l'onglet Sauvegardes activé (suivre un premier dossier).",
        i.get("backups_last"), i.get("backups_next") if i.get("backups_enabled") else None, "ok" if i.get("backups_enabled") else "info", "")

    unknown = i.get("unknown_hosts") or 0
    if unknown:
        add("hosts", f"{unknown} machine(s) trouvée(s) sur le réseau, pas encore suivie(s)", FIRST,
            "La recherche réseau les a vues, sans SSH, appli reconnue ni service utile (téléphones, objets connectés…) : le mode automatique "
            "ne les ajoute pas. Choisissez celles à suivre (ou à ignorer)." if i.get("auto_mode")
            else "La recherche réseau les a vues. Choisissez celles à suivre (ou à ignorer) : en mode manuel, MyServices ne les ajoute jamais seul.",
            i.get("net_last"), None, SUGGEST,
            "à choisir", {"label": "Choisir", "href": "#settings/network/hosts"})
    for k in i.get("key_refused") or []:   # accès SSH activé mais la clé de l'app n'est pas autorisée (ou port faux)
        add(f"ssh:{k['ip']}", f"Clé SSH à autoriser sur {k.get('name') or k['ip']}", AUTO,
            "L'accès SSH est activé, mais la connexion échoue : la clé de l'app n'est pas autorisée sur cette machine (ou le port est faux). Ses conteneurs et sa santé ne sont pas lus tant que ce n'est pas fait.",
            None, None, TODO, "action sur la machine", {"label": "Régler", "href": f"#settings/machines/{k['ip']}"},
            machine={"ip": k["ip"], "name": k.get("name") or ""})
    for a in i.get("agents_waiting") or []:   # agent créé mais jamais installé / jamais parlé
        add(f"agent:{a['ip']}", f"Agent à installer sur {a.get('name') or a['ip']}", MANUAL,
            "Un agent a été créé pour ce PC mais il n'a encore envoyé aucun relevé : lancez la commande d'installation (PowerShell, en administrateur) sur le PC.",
            None, None, TODO, "en attente de son premier relevé", {"label": "Voir la commande", "href": f"#settings/agents/{a['ip']}"},
            machine={"ip": a["ip"], "name": a.get("name") or ""})
    props = i.get("proposals") or []
    if not props:
        add("connectors", "Connecteurs à relier", AUTO,
            "Après chaque collecte, les applis reconnues sans connecteur sont proposées : MyServices ne les relie pas sans votre accord (jeton ou compte à fournir). Rien à relier pour l'instant.",
            i.get("collect_last"), i.get("collect_next"), "ok", "", {"label": "Voir Réglages → Connecteurs", "href": "#settings/connectors"})
    for p in props:   # une entrée par appli reconnue : la notification dit quoi, où, et ouvre le connecteur déjà rempli
        where = f" sur {p['machine']}" if p.get("machine") else f" ({p.get('ip')})" if p.get("ip") else ""
        how = f" (vu par {p['via']})" if p.get("via") else ""
        add(f"connector:{p['connector']}@{p.get('ip')}", f"{p['label']} trouvé{where}", AUTO,
            f"MyServices a reconnu cette appli{how} mais ne la lit pas encore : il faut lui donner un accès en lecture (compte, clé ou jeton). Il ne le fait jamais sans votre accord.",
            None, None, SUGGEST, "connecteur à configurer",
            {"label": "Configurer", "prefill": {"type": p["connector"], "name": p["connector"], "url": p.get("url") or ""}},
            app=p["label"], machine={"ip": p.get("ip") or "", "name": p.get("machine") or ""} if p.get("ip") or p.get("machine") else None)
    muted = set(i.get("muted") or [])
    for x in out:   # a reminder can be forgotten (and recalled); a machine access forgotten in Discovery (« access:<ip> ») hides its key reminder too
        x["mutable"] = x["id"] in ("hosts", "network", "backups-other") or x["id"].startswith(("connector:", "ssh:", "agent:"))
        x["muted"] = x["mutable"] and (x["id"] in muted or (x["id"].startswith("ssh:") and "access:" + x["id"][4:] in muted))
        if x["muted"] and x["state"] in (TODO, SUGGEST):
            x["state"], x["note"] = "info", "oublié"
    return out
