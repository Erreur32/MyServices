"""Connecteurs « état d'un service » du homelab, en lecture seule : pare-feu (OPNsense), sécurité (CrowdSec), DNS (Pi-hole v6, Technitium),
stockage (TrueNAS, Synology DSM), réseau (UniFi, Tailscale / Headscale), onduleur (NUT) et conteneurs (Portainer).

Les routes viennent de la documentation de chaque service, décrites de mémoire : à confirmer contre un vrai service (voir docs/IDEES-CONNECTEURS.md).
Lecture tolérante champ par champ ; aucun secret dans les messages d'erreur.
"""
from __future__ import annotations

import base64
import time
import urllib.parse

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, fact, num, post_form, raw_tcp, rows, size, duration

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
    """TrueNAS : pools (santé, espace), alertes actives. Clé d'API (Bearer), API REST v2.0 (obsolète dans les très récentes versions)."""
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
        return self.out(info.get("version"), facts, [f"pool « {p.get('name')} » : {p.get('status')}" for p in bad_pools] + [str(a.get("formatted") or a.get("klass"))[:140] for a in alerts[:6]])


class Synology(StatusConnector):
    """Synology DSM : volumes (état, espace), disques (état, SMART, température), version. Compte dédié ; identifiants envoyés en POST."""
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

    def collect(self) -> dict:
        d = post_form(self.base_url() + "/webapi/auth.cgi", {"api": "SYNO.API.Auth", "version": 6, "method": "login", "account": self.conf.get("user", ""),
                                                            "passwd": self.conf.get("password", ""), "session": "myservices", "format": "sid"}, self.tls())
        if not isinstance(d, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à un DSM")
        if not d.get("success"):
            code = (d.get("error") or {}).get("code")
            raise ConnectorError({400: "compte ou mot de passe refusé", 401: "compte désactivé", 402: "accès refusé", 403: "double authentification : non gérée"}.get(code, f"connexion refusée (code {code})"))
        sid = str((d.get("data") or {}).get("sid", ""))
        try:
            info = self._call(sid, "SYNO.DSM.Info", "getinfo", 2) or {}
            sto = self._call(sid, "SYNO.Storage.CGI.Storage", "load_info") or {}
        finally:
            post_form(self.base_url() + "/webapi/auth.cgi", {"api": "SYNO.API.Auth", "version": 6, "method": "logout", "session": "myservices", "_sid": sid}, self.tls())
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
        return self.out(info.get("version_string"), facts, problems)


class UniFi(StatusConnector):
    """UniFi Network (API d'intégration 9.x) sur une console UniFi OS (UCG, UDM, Cloud Key) ou en Docker (Network Application, port 8443) :
    appareils en ligne ou non, mises à jour, nombre de clients. Clé d'API (en-tête X-API-KEY)."""
    type = "unifi"
    label = "UniFi Network"
    images = ("linuxserver/unifi-network-application", "jacobalberty/unifi")
    fields = (
        Field("url", "Adresse du contrôleur", "url", required=True, help="https://<IP> (console UniFi OS) ou https://<IP>:8443 (Docker)"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="UniFi Network → Paramètres → Intégrations → créer une clé d'API"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("UniFi Network 9.0 ou plus. Console UniFi OS (UCG, UDM) : Paramètres → Control Plane → Intégrations ; Docker : Paramètres → Intégrations. « Create API Key ».",
             "Adresse : https://<IP> pour une console, https://<IP>:8443 pour le Docker. Certificat auto-signé : décocher « Vérifier le certificat ».",
             "Pour la lecture par MynetworK (clients, appareils), le connecteur MynetworK reste à privilégier s'il est déjà relié.")
    BASES = ("/proxy/network/integration/v1", "/integration/v1")   # console UniFi OS, puis Network Application seule (Docker)
    DOWN = ("OFFLINE", "CONNECTION_INTERRUPTED", "ISOLATED")

    def _info(self, h: dict) -> tuple[str, dict]:
        for base in self.BASES:
            try:
                info = self.get(f"{base}/info", h)
            except ConnectorError as e:
                if str(e).startswith("HTTP 404"):
                    continue
                raise
            if isinstance(info, dict):
                return base, info
        raise ConnectorError("API d'intégration introuvable : UniFi Network 9.0 ou plus requis (https://<IP> pour une console, :8443 pour le Docker)")

    def collect(self) -> dict:
        h = {"X-API-KEY": str(self.conf.get("api_key", ""))}
        base, info = self._info(h)
        sites = rows(self.get(f"{base}/sites", h))
        devs, clients, off, upd = 0, 0, [], []
        for s in sites[:5]:
            sid = urllib.parse.quote(str(s.get("id")), safe="")
            ds = rows(self.get(f"{base}/sites/{sid}/devices?limit=200", h))
            devs += len(ds)
            off += [d.get("name") or d.get("macAddress") for d in ds if str(d.get("state", "ONLINE")).upper() in self.DOWN]
            upd += [d.get("name") or d.get("macAddress") for d in ds if d.get("firmwareUpdatable") is True]
            cl = self.get(f"{base}/sites/{sid}/clients?limit=1", h)
            clients += int(num((cl or {}).get("totalCount"), 0)) if isinstance(cl, dict) else 0
        facts = [fact("Appareils", f"{devs - len(off)}/{devs} en ligne", "bad" if off else "ok"), fact("Clients", clients), fact("Sites", len(sites))]
        if upd:
            facts.append(fact("Mises à jour", len(upd), "warn"))
        return self.out(info.get("applicationVersion"), facts, [f"appareil « {n} » hors ligne" for n in off] + [f"appareil « {n} » : mise à jour disponible" for n in upd])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = next((h for h, c in ports if c == 8443), None)
        return {"url": f"https://{ip}:{port}", "verify_tls": False} if port else None


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
        return self.out(v.get("ups.model") or v.get("device.model"), facts, [f"onduleur : {label.get(s, s)}" for s in bad])


class Portainer(StatusConnector):
    """Portainer : environnements (en ligne ou non), conteneurs en marche, arrêtés, en mauvaise santé. Jeton d'accès (X-API-KEY)."""
    type = "portainer"
    label = "Portainer"
    images = ("portainer/portainer-ce", "portainer/portainer-ee")
    fields = (
        Field("url", "Adresse de Portainer", "url", required=True, help="https://<IP>:9443 (ou http://<IP>:9000)"),
        Field("api_key", "Jeton d'accès", "password", required=True, secret=True, help="Mon compte → Access tokens → Add access token"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Portainer : Mon compte → Access tokens → « Add access token ». Un compte non administrateur avec accès en lecture suffit.",)

    def collect(self) -> dict:
        h = {"X-API-KEY": str(self.conf.get("api_key", ""))}
        st = self.get("/api/system/status", h)
        envs = rows(self.get("/api/endpoints", h))
        if not isinstance(st, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Portainer")
        down = [e for e in envs if num(e.get("Status"), 1) != 1]
        run = stop = unhealthy = 0
        for e in envs:
            sn = (e.get("Snapshots") or [{}])[0] if isinstance(e.get("Snapshots"), list) and e.get("Snapshots") else {}
            run += int(num(sn.get("RunningContainerCount"), 0))
            stop += int(num(sn.get("StoppedContainerCount"), 0))
            unhealthy += int(num(sn.get("UnhealthyContainerCount"), 0))
        facts = [fact("Environnements", f"{len(envs) - len(down)}/{len(envs)} en ligne", "bad" if down else "ok"), fact("Conteneurs", f"{run} en marche"),
                 fact("Arrêtés", stop, "warn" if stop else None), fact("Unhealthy", unhealthy, "bad" if unhealthy else "ok")]
        return self.out(st.get("Version"), facts, [f"environnement « {e.get('Name')} » hors ligne" for e in down] + ([f"{unhealthy} conteneur(s) unhealthy"] if unhealthy else []))

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        https = next((h for h, c in ports if c == 9443), None)
        plain = next((h for h, c in ports if c == 9000), None)
        return {"url": f"https://{ip}:{https}", "verify_tls": False} if https else {"url": f"http://{ip}:{plain}"} if plain else None
