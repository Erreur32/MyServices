"""Backup tools, read only, shown as status cards: Backrest (restic), borgmatic (Borg, over SSH), UrBackup and Veeam Backup for Microsoft 365.
Each says when the last good backup ran and which job failed. Never starts, stops or prunes anything.

Routes come from each project's documentation (Backrest: operations.proto), checked against fake servers only.
"""
from __future__ import annotations

import base64
import hashlib
import json
import shlex
import time
from datetime import datetime, timezone

from connectors.base import ConnectorError, Field
from connectors.status_kit import StatusConnector, duration, fact, host_port, num, post_form, rows

VERIFY = Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=True, help="à décocher pour un certificat auto-signé")
MAX_AGE = Field("max_age_h", "Sauvegarde trop ancienne après (heures)", "number", default=26)


def _age(ts) -> float | None:
    """Seconds since a timestamp: epoch seconds or milliseconds, or ISO 8601 text; None if unreadable."""
    if isinstance(ts, str) and not ts.strip().lstrip("-").isdigit():
        try:
            at = datetime.fromisoformat(ts.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return time.time() - (at if at.tzinfo else at.replace(tzinfo=timezone.utc)).timestamp()
    v = num(ts)
    if not v or v <= 0:
        return None
    return time.time() - (v / 1000 if v > 1e11 else v)


class _Backups(StatusConnector):
    """Shared: one line per job with its age and result; a job older than max_age_h or failed is a problem."""

    def jobs_out(self, jobs: list[tuple[str, float | None, str]], version=None, extra: list | None = None) -> dict:
        """jobs: (name, age in s or None, result ok / warn / bad)."""
        limit = num(self.conf.get("max_age_h"), 26) * 3600
        failed = [n for n, _, r in jobs if r == "bad"]
        old = [(n, a) for n, a, r in jobs if r != "bad" and (a is None or a > limit)]
        newest = min((a for _, a, _ in jobs if a is not None), default=None)
        facts = [fact("Tâches", len(jobs)), fact("En échec", len(failed), "bad" if failed else "ok"),
                 fact("En retard", len(old), "warn" if old else None)]
        if newest is not None:
            facts.append(fact("Dernière sauvegarde", f"il y a {duration(newest)}"))
        problems = [f"« {n} » : dernière sauvegarde en échec" for n in failed]
        problems += [f"« {n} » : " + (f"aucune sauvegarde depuis {duration(a)}" if a is not None else "aucune sauvegarde trouvée") for n, a in old]
        problems += [f"« {n} » : terminée avec avertissements" for n, _, r in jobs if r == "warn"]
        return self.out(version, facts + (extra or []), problems)


class Backrest(_Backups):
    """Backrest (restic web UI): last backup of each plan, its result and age. Optional account (Basic).
    Routes (POST, JSON RPC gateway): /v1.Backrest/GetConfig, /v1.Backrest/GetOperations."""
    type = "backrest"
    label = "Backrest"
    images = ("garethgeorge/backrest", "ghcr.io/garethgeorge/backrest")
    fields = (
        Field("url", "Adresse de Backrest", "url", required=True, help="http://<IP>:9898"),
        Field("user", "Utilisateur (si l'accès est protégé)"),
        Field("password", "Mot de passe", "password", secret=True),
        MAX_AGE, VERIFY,
    )
    setup_fields = ("url", "user", "password")
    guide = ("Backrest : le compte est celui de la page (Settings → Users), vide si l'authentification est coupée.",
             "MyServices lit la configuration et l'historique des opérations : il ne lance jamais de sauvegarde.")
    OK, WARN = ("STATUS_SUCCESS",), ("STATUS_WARNING",)
    BAD = ("STATUS_ERROR", "STATUS_SYSTEM_CANCELLED")

    def _post(self, method: str, body: dict):
        h = {}
        if self.conf.get("user"):
            h["Authorization"] = "Basic " + base64.b64encode(f"{self.conf['user']}:{self.conf.get('password', '')}".encode()).decode()
        try:
            return self.ctx.http(self.base_url() + f"/v1.Backrest/{method}", method="POST", body=body, headers=h, verify_tls=self.tls())
        except ConnectorError as e:
            if str(e).startswith(("HTTP 401", "HTTP 403")):
                raise ConnectorError("accès refusé : compte de Backrest à vérifier") from None
            raise

    def collect(self) -> dict:
        cfg = self._post("GetConfig", {})
        if not isinstance(cfg, dict) or not isinstance(cfg.get("plans", []), list):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à Backrest")
        plans = [p.get("id") for p in rows(cfg.get("plans")) if p.get("id")]
        ops = rows((self._post("GetOperations", {}) or {}).get("operations"))
        last: dict[str, dict] = {}
        for o in ops:
            if "operationBackup" not in o or o.get("status") in ("STATUS_PENDING", "STATUS_INPROGRESS"):
                continue
            pid = o.get("planId") or "?"
            if num(o.get("unixTimeStartMs"), 0) >= num((last.get(pid) or {}).get("unixTimeStartMs"), -1):
                last[pid] = o
        jobs = []
        for pid in plans or list(last):
            o = last.get(pid)
            st = (o or {}).get("status")
            jobs.append((pid, _age((o or {}).get("unixTimeEndMs") or (o or {}).get("unixTimeStartMs")) if o else None,
                         "bad" if st in self.BAD else "warn" if st in self.WARN else "ok"))
        return self.jobs_out(jobs, extra=[fact("Dépôts", len(rows(cfg.get("repos"))))])

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        return {"url": f"http://{ip}:{host_port(ports, 9898) or 9898}"}


class Borgmatic(_Backups):
    """borgmatic (Borg): last archive of each repository, read over SSH with « borgmatic repo-list --last 1 --json » (rlist before
    borgmatic 1.9). The repository passphrase stays in borgmatic's own configuration on the machine; MyServices only reads the list."""
    type = "borgmatic"
    label = "borgmatic (Borg)"
    images = ("ghcr.io/borgmatic-collective/borgmatic", "b3vis/borgmatic")
    fields = (
        Field("ssh", "Alias SSH de la machine", required=True, help="celle où tourne borgmatic (compte qui lit sa configuration, root en général)"),
        Field("config", "Fichier de configuration", help="facultatif : /etc/borgmatic/config.yaml par défaut"),
        Field("container", "Conteneur borgmatic", help="facultatif : borgmatic tourne dans ce conteneur Docker"),
        MAX_AGE,
    )
    setup_fields = ("ssh",)
    guide = ("borgmatic doit déjà savoir lire ses dépôts (phrase de passe dans sa configuration). MyServices lance seulement « borgmatic repo-list --last 1 --json » par SSH.",
             "Rien n'est créé ni supprimé : ni sauvegarde, ni purge, ni vérification.")

    def collect(self) -> dict:
        conf = f" -c {shlex.quote(self.conf['config'])}" if self.conf.get("config") else ""
        run = f"docker exec {shlex.quote(self.conf['container'])} " if self.conf.get("container") else ""
        cmd = f"{run}borgmatic{conf} repo-list --last 1 --json 2>/dev/null || {run}borgmatic{conf} rlist --last 1 --json"
        out = self.ctx.ssh(str(self.conf.get("ssh", "")), cmd, timeout=120)
        try:
            repos = json.loads(out[out.find("["):]) if "[" in out else None
        except ValueError:
            repos = None
        if not isinstance(repos, list):
            raise ConnectorError("borgmatic : réponse illisible (borgmatic installé, configuration lisible par ce compte ?)")
        jobs = []
        for r in rows(repos):
            repo = r.get("repository") if isinstance(r.get("repository"), dict) else {}
            name = repo.get("label") or repo.get("location") or "?"
            last = (rows(r.get("archives")) or [{}])[-1]
            jobs.append((str(name), _age(last.get("end") or last.get("start")) if last else None, "ok"))
        return self.jobs_out(jobs)


class UrBackup(_Backups):
    """UrBackup server: clients online, last file and image backup, failed ones. Web account (or anonymous access when allowed): the web API's
    salt and PBKDF2 login. Routes: POST /x?a=salt, /x?a=login, /x?a=status."""
    type = "urbackup"
    label = "UrBackup"
    images = ("uroni/urbackup-server",)
    fields = (
        Field("url", "Adresse d'UrBackup", "url", required=True, help="http://<IP>:55414"),
        Field("user", "Utilisateur", help="un compte en lecture ; vide si l'accès anonyme est permis"),
        Field("password", "Mot de passe", "password", secret=True),
        MAX_AGE, VERIFY,
    )
    setup_fields = ("url", "user", "password")
    guide = ("Dans UrBackup : Settings → Users → nouvel utilisateur « myservices » avec seulement le droit de voir l'état (status, lastacts).",
             "MyServices ne fait que lire l'état des clients : il ne lance jamais de sauvegarde.")

    def _x(self, action: str, form: dict):
        d = post_form(self.base_url() + f"/x?a={action}", form, self.tls(), self.ctx.timeout)
        if not isinstance(d, dict):
            raise ConnectorError("réponse inattendue : l'adresse ne mène pas à UrBackup")
        return d

    def _login(self) -> str:
        user = str(self.conf.get("user") or "")
        if not user:
            d = self._x("login", {})
            if not d.get("success"):
                raise ConnectorError("accès refusé : l'accès anonyme est coupé, donner un compte")
            return str(d.get("session", ""))
        s = self._x("salt", {"username": user})
        if not s.get("ready"):
            raise ConnectorError("accès refusé : utilisateur inconnu d'UrBackup")
        pw = hashlib.md5((str(s.get("salt", "")) + str(self.conf.get("password", ""))).encode(), usedforsecurity=False).hexdigest()  # NOSONAR S4790: UrBackup's login challenge imposes MD5; nothing is stored
        if num(s.get("pbkdf2_rounds"), 0):
            pw = hashlib.pbkdf2_hmac("sha256", bytes.fromhex(pw), str(s["salt"]).encode(), int(num(s["pbkdf2_rounds"]))).hex()
        d = self._x("login", {"username": user, "password": hashlib.md5((str(s.get("rnd", "")) + pw).encode(), usedforsecurity=False).hexdigest(), "ses": s.get("ses", "")})  # NOSONAR S4790: UrBackup's login challenge imposes MD5; nothing is stored
        if not d.get("success"):
            raise ConnectorError("accès refusé : utilisateur ou mot de passe d'UrBackup")
        return str(s.get("ses") or d.get("session", ""))

    def collect(self) -> dict:
        st = self._x("status", {"ses": self._login()})
        clients = rows(st.get("status"))
        jobs, offline = [], []
        for c in clients:
            name = str(c.get("name") or "?")
            ok = c.get("file_ok") is not False and c.get("image_ok") is not False
            ages = [a for a in (_age(c.get("lastbackup")), _age(c.get("lastbackup_image"))) if a is not None]
            jobs.append((name, min(ages) if ages else None, "ok" if ok else "bad"))
            if c.get("online") is False:
                offline.append(name)
        out = self.jobs_out(jobs, version=st.get("server_version") or None, extra=[fact("Clients hors ligne", len(offline), "warn" if offline else None)])
        return out


class Veeam365(_Backups):
    """Veeam Backup for Microsoft 365 (REST API, port 4443): version, jobs and their last result. Account (OAuth « password » grant).
    Routes: POST /<v>/Token, GET /<v>/ServiceInstance, /<v>/Jobs."""
    type = "veeam-m365"
    label = "Veeam Backup for Microsoft 365"
    images = ()
    fields = (
        Field("url", "Adresse du serveur", "url", required=True, help="https://<IP>:4443"),
        Field("user", "Compte", required=True, help="un compte du serveur Veeam (rôle en lecture si possible)"),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        Field("api_version", "Version de l'API", "choice", default="v8", choices=("v8", "v7", "v6")),
        MAX_AGE,
        Field("verify_tls", "Vérifier le certificat HTTPS", "bool", default=False, help="certificat auto-signé par défaut chez Veeam"),
    )
    setup_fields = ("url", "user", "password")
    guide = ("Sur le serveur Veeam Backup for Microsoft 365 : General Options → REST API → activer l'API (port 4443).",
             "Le compte est un compte Windows du serveur ; MyServices ne fait que lire l'état des tâches.")

    def collect(self) -> dict:
        v = str(self.conf.get("api_version") or "v8")
        tok = post_form(self.base_url() + f"/{v}/Token", {"grant_type": "password", "username": self.conf.get("user", ""),
                                                          "password": self.conf.get("password", "")}, self.tls(), self.ctx.timeout)
        if not isinstance(tok, dict) or not tok.get("access_token"):
            raise ConnectorError("accès refusé : compte du serveur Veeam à vérifier")
        h = {"Authorization": f"Bearer {tok['access_token']}"}
        info = self.get_opt(f"/{v}/ServiceInstance", h) or {}
        res = {"success": "ok", "warning": "warn", "failed": "bad", "error": "bad"}
        jobs = [(str(j.get("name") or "?"), _age(j.get("lastRun")), res.get(str(j.get("lastStatus") or "").lower(), "ok"))
                for j in rows(self.get(f"/{v}/Jobs", h)) if j.get("isEnabled") is not False]
        return self.jobs_out(jobs, version=info.get("version") if isinstance(info, dict) else None)
