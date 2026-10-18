"""Connecteurs « état d'un service » du homelab, en lecture seule : pare-feu (OPNsense), sécurité (CrowdSec), DNS (Pi-hole v6, Technitium),
stockage (TrueNAS, Synology DSM), réseau (UniFi, Tailscale / Headscale), onduleur (NUT) et conteneurs (Portainer).

Les routes viennent de la documentation de chaque service, décrites de mémoire : à confirmer contre un vrai service (voir docs/IDEES-CONNECTEURS.md).
Lecture tolérante champ par champ ; aucun secret dans les messages d'erreur.
"""
from __future__ import annotations

import base64
import http.cookiejar
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from connectors.base import ConnectorError, Field, Result
from connectors.status_kit import StatusConnector, container_env, fact, num, post_form, raw_tcp, rows, size, duration

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")


class OPNsense(StatusConnector):
    """OPNsense : passerelles (état, latence, perte), mises à jour du pare-feu, redémarrage requis. Clé + secret d'API (Basic)."""
    type = "opnsense"
    label = "OPNsense"
    images = ()
    fields = (
        Field("url", "Adresse d'OPNsense", "url", required=True, help="https://<IP>"),
        Field("key", "Clé d'API", "password", required=True, secret=True),
        Field("secret", "Secret d'API", "password", required=True, secret=True),
        VERIFY,
    )
    setup_fields = ("url", "key", "secret")
    guide = ("Dans OPNsense : Système → Accès → Utilisateurs → un utilisateur dédié « myservices » → Clés d'API (+) : un fichier apikey.txt est téléchargé.",
             "Donner à cet utilisateur seulement les droits de lecture (Diagnostics, Système : état, Mise à jour du microprogramme).",
             "Coller la clé (key=) et le secret (secret=) du fichier ci-dessous. Certificat auto-signé : décocher « Vérifier le certificat ».")

    def collect(self) -> dict:
        auth = base64.b64encode(f"{self.conf.get('key', '')}:{self.conf.get('secret', '')}".encode()).decode()
        h = {"Authorization": f"Basic {auth}"}
        fw = self.get("/api/core/firmware/status", h)
        if not isinstance(fw, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à OPNsense")
        gws = rows(self.get("/api/routes/gateway/status", h))
        down = [g for g in gws if str(g.get("status", "")).lower() not in ("none", "online", "")]
        upd = int(num(fw.get("updates") or len(fw.get("upgrade_packages") or []) + len(fw.get("new_packages") or []), 0))
        reboot = str(fw.get("needs_reboot", "0")) in ("1", "true", "True")
        facts = [fact("Passerelles", f"{len(gws) - len(down)}/{len(gws)} en ligne", "bad" if down else "ok" if gws else None),
                 fact("Mises à jour", upd or "à jour", "warn" if upd else "ok")]
        if reboot:
            facts.append(fact("Redémarrage", "requis", "warn"))
        problems = [f"passerelle « {g.get('name')} » : {g.get('status_translated') or g.get('status')} (perte {g.get('loss', '?')})" for g in down]
        if reboot:
            problems.append("redémarrage requis")
        prod = fw.get("product") if isinstance(fw.get("product"), dict) else {}
        return self.out(fw.get("product_version") or prod.get("product_version"), facts, problems)


class CrowdSec(StatusConnector):
    """CrowdSec (API locale) : décisions actives (bannissements), scénarios les plus déclencheurs. Clé de « bouncer » (cscli bouncers add)."""
    type = "crowdsec"
    label = "CrowdSec"
    kinds = ("status",)
    images = ("crowdsecurity/crowdsec",)
    fields = (
        Field("url", "Adresse de l'API locale (LAPI)", "url", required=True, help="http://<IP>:8080"),
        Field("api_key", "Clé de bouncer", "password", required=True, secret=True, help="cscli bouncers add myservices"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Sur la machine de CrowdSec : cscli bouncers add myservices (la clé n'est montrée qu'une fois).",
             "Cette clé ne peut que lire les décisions (bannissements) ; MyServices n'en crée ni n'en supprime.")

    def collect(self) -> dict:
        d = self.get("/v1/decisions", {"X-Api-Key": str(self.conf.get("api_key", ""))})
        items = rows(d) if d is not None else []
        by_scen: dict[str, int] = {}
        for x in items:
            by_scen[str(x.get("scenario") or "?")] = by_scen.get(str(x.get("scenario") or "?"), 0) + 1
        top = sorted(by_scen.items(), key=lambda kv: -kv[1])[:3]
        facts = [fact("Décisions actives", len(items), "warn" if len(items) >= 50 else None)]
        if top:
            facts.append(fact("Scénario n°1", f"{top[0][0].rsplit('/', 1)[-1]} ({top[0][1]})"))
        return self.out(None, facts, [f"{n} bannissement(s) : {s.rsplit('/', 1)[-1]}" for s, n in top if n >= 20])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{next((h for h, c in ports if c == 8080), 8080)}"}


class PiHole(StatusConnector):
    """Pi-hole v6 : requêtes, blocage, domaines bloqués. Mot de passe d'application (session ouverte puis fermée à chaque lecture)."""
    type = "pihole"
    label = "Pi-hole"
    images = ("pihole/pihole",)
    fields = (
        Field("url", "Adresse de Pi-hole", "url", required=True, help="http://<IP> (v6 : l'API est sous /api)"),
        Field("password", "Mot de passe d'application", "password", required=True, secret=True, help="Réglages → Web interface / API → Configurer un mot de passe d'application"),
        VERIFY,
    )
    setup_fields = ("url", "password")
    guide = ("Pi-hole v6 : Settings → Web interface / API → « Configure app password » : créer un mot de passe d'application dédié à MyServices.",
             "Pi-hole v5 n'est pas géré (API différente).")

    def collect(self) -> dict:
        sess = self.ctx.http(self.base_url() + "/api/auth", method="POST", body={"password": str(self.conf.get("password", ""))}, verify_tls=self.tls())
        s = (sess or {}).get("session") if isinstance(sess, dict) else None
        if not isinstance(s, dict) or not s.get("valid") or not s.get("sid"):
            raise ConnectorError("mot de passe refusé (mot de passe d'application ?)")
        h = {"sid": str(s["sid"])}
        try:
            st = self.get("/api/stats/summary", h)
            blocking = self.get("/api/dns/blocking", h)
            ver = None
            try:
                ver = ((self.get("/api/info/version", h) or {}).get("version") or {}).get("core", {}).get("local", {}).get("version")
            except ConnectorError:
                pass
        finally:
            try:
                self.ctx.http(self.base_url() + "/api/auth", method="DELETE", headers=h, verify_tls=self.tls())
            except ConnectorError:
                pass   # la session expire seule
        q = (st or {}).get("queries") or {}
        on = str((blocking or {}).get("blocking", "")).lower() == "enabled"
        facts = [fact("Blocage", "actif" if on else "coupé", "ok" if on else "bad"), fact("Requêtes", int(num(q.get("total"), 0))),
                 fact("Bloquées", f"{num(q.get('percent_blocked'), 0):.0f} %"), fact("Domaines bloqués", int(num(((st or {}).get("gravity") or {}).get("domains_being_blocked"), 0)))]
        return self.out(ver, facts, [] if on else ["le blocage des publicités est coupé"])


class Technitium(StatusConnector):
    """Technitium DNS Server : requêtes, domaines bloqués, clients, sur 24 h. Jeton d'API (envoyé en POST, jamais dans l'adresse)."""
    type = "technitium"
    label = "Technitium DNS"
    images = ("technitium/dns-server",)
    fields = (
        Field("url", "Adresse de Technitium", "url", required=True, help="http://<IP>:5380"),
        Field("token", "Jeton d'API", "password", required=True, secret=True, help="Administration → Sessions → Create API Token"),
        VERIFY,
    )
    setup_fields = ("url", "token")
    guide = ("Dans Technitium : Administration → Sessions → « Create API Token » avec un compte de lecture seule si possible.",)

    def collect(self) -> dict:
        d = post_form(self.base_url() + "/api/dashboard/stats/get", {"token": str(self.conf.get("token", "")), "type": "LastDay"}, self.tls())
        if not isinstance(d, dict) or d.get("status") != "ok":
            raise ConnectorError("jeton refusé ou réponse inattendue" if isinstance(d, dict) and d.get("status") == "invalid-token" else f"réponse inattendue ({(d or {}).get('errorMessage', 'pas Technitium ?') if isinstance(d, dict) else 'pas Technitium ?'})")
        s = (d.get("response") or {}).get("stats") or {}
        tot, blocked = num(s.get("totalQueries"), 0), num(s.get("totalBlocked"), 0)
        facts = [fact("Requêtes 24 h", int(tot)), fact("Bloquées", f"{100 * blocked / tot:.0f} %" if tot else "0 %"), fact("Clients", int(num(s.get("totalClients"), 0))),
                 fact("Erreurs", int(num(s.get("totalServerFailure"), 0)), "warn" if num(s.get("totalServerFailure"), 0) > 0 and tot and num(s.get("totalServerFailure"), 0) / tot > 0.05 else None)]
        return self.out(None, facts, [])


class TrueNAS(StatusConnector):
    """TrueNAS : pools (santé, espace), alertes actives, réplications et synchro cloud, VM et applis (SCALE). Clé d'API (Bearer), API REST v2.0 (obsolète dans les très récentes versions)."""
    type = "truenas"
    label = "TrueNAS"
    images = ()
    fields = (
        Field("url", "Adresse de TrueNAS", "url", required=True, help="https://<IP>"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Profil → Clés d'API"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans TrueNAS : icône du compte → Clés d'API → Ajouter, nom « MyServices ». Copier la clé tout de suite.",
             "Utiliser un compte aux droits de lecture seule si possible. TrueNAS 25.04+ prépare l'abandon de l'API REST au profit de JSON-RPC : à surveiller.")

    def collect(self) -> dict:
        h = {"Authorization": f"Bearer {self.conf.get('api_key', '')}"}
        info = self.get("/api/v2.0/system/info", h)
        if not isinstance(info, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à TrueNAS")
        pools = rows(self.get("/api/v2.0/pool", h))
        alerts = [a for a in rows(self.get("/api/v2.0/alert/list", h)) if not a.get("dismissed")]
        bad_pools = [p for p in pools if str(p.get("status", "ONLINE")).upper() != "ONLINE" or p.get("healthy") is False]
        crit = [a for a in alerts if str(a.get("level", "")).upper() in ("CRITICAL", "ALERT", "EMERGENCY", "ERROR")]
        facts = [fact("Pools", f"{len(pools) - len(bad_pools)}/{len(pools)} sains", "bad" if bad_pools else "ok")]
        for p in pools[:2]:
            tot, used = num(p.get("size")), num(p.get("allocated"))
            if tot:
                facts.append(fact(f"Pool {p.get('name')}", f"{100 * (used or 0) / tot:.0f} % ({size(tot)})", "bad" if (used or 0) / tot >= 0.9 else "warn" if (used or 0) / tot >= 0.8 else None))
        facts.append(fact("Alertes", len(alerts), "bad" if crit else "warn" if alerts else "ok"))
        if info.get("uptime_seconds"):
            facts.append(fact("En marche", duration(num(info.get("uptime_seconds")))))
        problems = [f"pool « {p.get('name')} » : {p.get('status')}" for p in bad_pools] + [str(a.get("formatted") or a.get("klass"))[:140] for a in alerts[:6]]
        # Backups (replications, cloud sync) and guests (VMs, apps of SCALE): optional, missing on older versions or without the right
        state = lambda x: str(((x.get("state") or {}) if isinstance(x.get("state"), dict) else {}).get("state") or ((x.get("job") or {}) if isinstance(x.get("job"), dict) else {}).get("state") or "").upper()   # noqa: E731
        jobs = [(f"réplication « {r.get('name', '?')} »", state(r)) for r in rows(self.get_opt("/api/v2.0/replication", h)) if r.get("enabled") is not False]
        jobs += [(f"synchro cloud « {c.get('description') or c.get('id', '?')} »", state(c)) for c in rows(self.get_opt("/api/v2.0/cloudsync", h)) if c.get("enabled") is not False]
        if jobs:
            failed = [n for n, st in jobs if st in ("ERROR", "FAILED", "ABORTED")]
            facts.append(fact("Sauvegardes", f"{len(jobs) - len(failed)}/{len(jobs)} réussies", "bad" if failed else "ok"))
            problems += [f"{n} en échec" for n in failed]
        vms = rows(self.get_opt("/api/v2.0/vm", h))
        apps = rows(self.get_opt("/api/v2.0/app", h))
        if vms:
            on = sum(1 for v in vms if str((v.get("status") or {}).get("state") if isinstance(v.get("status"), dict) else "").upper() == "RUNNING")
            facts.append(fact("VM", f"{on}/{len(vms)} en marche"))
        if apps:
            crashed = [a for a in apps if str(a.get("state", "")).upper() in ("CRASHED", "FAILED")]
            upd = [a for a in apps if a.get("upgrade_available") is True]
            facts.append(fact("Applis", f"{len(apps)}" + (f", {len(upd)} à mettre à jour" if upd else ""), "bad" if crashed else "warn" if upd else None))
            problems += [f"appli « {a.get('name', '?')} » : {str(a.get('state')).lower()}" for a in crashed]
        return self.out(info.get("version"), facts, problems)


class Synology(StatusConnector):
    """Synology DSM : volumes (état, espace), disques (état, SMART, température), version, tâches Hyper Backup et VM de Virtual Machine Manager. Compte dédié ; identifiants envoyés en POST."""
    type = "synology"
    label = "Synology DSM"
    images = ()
    fields = (
        Field("url", "Adresse du DSM", "url", required=True, help="https://<IP>:5001 (ou http://<IP>:5000)"),
        Field("user", "Compte", "text", required=True, help="un compte dédié, groupe « users », sans droit d'administration"),
        Field("password", "Mot de passe", "password", required=True, secret=True, help="la double authentification n'est pas gérée : désactiver pour ce compte"),
        VERIFY,
    )
    setup_fields = ("url", "user", "password")
    guide = ("Dans DSM : Panneau de configuration → Utilisateur et groupe → créer « myservices », groupe « users » seulement.",
             "Droits : lecture sur l'application « Gestionnaire de stockage » ne se règle pas finement ; le compte ne doit rien pouvoir modifier.")

    def _call(self, sid: str, api: str, method: str, version: int = 1, extra: dict | None = None):
        d = post_form(self.base_url() + "/webapi/entry.cgi", {"api": api, "version": version, "method": method, "_sid": sid, **(extra or {})}, self.tls())
        return (d or {}).get("data") if isinstance(d, dict) and d.get("success") else None

    def login(self) -> str:
        """Session DSM (compte lecture seule) : l'identifiant de session ; à fermer avec logout()."""
        d = post_form(self.base_url() + "/webapi/auth.cgi", {"api": "SYNO.API.Auth", "version": 6, "method": "login", "account": self.conf.get("user", ""),
                                                            "passwd": self.conf.get("password", ""), "session": "myservices", "format": "sid"}, self.tls())
        if not isinstance(d, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à un DSM")
        if not d.get("success"):
            code = (d.get("error") or {}).get("code")
            raise ConnectorError({400: "compte ou mot de passe refusé", 401: "compte désactivé", 402: "accès refusé", 403: "double authentification : non gérée"}.get(code, f"connexion refusée (code {code})"))
        return str((d.get("data") or {}).get("sid", ""))

    def logout(self, sid: str) -> None:
        post_form(self.base_url() + "/webapi/auth.cgi", {"api": "SYNO.API.Auth", "version": 6, "method": "logout", "session": "myservices", "_sid": sid}, self.tls())

    def collect(self) -> dict:
        sid = self.login()
        try:
            info = self._call(sid, "SYNO.DSM.Info", "getinfo", 2) or {}
            sto = self._call(sid, "SYNO.Storage.CGI.Storage", "load_info") or {}
            # Optional packages: Hyper Backup tasks and Virtual Machine Manager guests (None when the package is missing or the account may not see it)
            hb = self._call(sid, "SYNO.Backup.Task", "list", 1, {"additional": '["last_bkp_time","last_bkp_result"]'}) or {}
            vmm = self._call(sid, "SYNO.Virtualization.API.Guest", "list", 1) or {}
        finally:
            self.logout(sid)
        vols, disks = rows(sto.get("volumes")), rows(sto.get("disks"))
        bad_v = [v for v in vols if str(v.get("status", "normal")) not in ("normal",)]
        bad_d = [x for x in disks if str(x.get("status", "normal")) not in ("normal", "initialized") or str(x.get("smart_status", "normal")) not in ("normal", "")]
        facts = [fact("Volumes", f"{len(vols) - len(bad_v)}/{len(vols)} sains", "bad" if bad_v else "ok"), fact("Disques", f"{len(disks) - len(bad_d)}/{len(disks)} sains", "bad" if bad_d else "ok")]
        for v in vols[:2]:
            sz = v.get("size") or {}
            tot, used = num(sz.get("total")), num(sz.get("used"))
            if tot:
                facts.append(fact(f"Volume {v.get('id') or v.get('vol_path')}", f"{100 * (used or 0) / tot:.0f} %", "bad" if (used or 0) / tot >= 0.9 else "warn" if (used or 0) / tot >= 0.8 else None))
        if info.get("temperature") is not None:
            facts.append(fact("Température", f"{info['temperature']} °C", "warn" if num(info.get("temperature"), 0) >= 70 else None))
        problems = [f"volume {v.get('id')} : {v.get('status')}" for v in bad_v] + [f"disque {x.get('name') or x.get('id')} : {x.get('status')} (SMART {x.get('smart_status')})" for x in bad_d]
        tasks = rows(hb.get("task_list"))
        if tasks:
            last = lambda t: str(t.get("last_bkp_result") or ((t.get("additional") or {}).get("last_bkp_result") if isinstance(t.get("additional"), dict) else "") or "")   # noqa: E731
            failed = [t for t in tasks if last(t).lower() in ("failed", "error", "partial")]
            facts.append(fact("Hyper Backup", f"{len(tasks) - len(failed)}/{len(tasks)} réussies", "bad" if failed else "ok"))
            problems += [f"Hyper Backup « {t.get('name', '?')} » : {last(t)}" for t in failed]
        guests = rows(vmm.get("guests"))
        if guests:
            facts.append(fact("VM (VMM)", f"{sum(1 for g in guests if str(g.get('status')).lower() == 'running')}/{len(guests)} en marche"))
        return self.out(info.get("version_string"), facts, problems)


class UniFi(StatusConnector):
    """UniFi Network : appareils en ligne ou non, mises à jour, clients (IP / MAC pour le rapprochement). Deux accès :
    - « api_key » : console UniFi OS (UCG, UDM, UX, Cloud Key, UniFi OS Server), API d'intégration officielle, en-tête X-API-KEY ;
    - « account » : Network Application seule (Docker, port 8443), qui n'a pas de clé d'API : compte local en lecture seule, ancienne API
      (POST /api/login, cookie de session, GET /api/s/<site>/stat/…). Non documentée officiellement mais stable depuis des années."""
    type = "unifi"
    label = "UniFi Network"
    images = ("linuxserver/unifi-network-application", "jacobalberty/unifi")
    fields = (
        Field("auth", "Accès", "choice", default="api_key", choices=("api_key", "account"),
              help="api_key : console UniFi OS ; account : contrôleur en Docker (compte local)"),
        Field("url", "Adresse", "url", required=True, help="console UniFi OS : https://<IP> ; Docker : https://<IP>:8443"),
        Field("api_key", "Clé d'API (console UniFi OS)", "password", secret=True, help="Paramètres → Control Plane → Intégrations → créer une clé d'API"),
        Field("user", "Compte local (Docker)", "text", help="un administrateur local en lecture seule (« View Only »), sans double authentification"),
        Field("password", "Mot de passe (Docker)", "password", secret=True),
        VERIFY,
    )
    setup_fields = ("auth", "url", "api_key", "user", "password")
    guide = ("Console UniFi OS (UCG, UDM…) : Paramètres → Control Plane → Intégrations → « Create API Key ». La clé a les droits de l'administrateur qui la crée : la créer avec un compte en lecture seule.",
             "Contrôleur en Docker (pas de clé d'API) : Paramètres → Administrateurs → ajouter un administrateur local, rôle « View Only », accès local seulement, sans double authentification ; choisir l'accès « account », adresse https://<IP>:8443.",
             "Certificat auto-signé : décocher « Vérifier le certificat ».")
    BASE = "/proxy/network/integration/v1"
    DOWN = ("OFFLINE", "CONNECTION_INTERRUPTED", "ISOLATED")
    DOWN_CODES = (0, 6, 11)   # ancienne API : déconnecté, battement de cœur perdu, isolé
    CLIENT_PAGES = 5   # 200 clients per page

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        missing = super().validate(conf)
        need = ("user", "password") if conf.get("auth") == "account" else ("api_key",)
        return missing + [f"« {n} » requis" for n in need if conf.get(n) in (None, "")]

    def collect(self) -> dict:
        version, sites, devices, clients, total = (self._account if self.conf.get("auth") == "account" else self._api_key)()
        off = [d["name"] or d["mac"] for d in devices if not d.get("online")]
        upd = [d["name"] or d["mac"] for d in devices if d.get("updatable")]   # both kept on the rows: the Network tab shows them
        facts = [fact("Appareils", f"{len(devices) - len(off)}/{len(devices)} en ligne", "bad" if off else "ok"), fact("Clients", total), fact("Sites", sites)]
        if upd:
            facts.append(fact("Mises à jour", len(upd), "warn"))
        return {**self.out(version, facts, [f"appareil « {n} » hors ligne" for n in off] + [f"appareil « {n} » : mise à jour disponible" for n in upd]),
                "unifi": {"clients": clients, "devices": devices}}   # for the matching layer (IP / MAC), like MynetworK's UniFi lists

    def _api_key(self) -> tuple:
        h = {"X-API-KEY": str(self.conf.get("api_key", ""))}
        base = self.BASE
        info = self.get(f"{base}/info", h)
        if not isinstance(info, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à une console UniFi OS (API d'intégration de UniFi Network 9.0 ou plus)")
        sites = rows(self.get(f"{base}/sites", h))
        devices, clients, total = [], [], 0
        for s in sites[:5]:
            sid = urllib.parse.quote(str(s.get("id")), safe="")
            ds = rows(self.get(f"{base}/sites/{sid}/devices?limit=200", h))
            mac_of = {d.get("id"): d.get("macAddress") for d in ds}
            devices += [{"name": d.get("name"), "model": d.get("model"), "mac": d.get("macAddress"), "ip": d.get("ipAddress"), "state": d.get("state"),
                         "online": str(d.get("state", "ONLINE")).upper() not in self.DOWN, "updatable": d.get("firmwareUpdatable") is True} for d in ds]
            for page in range(self.CLIENT_PAGES):
                cl = self.get(f"{base}/sites/{sid}/clients?offset={page * 200}&limit=200", h)
                got = rows(cl)
                if page == 0:
                    total += int(num((cl or {}).get("totalCount"), len(got))) if isinstance(cl, dict) else len(got)
                for c in got:
                    wired = str(c.get("type")).upper() == "WIRED"
                    clients.append({"name": c.get("name"), "mac": c.get("macAddress"), "ip": c.get("ipAddress"), "wired": wired,
                                    "switch_mac" if wired else "ap_mac": mac_of.get(c.get("uplinkDeviceId"))})
                if len(got) < 200:
                    break
        return info.get("applicationVersion"), len(sites), devices, clients, total

    def _account(self) -> tuple:
        jar = http.cookiejar.CookieJar()
        ctx = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in per connector for a self-signed LAN certificate
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))
        base = self.base_url()

        def call(path: str, body: dict | None = None):
            req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method="POST" if body is not None else "GET",
                                         headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "myservices"})
            try:
                with opener.open(req, timeout=self.ctx.timeout) as r:
                    d = json.loads(r.read() or b"null")
            except urllib.error.HTTPError as e:
                if path == "/api/login" and e.code in (400, 401, 403):
                    raise ConnectorError("compte refusé : identifiant ou mot de passe faux, ou double authentification activée sur ce compte") from None
                if path == "/api/login" and e.code == 404:
                    raise ConnectorError("pas de connexion par compte ici : console UniFi OS ? choisir l'accès « api_key »") from None
                raise ConnectorError(f"HTTP {e.code}") from None
            except (OSError, ValueError) as e:
                raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
            return d.get("data") if isinstance(d, dict) else None

        call("/api/login", {"username": str(self.conf.get("user", "")), "password": str(self.conf.get("password", "")), "remember": False})
        try:
            sites = rows(call("/api/self/sites"))
            version, devices, clients = None, [], []
            for s in sites[:5]:
                site = urllib.parse.quote(str(s.get("name") or "default"), safe="")
                info = rows(call(f"/api/s/{site}/stat/sysinfo"))
                version = version or (info[0].get("version") if info else None)
                ds = rows(call(f"/api/s/{site}/stat/device"))
                devices += [{"name": d.get("name"), "model": d.get("model"), "mac": d.get("mac"), "ip": d.get("ip"), "state": d.get("state"),
                             "online": num(d.get("state"), 1) not in self.DOWN_CODES, "updatable": d.get("upgradable") is True} for d in ds]
                clients += [{"name": c.get("name") or c.get("hostname"), "mac": c.get("mac"), "ip": c.get("ip"), "wired": c.get("is_wired") is True,
                             "switch_mac" if c.get("is_wired") else "ap_mac": c.get("sw_mac") if c.get("is_wired") else c.get("ap_mac")}
                            for c in rows(call(f"/api/s/{site}/stat/sta"))[:self.CLIENT_PAGES * 200]]
        finally:
            try:
                call("/api/logout", {})   # session closed: no session left open on the controller
            except ConnectorError:
                pass
        return version, len(sites), devices, clients, len(clients)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = next((h for h, c in ports if c == 8443), None)
        return {"auth": "account", "url": f"https://{ip}:{port}", "verify_tls": False} if port else None


class Tailscale(StatusConnector):
    """Tailscale (API publique) ou Headscale (API locale) : machines du réseau privé, en ligne ou non, mises à jour et clés qui expirent."""
    type = "tailscale"
    label = "Tailscale / Headscale"
    images = ("headscale/headscale",)
    fields = (
        Field("server", "Service", "choice", required=True, default="tailscale", choices=("tailscale", "headscale")),
        Field("url", "Adresse (Headscale uniquement)", "url", help="https://headscale.exemple ; vide pour Tailscale"),
        Field("tailnet", "Tailnet (Tailscale)", "text", default="-", help="« - » = le tailnet de la clé"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Tailscale : Settings → Keys → API access token (90 j max) ; Headscale : headscale apikeys create"),
    )
    setup_fields = ("server", "url", "api_key")
    guide = ("Tailscale : https://login.tailscale.com/admin/settings/keys → « Generate access token » (expire au bout de 90 jours au plus : à renouveler).",
             "Headscale : sur le serveur, `headscale apikeys create`. Lecture seule.")

    def collect(self) -> dict:
        key = str(self.conf.get("api_key", ""))
        if str(self.conf.get("server") or "tailscale") == "headscale":
            self.conf.setdefault("url", "")
            d = self.get("/api/v1/node", {"Authorization": f"Bearer {key}"})
            nodes = [{"name": n.get("givenName") or n.get("name"), "online": bool(n.get("online")), "expiry": n.get("expiry")} for n in rows((d or {}).get("nodes") if isinstance(d, dict) else d)]
            outdated = []
        else:
            tn = urllib.parse.quote(str(self.conf.get("tailnet") or "-"), safe="-")
            d = self.ctx.http(f"https://api.tailscale.com/api/v2/tailnet/{tn}/devices", headers={"Authorization": f"Bearer {key}"})
            now, nodes, outdated = time.time(), [], []
            for n in rows((d or {}).get("devices") if isinstance(d, dict) else d):
                seen = None
                try:
                    from datetime import datetime
                    seen = datetime.fromisoformat(str(n.get("lastSeen")).replace("Z", "+00:00")).timestamp() if n.get("lastSeen") else None
                except ValueError:
                    pass
                nodes.append({"name": str(n.get("hostname") or n.get("name")), "online": seen is not None and now - seen < 300, "expiry": n.get("expires") if not n.get("keyExpiryDisabled") else None})
                if n.get("updateAvailable"):
                    outdated.append(str(n.get("hostname") or n.get("name")))
        off = [n["name"] for n in nodes if not n["online"]]
        facts = [fact("Machines", f"{len(nodes) - len(off)}/{len(nodes)} en ligne"), fact("Mises à jour", len(outdated) or "à jour", "warn" if outdated else "ok")]
        return self.out(None, facts, [f"« {n} » hors ligne" for n in off[:8]] + [f"« {n} » : mise à jour du client disponible" for n in outdated[:4]])

    def test(self):
        if str(self.conf.get("server") or "tailscale") == "headscale" and not self.conf.get("url"):
            from connectors.base import Result
            return Result(False, "adresse de Headscale requise")
        return super().test()


class NUT(StatusConnector):
    """NUT (Network UPS Tools) : onduleur, charge, batterie, autonomie, secteur. Protocole texte sur le port 3493, lecture seule (LIST, GET)."""
    type = "nut"
    label = "Onduleur (NUT)"
    images = ("upshift/nut-upsd", "instantlinux/nut-upsd")
    fields = (
        Field("host", "Adresse du serveur NUT", "text", required=True, help="IP ou nom de la machine qui exécute upsd"),
        Field("port", "Port", "number", default=3493),
        Field("ups", "Nom de l'onduleur", "text", help="vide = le premier"),
    )
    setup_fields = ("host",)
    guide = ("Le serveur NUT (upsd) doit accepter les connexions du réseau local (LISTEN dans upsd.conf) ; aucun compte n'est nécessaire pour lire.",)

    def base_url(self) -> str:   # pas d'URL : adresse brute
        return ""

    def collect(self) -> dict:
        host, port = str(self.conf.get("host", "")).strip(), int(num(self.conf.get("port"), 3493))
        if not host:
            raise ConnectorError("adresse du serveur NUT requise")
        name = str(self.conf.get("ups") or "").strip()
        if not name:
            txt = raw_tcp(host, port, b"LIST UPS\n", b"END LIST UPS")
            first = next((ln.split()[1] for ln in txt.splitlines() if ln.startswith("UPS ") and len(ln.split()) > 1), None)
            if not first:
                raise ConnectorError("aucun onduleur déclaré dans NUT")
            name = first
        txt = raw_tcp(host, port, f"LIST VAR {name}\n".encode(), b"END LIST VAR")
        v = {}
        for ln in txt.splitlines():
            if ln.startswith("VAR "):
                parts = ln.split(" ", 3)
                if len(parts) == 4:
                    v[parts[2]] = parts[3].strip('"')
        if not v:
            raise ConnectorError(f"onduleur « {name} » inconnu ou illisible")
        status = v.get("ups.status", "?").split()
        label = {"OL": "sur secteur", "OB": "sur batterie", "LB": "batterie faible", "RB": "batterie à remplacer", "CHRG": "en charge", "OVER": "surcharge"}
        bad = [s for s in status if s in ("OB", "LB", "RB", "OVER")]
        facts = [fact("Secteur", ", ".join(label.get(s, s) for s in status), "bad" if "LB" in status else "warn" if bad else "ok")]
        if num(v.get("battery.charge")) is not None:
            facts.append(fact("Batterie", f"{num(v['battery.charge']):.0f} %", "bad" if num(v["battery.charge"]) < 30 else "warn" if num(v["battery.charge"]) < 60 else "ok"))
        if num(v.get("battery.runtime")) is not None:
            facts.append(fact("Autonomie", duration(num(v["battery.runtime"]))))
        if num(v.get("ups.load")) is not None:
            facts.append(fact("Charge", f"{num(v['ups.load']):.0f} %", "warn" if num(v["ups.load"]) >= 80 else None))
        if model := v.get("ups.model") or v.get("device.model"):
            facts.insert(0, fact("Modèle", model))   # the UPS model, not a version: no « v… » badge on the connector card
        return self.out(None, facts, [f"onduleur : {label.get(s, s)}" for s in bad])


class Portainer(StatusConnector):
    """Portainer : ses environnements comme source de conteneurs (comme Dockhand) : en ligne ou non, conteneurs en marche, arrêtés,
    en mauvaise santé, d'après l'instantané que Portainer tient déjà (un seul appel, rien par conteneur). Jeton d'accès (X-API-KEY).
    Routes (GET) : /api/system/status, /api/endpoints (URL, Status 1 = en ligne, Snapshots[0])."""
    type = "portainer"
    label = "Portainer"
    kinds = ("containers",)
    images = ("portainer/portainer-ce", "portainer/portainer-ee")
    fields = (
        Field("url", "Adresse de Portainer", "url", required=True, help="https://<IP>:9443 (ou http://<IP>:9000)"),
        Field("api_key", "Jeton d'accès", "password", required=True, secret=True, help="Mon compte → Access tokens → Add access token"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Portainer : Mon compte → Access tokens → « Add access token ». Un compte non administrateur avec accès en lecture suffit.",)

    def _h(self) -> dict:
        return {"X-API-KEY": str(self.conf.get("api_key", ""))}

    def version(self) -> str | None:
        st = self.get("/api/system/status", self._h())
        if not isinstance(st, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Portainer")
        return st.get("Version")

    def collect(self) -> dict:
        envs = []
        for e in rows(self.get("/api/endpoints", self._h())):
            sn = e["Snapshots"][0] if isinstance(e.get("Snapshots"), list) and e["Snapshots"] and isinstance(e["Snapshots"][0], dict) else {}
            url = str(e.get("URL") or "")
            env = container_env(e.get("Id", e.get("Name")), e.get("Name"), None if not url or url.startswith("unix:") else url, [],
                                available=num(e.get("Status"), 1) == 1)
            run, stop = int(num(sn.get("RunningContainerCount"), 0)), int(num(sn.get("StoppedContainerCount"), 0))
            env["containers"].update({"total": int(num(sn.get("ContainerCount"), run + stop)), "running": run, "stopped": stop,
                                      "unhealthy": int(num(sn.get("UnhealthyContainerCount"), 0))})
            envs.append(env)
        return {"environments": envs, "updates": 0}

    def test(self) -> Result:
        try:
            v = self.version()
            envs = self.collect()["environments"]
        except ConnectorError as e:
            return Result(False, str(e))
        up = sum(1 for e in envs if e["available"])
        return Result(True, f"Environnements {up}/{len(envs)} en ligne, {sum(e['containers']['total'] for e in envs)} conteneur(s)", v)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        https = next((h for h, c in ports if c == 9443), None)
        plain = next((h for h, c in ports if c == 9000), None)
        return {"url": f"https://{ip}:{https}", "verify_tls": False} if https else {"url": f"http://{ip}:{plain}"} if plain else None
