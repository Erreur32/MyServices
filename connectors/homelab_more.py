"""More read-only "service status" connectors: Proxmox and Docker dashboards (Pulse, Arcane), machine and GPU monitors (Glances, GpuViewR),
network (NetAlertX, Speedtest Tracker), security (Wazuh), web analytics (Umami, Rybbit), media (Tautulli) and Webmin.

Routes come from each project's documentation or OpenAPI file (GpuViewR: our own repo), checked against fake servers only, except the public
routes answered by the author's instances (Arcane /api/version, Speedtest Tracker /api/healthcheck, Glances /api/4). Tolerant field by field;
no secret in error messages.
"""
from __future__ import annotations

import base64
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from connectors.base import ConnectorError, Field, Result
from connectors.status_kit import StatusConnector, container_env, duration, fact, host_port, num, rows, size

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")
DAY_MS = 86_400_000



def _data(v):
    """{"data": x} -> x (many APIs wrap their answer), anything else unchanged."""
    return v["data"] if isinstance(v, dict) and "data" in v and len(v) <= 4 else v


class Pulse(StatusConnector):
    """Pulse (Proxmox, Docker and host monitoring): version and update, nodes, VMs, containers, active alerts, what needs attention.
    API token (X-API-Token, scope monitoring:read). Routes (GET): /api/version (public), /api/state/summary."""
    type = "pulse"
    label = "Pulse"
    images = ("rcourtman/pulse", "ghcr.io/rcourtman/pulse")
    fields = (
        Field("url", "Adresse de Pulse", "url", required=True, help="http://<IP>:7655"),
        Field("token", "Jeton d'API", "password", required=True, secret=True, help="Settings → Security → API tokens, portée monitoring:read"),
        VERIFY,
    )
    setup_fields = ("url", "token")
    guide = ("Dans Pulse : Settings → Security → API tokens → nouveau jeton avec la seule portée « monitoring:read ».",
             "MyServices ne fait que des GET (version, résumé de l'état).")

    def collect(self) -> dict:
        ver = self.get("/api/version")
        if not isinstance(ver, dict) or "version" not in ver:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Pulse")
        s = self.get("/api/state/summary", {"X-API-Token": str(self.conf.get("token", ""))})
        if not isinstance(s, dict):
            raise ConnectorError("réponse inattendue de /api/state/summary")
        verdicts = s.get("verdicts") if isinstance(s.get("verdicts"), dict) else {}
        alerts = int(num(s.get("activeAlerts"), 0))
        crit, attn = int(num(verdicts.get("critical"), 0)), int(num(verdicts.get("attention"), 0))
        facts = [fact("Nœuds", int(num(s.get("nodes"), 0))), fact("VM", int(num(s.get("vms"), 0))), fact("Conteneurs", int(num(s.get("containers"), 0))),
                 fact("Alertes actives", alerts, "bad" if alerts else "ok")]
        if crit or attn:
            facts.append(fact("À regarder", f"{crit} critique(s), {attn} à surveiller", "bad" if crit else "warn"))
        if ver.get("updateAvailable") is True:
            facts.append(fact("Mise à jour", ver.get("latestVersion") or "disponible", "warn"))
        problems = [f"« {a.get('name') or a.get('id') or '?'} » ({a.get('type') or '?'}) : {(a.get('topReason') or {}).get('code') or a.get('verdict')}"
                    for a in rows(s.get("attention")) if a.get("verdict") in ("critical", "attention")]
        if ver.get("updateAvailable") is True:
            problems.append(f"mise à jour de Pulse disponible : {ver.get('latestVersion') or '?'}")
        return self.out(str(ver.get("version")), facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 7655) or 7655}"}


class Arcane(StatusConnector):
    """Arcane (Docker manager): its environments (local Docker, remote agents) as a container source, like Dockhand: containers
    running, stopped, unhealthy, image updates found by Arcane. API key (X-Api-Key). Routes (GET): /api/version (public),
    /api/environments, /api/environments/<id>/containers (paged list: state, status « (unhealthy) », updateInfo.hasUpdate),
    /api/environments/<id>/containers/counts when the list is unreadable."""
    type = "arcane"
    label = "Arcane"
    kinds = ("containers",)
    images = ("ghcr.io/getarcaneapp/manager", "ghcr.io/getarcaneapp/arcane", "ghcr.io/ofkm/arcane")
    fields = (
        Field("url", "Adresse d'Arcane", "url", required=True, help="http://<IP>:3552"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Settings → API Keys"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Arcane : Settings → API Keys → nouvelle clé « MyServices ».",
             "MyServices ne fait que des GET (version, environnements, liste des conteneurs et leurs mises à jour d'image).")
    PAGE = 200

    def _h(self) -> dict:
        return {"X-Api-Key": str(self.conf.get("api_key", ""))}

    def _version(self) -> dict:
        if getattr(self, "_ver", None) is None:
            ver = self.get("/api/version")
            if not isinstance(ver, dict) or "currentVersion" not in ver:
                raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Arcane")
            self._ver = ver
        return self._ver

    def version(self) -> str | None:
        return str(self._version()["currentVersion"]).lstrip("v")

    def _containers(self, eid) -> list[dict] | None:
        """Every container of one environment ({name, state, health, update, image, newer}), None when the list is unreadable."""
        out, start = [], 0
        while True:
            got = self.get_opt(f"/api/environments/{eid}/containers?start={start}&limit={self.PAGE}&includeInternal=true", self._h())
            if got is None:
                return None
            page = rows(got)
            for c in page:
                upd = c.get("updateInfo") if isinstance(c.get("updateInfo"), dict) else {}
                names = c.get("names") if isinstance(c.get("names"), list) else []
                out.append({"name": str(names[0]).lstrip("/") if names else c.get("id"), "state": c.get("state"),
                            "health": "unhealthy" if "unhealthy" in str(c.get("status") or "").lower() else None,
                            "update": upd.get("hasUpdate") is True, "image": c.get("image"), "newer": upd.get("latestVersion") or None})
            total = (got.get("pagination") or {}).get("totalItems") if isinstance(got, dict) else None
            start += len(page)
            if not page or len(page) < self.PAGE or (isinstance(total, int) and start >= total):
                return out

    def collect(self) -> dict:
        ver = self._version()
        envs = []
        for e in rows(self.get("/api/environments", self._h()))[:50]:
            eid, name = e.get("id"), e.get("name") or e.get("id") or "?"
            api = str(e.get("apiUrl") or "")
            host = None if not api or "localhost" in api or "127.0.0.1" in api else api   # local Docker: Arcane's own machine (matching.py)
            if str(e.get("status", "online")).lower() not in ("online", "connected", "ok", ""):
                envs.append(container_env(eid, name, host, [], available=False))
                continue
            got = self._containers(eid)
            if got is None:   # list unreadable (older Arcane): counts only
                c = _data(self.get_opt(f"/api/environments/{eid}/containers/counts", self._h())) or {}
                env = container_env(eid, name, host, [])
                env["containers"].update({"total": int(num(c.get("totalContainers"), 0)), "running": int(num(c.get("runningContainers"), 0)),
                                          "stopped": int(num(c.get("stoppedContainers"), 0))})
                envs.append(env)
            else:
                envs.append(container_env(eid, name, host, got))
        out = {"environments": envs, "updates": sum(len(e["updates"]) for e in envs)}
        if ver.get("updateAvailable") is True:
            out["app_update"] = ver.get("newestVersion") or "?"
        return out

    def test(self) -> Result:
        try:
            d = self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        total = sum(e["containers"]["total"] for e in d["environments"])
        msg = f"{len(d['environments'])} environnement(s), {total} conteneur(s)" + (f", {d['updates']} mise(s) à jour d'image" if d["updates"] else "")
        if d.get("app_update"):
            msg += f" ; mise à jour d'Arcane disponible : {d['app_update']}"
        return Result(True, msg, self.version())

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 3552) or 3552}"}


class Glances(StatusConnector):
    """Glances: processor, memory, load, fullest disk and active alerts of one machine. No account by default (optional web password).
    Routes (GET): /api/4/status, quicklook, load, fs, system, uptime, alert (/api/3 for Glances 3)."""
    type = "glances"
    label = "Glances"
    images = ("nicolargo/glances",)
    fields = (
        Field("url", "Adresse de Glances", "url", required=True, help="http://<IP>:61208"),
        Field("username", "Utilisateur (si Glances a un mot de passe)", help="facultatif : option --password de Glances"),
        Field("password", "Mot de passe", "password", secret=True),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Glances lancé en mode web (-w) répond sans compte sur le réseau local : l'adresse suffit.",
             "Si Glances est protégé (--password), donnez l'utilisateur et le mot de passe. MyServices ne fait que des GET.")

    def collect(self) -> dict:
        h = None
        if self.conf.get("password"):
            h = {"Authorization": "Basic " + base64.b64encode(f"{self.conf.get('username') or 'glances'}:{self.conf['password']}".encode()).decode()}
        api = "/api/4"
        try:
            st = self.get(f"{api}/status", h)
        except ConnectorError as e:
            if not str(e).startswith("HTTP 404"):
                raise
            api, st = "/api/3", None   # Glances 3: no /status route
        ql = self.get(f"{api}/quicklook", h)
        if not isinstance(ql, dict) or "cpu" not in ql:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Glances")
        def opt(plugin: str):   # a plugin can be switched off in Glances (--disable-plugin): its route answers 404, or 400 « Unknown plugin »
            try:
                return self.get(f"{api}/{plugin}", h)
            except ConnectorError as e:
                if not str(e).startswith(("HTTP 404", "HTTP 400")):
                    raise
                return None
        load = opt("load") or {}
        system = opt("system") or {}
        fs = [f for f in rows(opt("fs")) if num(f.get("percent")) is not None]
        fullest = max(fs, key=lambda f: num(f.get("percent"), 0), default=None)
        cpu, mem = num(ql.get("cpu")), num(ql.get("mem"))
        facts = [fact("Processeur", f"{cpu:.0f} %" if cpu is not None else "?", "bad" if (cpu or 0) >= 90 else None),
                 fact("Mémoire", f"{mem:.0f} %" if mem is not None else "?", "bad" if (mem or 0) >= 90 else "warn" if (mem or 0) >= 80 else None)]
        if isinstance(load, dict) and num(load.get("min5")) is not None:
            facts.append(fact("Charge (5 min)", f"{num(load['min5']):.2f} / {int(num(load.get('cpucore'), 0)) or '?'} cœurs"))
        if fullest:
            p = num(fullest.get("percent"), 0)
            facts.append(fact("Disque le plus plein", f"{fullest.get('mnt_point', '?')} {p:.0f} % ({size(fullest.get('free'))} libres)",
                              "bad" if p >= 95 else "warn" if p >= 90 else None))
        if isinstance(system, dict) and system.get("hr_name"):
            facts.insert(0, fact("Système", system["hr_name"]))
        problems = [f"disque {f.get('mnt_point', '?')} plein à {num(f.get('percent'), 0):.0f} %" for f in fs if num(f.get("percent"), 0) >= 90]
        for a in opt("alert") or []:   # v4: objects; v3: [begin, end, state, type, …]
            a = a if isinstance(a, dict) else dict(zip(("begin", "end", "state", "type"), a)) if isinstance(a, list) else {}
            if a.get("end") in (-1, None) and str(a.get("state", "")).upper() in ("WARNING", "CRITICAL"):
                problems.append(f"alerte Glances {a.get('type', '?')} : {str(a['state']).lower()}")
        out = self.out((st or {}).get("version") if isinstance(st, dict) else None, facts, problems)
        out["host"] = _glances_host(cpu, mem, load, fs, opt("sensors"))
        return out

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 61208) or 61208}"}


SKIP_MOUNTS = ("/snap/", "/var/lib/docker/", "/run/", "/boot/efi", "/dev/", "/proc/", "/sys/")
# Glances in a container sees the host disks through the files mounted into it: the disk is then named after its device
NOT_A_DISK = ("/etc/", "/usr/", "/glances", "/app/", "/config", "/var/run/")


def _glances_host(cpu, mem, load, fs: list[dict], sensors) -> dict:
    """The machine Glances runs on, in the shape of a Beszel system (health.py, source « API »): processor, memory, load,
    real disks (bind mounts and snaps left out), hottest processor sensor."""
    gb = 1024 ** 3
    best: dict = {}   # device -> its shortest real mount (the same disk is often mounted several times)
    for f in fs:
        mnt, dev = str(f.get("mnt_point") or ""), f.get("device_name") or f.get("mnt_point")
        if num(f.get("size")) and not mnt.startswith(SKIP_MOUNTS) and (dev not in best or len(mnt) < len(str(best[dev].get("mnt_point")))):
            best[dev] = f
    disks = []
    for dev, f in best.items():
        mnt, total = str(f.get("mnt_point")), num(f.get("size"))
        used = num(f.get("used"), total * num(f.get("percent"), 0) / 100)
        disks.append({"mount": str(dev) if mnt.startswith(NOT_A_DISK) else mnt, "size_gb": round(total / gb, 1), "used_gb": round(used / gb, 1),
                      "used_pct": round(num(f.get("percent"), 0))})
    temps = [num(t.get("value")) for t in rows(sensors) if t.get("type") == "temperature_core" and num(t.get("value")) is not None]
    load = load if isinstance(load, dict) else {}
    out = {"status": "up", "via": "Glances", "cpu": cpu, "mem_pct": mem, "disks": disks,
           "load": [num(load.get(k), 0) for k in ("min1", "min5", "min15")] if num(load.get("min1")) is not None else None,
           "cores": int(num(load.get("cpucore"), 0)) or None, "temp": max(temps) if temps else None}
    return {k: v for k, v in out.items() if v is not None}


class GpuViewR(StatusConnector):
    """GpuViewR (our own GPU monitor): hub version, machines online, GPUs, hottest and busiest GPU. Read-only API token (gvk_…, Bearer),
    switched on in GpuViewR (Settings → API). Routes (GET): /api/v1/health, /api/v1/hosts, /api/v1/gpus (see Docs/API.md of GpuViewR)."""
    type = "gpuviewr"
    label = "GpuViewR"
    images = ("ghcr.io/erreur32/gpuviewr", "erreur32/gpuviewr")
    fields = (
        Field("url", "Adresse de GpuViewR", "url", required=True, help="http://<IP>:<port>"),
        Field("token", "Jeton d'API (gvk_…)", "password", required=True, secret=True, help="Réglages → API : activer l'API, puis créer un jeton"),
        VERIFY,
    )
    setup_fields = ("url", "token")
    guide = ("Dans GpuViewR : Réglages → API → activer l'API en lecture seule, puis créer un jeton (gvk_…, montré une seule fois).",
             "Le jeton ne peut que lire. MyServices ne fait que des GET (état du hub, machines, GPU).")

    def collect(self) -> dict:
        h = {"Authorization": f"Bearer {self.conf.get('token', '')}"}
        try:
            health = self.get("/api/v1/health", h)
        except ConnectorError as e:
            if str(e).startswith("HTTP 403") or "accès refusé" in str(e):
                raise ConnectorError("accès refusé : API désactivée dans GpuViewR (Réglages → API) ou jeton à vérifier") from None
            raise
        if not isinstance(health, dict) or "hosts_total" not in health:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à GpuViewR")
        hosts = rows((self.get("/api/v1/hosts", h) or {}).get("hosts"))
        gpus = rows((self.get("/api/v1/gpus", h) or {}).get("gpus"))
        names = {x.get("id"): x.get("label") or x.get("name") or x.get("hostname") or x.get("id") for x in hosts}
        off = [x for x in hosts if x.get("status") == "offline"]
        total, online = int(num(health.get("hosts_total"), 0)), int(num(health.get("hosts_online"), 0))
        facts = [fact("Machines", f"{online}/{total} en ligne", "bad" if off else "ok" if total else None), fact("GPU", len(gpus) or int(num(health.get("gpu_count"), 0)))]
        hot = max(gpus, key=lambda g: num(g.get("temperature"), 0), default=None)
        if hot:
            t = num(hot.get("temperature"), 0)
            facts.append(fact("GPU le plus chaud", f"{t:.0f} °C ({hot.get('name', '?')})", "bad" if t >= 85 else "warn" if t >= 80 else None))
        busy = max(gpus, key=lambda g: num(g.get("utilization"), 0), default=None)
        if busy and num(busy.get("utilization")) is not None:
            facts.append(fact("GPU le plus occupé", f"{num(busy['utilization']):.0f} %"))
        problems = [f"machine « {names.get(x.get('id')) or '?'} » hors ligne" for x in off]
        problems += [f"GPU {g.get('name', '?')} ({names.get(g.get('host_id')) or g.get('host_id', '?')}) à {num(g.get('temperature'), 0):.0f} °C"
                     for g in gpus if num(g.get("temperature"), 0) >= 85]
        out = self.out(health.get("version"), facts, problems)
        # each machine with its GPUs, for its detail in the Machines tab (matching.py: by its name, GpuViewR gives no address)
        out["machines"] = [{"name": names[x.get("id")], "hostname": x.get("hostname"), "online": x.get("status") != "offline",
                            "gpus": [{"name": g.get("name"), "temp": num(g.get("temperature")), "util": num(g.get("utilization")),
                                      "mem_used": num(g.get("memory_used")), "mem_total": num(g.get("memory_total")), "power": num(g.get("power"))}
                                     for g in gpus if g.get("host_id") == x.get("id")]} for x in hosts]
        return out


class SpeedtestTracker(StatusConnector):
    """Speedtest Tracker: last test (download, upload, ping, provider, age), failed or below thresholds. API token with the « results:read »
    ability (Bearer). Routes (GET): /api/healthcheck (public), /api/v1/results/latest."""
    type = "speedtest-tracker"
    label = "Speedtest Tracker"
    images = ("linuxserver/speedtest-tracker", "ghcr.io/alexjustesen/speedtest-tracker")
    fields = (
        Field("url", "Adresse de Speedtest Tracker", "url", required=True, help="http://<IP>:<port>"),
        Field("token", "Jeton d'API", "password", required=True, secret=True, help="/admin/api-tokens, capacité « Read results »"),
        Field("max_age_h", "Dernier test trop ancien après (heures)", "number", default=48),
        VERIFY,
    )
    setup_fields = ("url", "token")
    guide = ("Dans Speedtest Tracker : menu du compte → API Tokens (/admin/api-tokens) → nouveau jeton avec la seule capacité « Read results ».",
             "MyServices ne fait que lire le dernier résultat : il ne lance jamais de test.")

    def collect(self) -> dict:
        hc = self.get("/api/healthcheck")
        if not isinstance(hc, dict) or "message" not in hc:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Speedtest Tracker")
        try:
            r = _data(self.get("/api/v1/results/latest", {"Authorization": f"Bearer {self.conf.get('token', '')}"}))
        except ConnectorError as e:
            if str(e).startswith("HTTP 404"):
                return self.out(None, [fact("Dernier test", "aucun")], ["aucun test enregistré"])
            raise
        if not isinstance(r, dict) or "status" not in r:
            raise ConnectorError("réponse inattendue de /api/v1/results/latest")
        mbit = lambda b, o: num(b) / 1e6 if num(b) is not None else num(o) * 8 / 1e6 if num(o) is not None else None   # noqa: E731
        down, up = mbit(r.get("download_bits"), r.get("download")), mbit(r.get("upload_bits"), r.get("upload"))
        detail = r.get("data") if isinstance(r.get("data"), dict) else {}
        try:
            at = datetime.fromisoformat(str(r.get("created_at")).replace("Z", "+00:00"))
            age = time.time() - (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).timestamp()
        except ValueError:
            age = None
        failed = str(r.get("status")).lower() == "failed"
        tone = "bad" if failed else "warn" if r.get("healthy") is False else None
        facts = [fact("Descendant", f"{down:.0f} Mbit/s" if down is not None else "?", tone),
                 fact("Montant", f"{up:.0f} Mbit/s" if up is not None else "?"),
                 fact("Ping", f"{num(r.get('ping'), 0):.0f} ms" if num(r.get("ping")) is not None else "?")]
        if age is not None:
            facts.append(fact("Dernier test", f"il y a {duration(age)}", "warn" if age > num(self.conf.get("max_age_h"), 48) * 3600 else None))
        if detail.get("isp"):
            facts.append(fact("Fournisseur", detail["isp"]))
        problems = []
        if failed:
            problems.append("dernier test en échec")
        elif r.get("healthy") is False:
            problems.append("dernier test sous les seuils réglés dans Speedtest Tracker")
        if age is not None and age > num(self.conf.get("max_age_h"), 48) * 3600:
            problems.append(f"aucun test depuis {duration(age)}")
        return self.out(None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        port = host_port(ports, 80)
        https = host_port(ports, 443)
        return {"url": f"http://{ip}:{port}"} if port else {"url": f"https://{ip}:{https}", "verify_tls": False} if https else None


class NetAlertX(StatusConnector):
    """NetAlertX: devices known, connected, new and down. API token (API_TOKEN setting, Bearer) on the API server (GRAPHQL_PORT, 20212 by
    default, not the web page's 20211). Routes (GET): /devices/totals, /devices/by-status?status=down."""
    type = "netalertx"
    label = "NetAlertX"
    images = ("jokobsk/netalertx", "ghcr.io/jokob-sk/netalertx", "ghcr.io/netalertx/netalertx")
    fields = (
        Field("url", "Adresse de l'API NetAlertX", "url", required=True, help="http://<IP>:20212 (port de l'API, pas celui de la page)"),
        Field("token", "Jeton d'API", "password", required=True, secret=True, help="Settings → Core → API_TOKEN"),
        VERIFY,
    )
    setup_fields = ("url", "token")
    guide = ("Dans NetAlertX : Settings → Core → « API token » (API_TOKEN) : copiez-le ou définissez-en un.",
             "L'API répond sur son propre port (GRAPHQL_PORT, 20212 par défaut), pas sur celui de la page (20211). MyServices ne fait que des GET.")

    def collect(self) -> dict:
        h = {"Authorization": f"Bearer {self.conf.get('token', '')}"}
        t = self.get("/devices/totals", h)
        t = t if isinstance(t, list) else _data(t) if isinstance(_data(t), list) else None
        if not t or len(t) < 5:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à l'API de NetAlertX")
        total, connected, _fav, new, down = (int(num(x, 0)) for x in t[:5])
        facts = [fact("Appareils", total), fact("Connectés", connected), fact("Nouveaux", new, "warn" if new else None),
                 fact("Absents (alerte)", down, "bad" if down else "ok")]
        problems = []
        if down:
            try:
                devs = rows(self.get("/devices/by-status?status=down", h))
                problems = [f"« {d.get('devName') or d.get('devLastIP') or d.get('devMac') or '?'} » absent" for d in devs]
            except ConnectorError:
                problems = [f"{down} appareil(s) absent(s)"]
        if new:
            problems.append(f"{new} nouvel(s) appareil(s) à valider dans NetAlertX")
        return self.out(None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 20212) or 20212}"}


class Wazuh(StatusConnector):
    """Wazuh (server API, 55000): version, agents active / disconnected / never connected. Read-only API user (Basic, then a JWT).
    Routes: POST /security/user/authenticate, GET /, /agents/summary/status, /agents?status=disconnected."""
    type = "wazuh"
    label = "Wazuh"
    images = ("wazuh/wazuh-manager",)
    fields = (
        Field("url", "Adresse de l'API Wazuh", "url", required=True, help="https://<IP>:55000"),
        Field("username", "Utilisateur d'API", required=True, help="un utilisateur avec le rôle « readonly »"),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="certificat auto-signé par défaut chez Wazuh"),
    )
    setup_fields = ("url", "username", "password")
    guide = ("Dans le tableau de bord Wazuh : Server management → Security → Users → nouvel utilisateur « myservices », rôle « readonly ».",
             "L'API du serveur répond sur le port 55000 (pas celui du tableau de bord). MyServices ne fait que lire.")

    def collect(self) -> dict:
        basic = base64.b64encode(f"{self.conf.get('username', '')}:{self.conf.get('password', '')}".encode()).decode()
        try:
            auth = self.ctx.http(self.base_url() + "/security/user/authenticate", method="POST", headers={"Authorization": f"Basic {basic}"},
                                 verify_tls=self.tls())
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : utilisateur ou mot de passe de l'API Wazuh") from None
            raise
        token = ((auth or {}).get("data") or {}).get("token") if isinstance(auth, dict) else None
        if not token:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à l'API Wazuh")
        h = {"Authorization": f"Bearer {token}"}
        info = _data(self.get("/", h)) or {}
        conn = ((_data(self.get("/agents/summary/status", h)) or {}).get("connection")) or {}
        disc, never = int(num(conn.get("disconnected"), 0)), int(num(conn.get("never_connected"), 0))
        facts = [fact("Agents", f"{int(num(conn.get('active'), 0))}/{int(num(conn.get('total'), 0))} actifs", "bad" if disc else "ok"),
                 fact("Déconnectés", disc, "bad" if disc else None), fact("Jamais connectés", never, "warn" if never else None)]
        problems = []
        if disc:
            try:
                lost = rows((_data(self.get("/agents?status=disconnected&select=name&limit=20", h)) or {}).get("affected_items"))
                problems = [f"agent « {a.get('name') or a.get('id') or '?'} » déconnecté" for a in lost]
            except ConnectorError:
                problems = [f"{disc} agent(s) déconnecté(s)"]
        if never:
            problems.append(f"{never} agent(s) jamais connecté(s)")
        return self.out(str(info.get("api_version") or "").lstrip("v") or None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"https://{ip}:{host_port(ports, 55000) or 55000}", "verify_tls": False}


class _Analytics(StatusConnector):
    """Shared by web analytics connectors: one line per site over the last 24 h, a site without any visit is worth a look (tracking script lost)."""

    def sites_out(self, sites: list[tuple[str, float, float]], version=None) -> dict:
        visitors, views = sum(v for _, v, _ in sites), sum(p for _, _, p in sites)
        quiet = [n for n, _, p in sites if not p]
        facts = [fact("Sites", len(sites)), fact("Visiteurs (24 h)", f"{visitors:.0f}"), fact("Pages vues (24 h)", f"{views:.0f}")]
        busiest = max(sites, key=lambda s: s[2], default=None)
        if busiest and busiest[2]:
            facts.append(fact("Le plus visité", f"{busiest[0]} ({busiest[2]:.0f} pages)"))
        return self.out(version, facts, [f"site « {n} » : aucune page vue en 24 h (script de suivi absent ?)" for n in quiet])


def _count(v) -> float:
    """Umami 2 answers {"value": n, "prev": m}, Umami 3 a bare number."""
    return num(v.get("value"), 0) if isinstance(v, dict) else num(v, 0)


class Umami(_Analytics):
    """Umami (self-hosted): visitors and page views of each site over 24 h. A view-only account (login, then a Bearer token).
    Routes: POST /api/auth/login, GET /api/websites, /api/websites/<id>/stats."""
    type = "umami"
    label = "Umami"
    images = ("ghcr.io/umami-software/umami", "docker.umami.is/umami-software/umami", "umamisoftware/umami")
    fields = (
        Field("url", "Adresse d'Umami", "url", required=True, help="http://<IP>:3000"),
        Field("username", "Utilisateur", required=True, help="un compte « View only »"),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        VERIFY,
    )
    setup_fields = ("url", "username", "password")
    guide = ("Dans Umami : Settings → Users → nouvel utilisateur « myservices », rôle « View only », puis donnez-lui accès aux sites à suivre.",
             "MyServices se connecte avec ce compte et ne fait que lire les statistiques des dernières 24 h.")

    def collect(self) -> dict:
        try:
            login = self.ctx.http(self.base_url() + "/api/auth/login", method="POST", verify_tls=self.tls(),
                                  body={"username": self.conf.get("username", ""), "password": self.conf.get("password", "")})
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : utilisateur ou mot de passe d'Umami") from None
            raise
        token = login.get("token") if isinstance(login, dict) else None
        if not token:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Umami")
        h = {"Authorization": f"Bearer {token}"}
        end = int(time.time() * 1000)
        sites = []
        for w in rows(self.get("/api/websites?pageSize=50", h))[:20]:
            st = self.get(f"/api/websites/{w.get('id')}/stats?startAt={end - DAY_MS}&endAt={end}", h) or {}
            sites.append((w.get("name") or w.get("domain") or "?", _count(st.get("visitors")), _count(st.get("pageviews"))))
        return self.sites_out(sites)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 3000) or 3000}"}


class Rybbit(_Analytics):
    """Rybbit (self-hosted): users and page views of each site over 24 h. API key (Bearer, Settings → Account or Organization).
    Routes (GET): /api/organizations, /api/organizations/<id>/sites, /api/sites/<id>/overview."""
    type = "rybbit"
    label = "Rybbit"
    images = ("ghcr.io/rybbit-io/rybbit-client", "ghcr.io/rybbit-io/rybbit-backend")
    fields = (
        Field("url", "Adresse de Rybbit", "url", required=True, help="l'adresse de la page Rybbit (elle relaie /api vers le serveur)"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Settings → Account → API keys"),
        Field("sites", "Sites à suivre (numéros, séparés par des virgules)", help="facultatif : tous les sites de vos organisations sinon"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Rybbit : Settings → Account → API keys → nouvelle clé (elle agit avec vos droits ; une clé d'organisation voit tous ses sites).",
             "MyServices ne fait que lire le résumé des dernières 24 h de chaque site.")

    def collect(self) -> dict:
        h = {"Authorization": f"Bearer {self.conf.get('api_key', '')}"}
        wanted = [s.strip() for s in str(self.conf.get("sites") or "").split(",") if s.strip()]
        if wanted:
            found = [{"siteId": s, "name": s} for s in wanted]
        else:
            orgs = self.get("/api/organizations", h)
            if not isinstance(orgs, (list, dict)):
                raise ConnectorError("réponse inattendue : l'adresse ne mène pas à l'API de Rybbit")
            found = []
            for o in rows(orgs)[:5]:
                found += rows(o.get("sites")) or rows(self.get(f"/api/organizations/{o.get('id')}/sites", h))
        sites = []
        for s in found[:20]:
            sid = s.get("siteId") or s.get("id")
            o = _data(self.get(f"/api/sites/{sid}/overview?past_minutes_start=1440&past_minutes_end=0", h)) or {}
            sites.append((s.get("name") or s.get("domain") or str(sid), num(o.get("users"), 0), num(o.get("pageviews"), 0)))
        return self.sites_out(sites)


class Tautulli(StatusConnector):
    """Tautulli (Plex statistics): Plex reachable, streams in progress, Tautulli update. API key (query string, as Tautulli requires).
    Commands (GET /api/v2): get_tautulli_info, get_server_status, get_activity, update_check."""
    type = "tautulli"
    label = "Tautulli"
    images = ("tautulli/tautulli", "linuxserver/tautulli", "ghcr.io/tautulli/tautulli")
    fields = (
        Field("url", "Adresse de Tautulli", "url", required=True, help="http://<IP>:8181"),
        Field("api_key", "Clé d'API", "password", required=True, secret=True, help="Settings → Web Interface → API key"),
        VERIFY,
    )
    setup_fields = ("url", "api_key")
    guide = ("Dans Tautulli : Settings → Web Interface → cocher « Enable API », puis copier la clé d'API.",
             "MyServices ne fait que lire (état de Plex, lectures en cours, mise à jour).")

    def cmd(self, name: str):
        d = self.get(f"/api/v2?apikey={urllib.parse.quote(str(self.conf.get('api_key', '')))}&cmd={name}")
        resp = d.get("response") if isinstance(d, dict) else None
        if not isinstance(resp, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Tautulli")
        if resp.get("result") != "success":
            raise ConnectorError("accès refusé : clé d'API de Tautulli à vérifier" if "api" in str(resp.get("message", "")).lower() else f"Tautulli : {resp.get('message') or 'erreur'}")
        return resp.get("data") or {}

    def collect(self) -> dict:
        info = self.cmd("get_tautulli_info")
        plex = self.cmd("get_server_status")
        act = self.cmd("get_activity")
        connected = plex.get("connected") is True
        streams = int(num(act.get("stream_count"), 0))
        facts = [fact("Plex", "joignable" if connected else "injoignable", "ok" if connected else "bad"), fact("Lectures en cours", streams),
                 fact("Transcodages", int(num(act.get("stream_count_transcode"), 0)))]
        problems = [] if connected else ["Tautulli ne joint plus Plex"]
        try:
            upd = self.cmd("update_check")
            if upd.get("update") is True:
                facts.append(fact("Mise à jour", "disponible", "warn"))
                problems.append("mise à jour de Tautulli disponible")
        except ConnectorError:
            pass   # update check off (Docker images often disable it)
        return self.out(str(info.get("tautulli_version") or "").lstrip("v") or None, facts, problems)

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 8181) or 8181}"}


class Webmin(StatusConnector):
    """Webmin: reachable and version only. Webmin has no read API without an account allowed to make RPC calls, so MyServices reads the
    « Server: MiniServ/x » header of the sign-in page, without any account."""
    type = "webmin"
    label = "Webmin"
    images = ()
    fields = (
        Field("url", "Adresse de Webmin", "url", required=True, help="https://<IP>:10000"),
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="certificat auto-signé par défaut chez Webmin"),
    )
    setup_fields = ("url",)
    guide = ("Aucun compte à créer : MyServices lit seulement la version de Webmin dans l'en-tête de la page de connexion.",)

    def collect(self) -> dict:
        req = urllib.request.Request(self.base_url() + "/", headers={"User-Agent": "myservices"}, method="GET")
        ctx = None if self.tls() else ssl._create_unverified_context()  # NOSONAR S5527: opt-in per connector for a self-signed LAN certificate
        try:
            with urllib.request.urlopen(req, timeout=self.ctx.timeout, context=ctx) as r:
                server = r.headers.get("Server", "")
        except urllib.error.HTTPError as e:
            server = e.headers.get("Server", "") if e.headers else ""
        except (OSError, ValueError) as e:
            raise ConnectorError(f"injoignable ({getattr(e, 'reason', e.__class__.__name__)})") from None
        m = re.match(r"MiniServ/([\w.]+)", server)
        if not m:
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Webmin (pas d'en-tête MiniServ)")
        return self.out(m.group(1), [fact("Page de connexion", "joignable", "ok"), fact("Serveur", f"MiniServ {m.group(1)}")], [])
