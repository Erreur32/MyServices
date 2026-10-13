"""Nextcloud: version and updates, active users, storage, database and public links, read only, by its monitoring API.

Route read (GET): /ocs/v2.php/apps/serverinfo/api/v1/info?format=json (« serverinfo » app, shipped with Nextcloud).
Access by the token of that app only, no account: on the Nextcloud server
  occ config:app:set serverinfo token --value <token>
then the header « NC-Token: <token> ». It opens this monitoring route and nothing else.
"""
from __future__ import annotations

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, num, size

ROUTE = "/ocs/v2.php/apps/serverinfo/api/v1/info?format=json"
FREE_LOW = 10 * 2**30   # free space below 10 GiB: to look at


class Nextcloud(StatusConnector):
    type = "nextcloud"
    label = "Nextcloud"
    images = ("nextcloud", "linuxserver/nextcloud", "nextcloud/all-in-one", "lscr.io/linuxserver/nextcloud")
    tested = ("28", "29", "30", "31")
    fields = (
        Field("url", "Adresse de Nextcloud", "url", required=True, help="https://cloud.exemple.fr (l'adresse de la page de connexion)"),
        Field("token", "Jeton de l'appli serverinfo", "password", required=True, secret=True,
              help="créé sur le serveur Nextcloud avec occ (voir le guide) ; ouvre seulement la page de supervision"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True),
    )
    setup_fields = ("url", "token")
    # A step's first line is its text; the next lines, when there are some, are a command block shown with a copy button
    guide = (
        "Choisir un jeton long et aléatoire, puis le donner à l'appli serverinfo de Nextcloud (elle est installée d'office). "
        "Lancer une seule des commandes ci-dessous sur la machine de Nextcloud : elle crée le jeton, l'enregistre et l'affiche.",
        "Nextcloud installé sans Docker (chemin habituel /var/www/nextcloud, à adapter) :\n"
        "TOKEN=$(openssl rand -hex 32)\n"
        "sudo -u www-data php /var/www/nextcloud/occ config:app:set serverinfo token --value \"$TOKEN\"\n"
        "echo \"$TOKEN\"",
        "Nextcloud en Docker, image officielle (remplacer « nextcloud » par le nom du conteneur) :\n"
        "TOKEN=$(openssl rand -hex 32)\n"
        "docker exec -u www-data nextcloud php occ config:app:set serverinfo token --value \"$TOKEN\"\n"
        "echo \"$TOKEN\"",
        "Nextcloud All-in-One (AIO) :\n"
        "TOKEN=$(openssl rand -hex 32)\n"
        "docker exec -u www-data nextcloud-aio-nextcloud php occ config:app:set serverinfo token --value \"$TOKEN\"\n"
        "echo \"$TOKEN\"",
        "Image linuxserver.io (occ déjà prêt) :\n"
        "TOKEN=$(openssl rand -hex 32)\n"
        "docker exec nextcloud occ config:app:set serverinfo token --value \"$TOKEN\"\n"
        "echo \"$TOKEN\"",
        "Copier le jeton affiché dans le champ « Jeton de l'appli serverinfo » ci-dessus. Il n'ouvre que la page de supervision "
        "(version, utilisateurs actifs, stockage) : aucun compte n'est donné à MyServices.",
    )

    def collect(self) -> dict:
        got = self.get(ROUTE, {"NC-Token": str(self.conf.get("token") or ""), "OCS-APIRequest": "true"})
        data = ((got or {}).get("ocs") or {}).get("data") if isinstance(got, dict) else None
        nc = (data or {}).get("nextcloud") if isinstance(data, dict) else None
        if not isinstance(nc, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Nextcloud, ou l'appli serverinfo est désactivée")
        sysi, store = nc.get("system") or {}, nc.get("storage") or {}
        shares, server = nc.get("shares") or {}, data.get("server") or {}
        active = data.get("activeUsers") or {}
        apps, upd = sysi.get("apps") or {}, sysi.get("update") or {}
        version = sysi.get("version")
        newer = upd.get("available_version") or (upd.get("available") if isinstance(upd.get("available"), str) else None)
        has_update = bool(newer) or upd.get("available") is True
        app_updates = apps.get("app_updates") if isinstance(apps.get("app_updates"), dict) else {}
        free, links_open = num(sysi.get("freespace")), int(num(shares.get("num_shares_link_no_password"), 0))
        db, php = server.get("database") or {}, server.get("php") or {}

        facts = [fact("Version", (version or "?") + (f" → {newer}" if newer else ""), "warn" if has_update else "ok")]
        if active.get("last24hours") is not None:
            facts.append(fact("Actifs (24 h)", f"{int(num(active['last24hours'], 0))} / {int(num(store.get('num_users'), 0))} utilisateurs"))
        if store.get("num_files") is not None:
            facts.append(fact("Fichiers", f"{int(num(store['num_files'], 0)):,}".replace(",", " ")))
        if free is not None:
            facts.append(fact("Espace libre", size(free), "warn" if free < FREE_LOW else "ok"))
        if db.get("type"):
            facts.append(fact("Base", f"{db['type']} {db.get('version', '')}".strip() + (f" · {size(num(db.get('size')))}" if db.get("size") else "")))
        if php.get("version"):
            facts.append(fact("PHP", php["version"]))
        if apps.get("num_installed") is not None:
            n = int(num(apps.get("num_updates_available"), len(app_updates)))
            facts.append(fact("Applis", f"{int(num(apps['num_installed'], 0))} installées" + (f", {n} à mettre à jour" if n else ""), "warn" if n else "ok"))
        if shares.get("num_shares_link") is not None:
            facts.append(fact("Liens publics", f"{int(num(shares['num_shares_link'], 0))}" + (f", {links_open} sans mot de passe" if links_open else ""),
                              "warn" if links_open else "ok"))

        # Each point to look at has a stable key: the watcher alerts once when a key appears (« nextcloud » events), not when its
        # figures change (one more public link, a little less free space)
        checks = []
        if has_update:
            checks.append(("update", f"mise à jour de Nextcloud disponible{f' : {newer}' if newer else ''}"))
        checks += [(f"app:{k}", f"appli « {k} » : mise à jour {v}") for k, v in list(app_updates.items())[:6]]
        if links_open:
            checks.append(("links", f"{links_open} lien(s) public(s) sans mot de passe"))
        if free is not None and free < FREE_LOW:
            checks.append(("space", f"espace libre bas : {size(free)}"))
        if sysi.get("debug") == "yes":
            checks.append(("debug", "mode debug actif (à couper en production)"))
        return {**self.out(version, facts, [t for _, t in checks]), "checks": [{"key": k, "text": t} for k, t in checks]}

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        https = next((h for h, c in ports if c == 443), None)
        if https:
            return {"url": f"https://{ip}:{https}", "verify_tls": False}
        web = next((h for h, c in ports if c in (80, 11000)), None)
        return {"url": f"http://{ip}:{web}"} if web else None
