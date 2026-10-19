"""Contrat d'un connecteur MyServices : un service externe (NPM, AdGuard, Beszel, Uptime Kuma…) lu par
son API ou par SSH, en lecture seule.

Un connecteur déclare :
  type      identifiant stable ("npm") ; une instance = ce type + un nom unique ("lan", "vps")
  label     nom affiché ("Nginx Proxy Manager")
  kinds     ce qu'il apporte : inventory, services, dns, health, backups, logs, alerts, status (état d'un service : version, mises à jour), network (inventaire du réseau), security (fail2ban, menaces), containers (gestionnaire Docker : environnements, mises à jour d'images), virtualization (Proxmox : VM, conteneurs, sauvegardes)
  images    images Docker qui le révèlent sur une machine (détection : « activer le connecteur ? »)
  tested    versions du service vérifiées (préfixes « 2.16 », « 2 ») : une autre version marche, mais
            est signalée « version non testée » par --check et la page
  modes     (facultatif) façons de relier le service quand elles demandent des champs différents (NPM : API directe, API par SSH,
            script npm-api.sh) : [{"id", "label", "help", "fields", "required"}] ; la page ne montre que les champs du mode choisi,
            marque ceux qui sont requis, et n'envoie que ceux-là
  fields    réglages (Field) : la page Réglages en génère le formulaire ; secret=True = jamais renvoyé
            au navigateur ni écrit dans un journal ; setup_fields : ceux que setup.py demande à la détection
et implémente :
  test()     connexion et droits, sans rien écrire ; Result(ok, message, version)
  collect()  données du passage (dict propre au type) ; ConnectorError si illisible
  version()  version du service, ou None si l'API ne la donne pas (facultatif)
  discover() réglages proposés d'après un conteneur reconnu (facultatif)
  guide     (attribut) étapes d'aide pour obtenir les accès (clé, jeton) : montrées dans la page, facultatif

Le cœur fournit le Context (HTTP avec délais, SSH par alias, journal, cache à durée de vie) et isole chaque connecteur
(run_isolated) : délai maximal, erreur capturée, dernier résultat bon réutilisé et marqué périmé, nombre
de passages en échec ; un connecteur en panne ne bloque pas les autres.
"""
from __future__ import annotations

import copy
import json
import re
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from connectors import reqstats

KINDS = ("inventory", "services", "dns", "health", "backups", "logs", "alerts", "status", "network", "security", "containers", "virtualization")


class ConnectorError(Exception):
    """Lecture impossible : message lisible par l'utilisateur, sans secret."""


class RateLimited(ConnectorError):
    """The service refused the call for now (HTTP 429): `retry_after` is the delay it asked for, in seconds, when it said one."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class Field:
    name: str
    label: str
    kind: str = "text"  # text, url, password, number, bool, choice
    required: bool = False
    secret: bool = False
    default: object = None
    help: str = ""
    choices: tuple = ()


@dataclass
class Result:
    ok: bool
    message: str
    version: str | None = None


@dataclass
class Status:
    """État d'une instance après un passage (écrit dans data.json « connectors » et l'état du cœur)."""
    type: str
    name: str
    ok: bool
    message: str
    version: str | None = None
    version_tested: bool | None = None
    stale: bool = False  # résultat du dernier passage réussi, réutilisé
    failures: int = 0  # passages consécutifs en échec
    duration_s: float = 0.0
    since: float | None = None  # début de la panne (epoch)
    extra: dict = field(default_factory=dict)
    found: list = field(default_factory=list)  # ce que la lecture a rapporté : [{name, count}]
    warning: str = ""  # lecture réussie mais incomplète (ex. ss sans root) : avertissement orange, pas une panne


class Context:
    """Ce que le cœur donne aux connecteurs : HTTP (délais, TLS au choix), SSH par alias, journal, cache. Les secrets
    des réglages arrivent déjà déchiffrés (config.load, secrets_store) : un connecteur ne touche jamais au chiffrement."""

    def __init__(self, timeout: float = 15, log=print, cache_dir: str | Path | None = None, owner: str = ""):
        self.timeout = timeout
        self.log = log
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.owner = owner   # « type/name » of the connector the calls are counted under (reqstats)

    def bound(self, owner: str) -> "Context":
        """The same context (a shallow copy: a replaced http or ssh stays), with the calls counted under `owner` (one connector instance)."""
        c = copy.copy(self)
        c.owner = owner
        return c

    def cached(self, key: str, ttl: float, fn):
        """Résultat de fn() (JSON) gardé ttl secondes sous cache_dir : un service lent ou limité n'est pas interrogé à
        chaque passage. Sans cache_dir, ou fichier illisible : fn() est appelée sans rien garder. Écriture atomique ;
        une erreur de fn() n'écrase jamais la valeur gardée."""
        f = self.cache_dir / ("connectors-" + re.sub(r"[^A-Za-z0-9._-]", "_", key)[:120] + ".json") if self.cache_dir else None
        if f:
            try:
                got = json.loads(f.read_text(encoding="utf-8"))
                if time.time() - got["at"] < ttl:
                    return got["value"]
            except (OSError, ValueError, KeyError, TypeError):
                pass
        value = fn()
        if f:
            try:
                f.parent.mkdir(parents=True, exist_ok=True)
                tmp = f.with_suffix(".tmp")
                tmp.write_text(json.dumps({"at": time.time(), "value": value}, ensure_ascii=False), encoding="utf-8")
                tmp.replace(f)
            except (OSError, TypeError, ValueError):
                pass  # cache indisponible ou valeur non sérialisable : la lecture reste bonne
        return value

    def http(self, url: str, *, method: str = "GET", body: dict | None = None, headers: dict | None = None,
             verify_tls: bool = True, timeout: float | None = None) -> object:
        """Réponse JSON décodée ; ConnectorError lisible (code HTTP, message de l'API) sinon."""
        h = {"Accept": "application/json", "User-Agent": "myservices", **(headers or {})}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        ctx = None if verify_tls else ssl._create_unverified_context()  # NOSONAR S5527 ; certificat auto-signé (box, NAS)
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout, context=ctx) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            raise self._http_failed(url, t0, e) from None
        except (OSError, ValueError) as e:
            msg = f"injoignable ({getattr(e, 'reason', e)})"
            reqstats.record(self.owner, url, (time.monotonic() - t0) * 1000, None, msg)
            raise ConnectorError(msg) from None
        reqstats.record(self.owner, url, (time.monotonic() - t0) * 1000, 200)
        try:
            return json.loads(raw or b"null")
        except ValueError:
            raise ConnectorError("réponse qui n'est pas du JSON") from None

    def _http_failed(self, url: str, t0: float, e: urllib.error.HTTPError) -> ConnectorError:
        """The error to raise for an HTTP answer in error, counted; a 429 (the service limits its calls) is a RateLimited with the delay
        asked, said in the log without the URL (it may carry a secret: the route is in the counters)."""
        msg = f"HTTP {e.code}{_api_message(e)}"
        retry = _retry_after(e) if e.code == 429 else None
        reqstats.record(self.owner, url, (time.monotonic() - t0) * 1000, e.code, msg, retry)
        if e.code != 429:
            return ConnectorError(msg)
        self.log(f"⚠ {self.owner or 'connecteur'} : HTTP 429 (trop d'appels), réessai dans {int(retry) if retry else '?'} s")
        return RateLimited(msg, retry)

    def ssh(self, alias: str, cmd: str, *, stdin: str | None = None, timeout: float | None = None) -> str:
        """Sortie de la commande sur la machine (BatchMode : jamais de mot de passe demandé). Alias « local »
        (installation classique : la collectrice elle-même) : commande lancée sur place."""
        argv = ["bash", "-c", cmd] if alias == "local" else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, cmd]
        try:
            r = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=timeout or self.timeout)
        except subprocess.TimeoutExpired:
            raise ConnectorError(f"SSH {alias} : délai dépassé") from None
        if r.returncode != 0:
            raise ConnectorError(f"SSH {alias} : {(r.stderr.strip() or f'code {r.returncode}')[-200:]}")
        return r.stdout


def _retry_after(e: urllib.error.HTTPError) -> float | None:
    """The Retry-After header in seconds (a number only: a date is rare on an API and left out)."""
    try:
        return float(e.headers.get("Retry-After", "").strip())
    except (ValueError, AttributeError):
        return None


def _api_message(e: urllib.error.HTTPError) -> str:
    try:
        body = json.loads(e.read() or b"{}")
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    err = body.get("error")  # {"error": "texte"} ou {"error": {"message": "texte"}} selon le service
    msg = body.get("message") or body.get("description") or (err.get("message") if isinstance(err, dict) else err)
    return f" : {str(msg)[:200]}" if msg else ""


class Connector:
    type = ""
    label = ""
    kinds: tuple[str, ...] = ()
    images: tuple[str, ...] = ()
    tested: tuple[str, ...] = ()
    fields: tuple[Field, ...] = ()
    modes: tuple[dict, ...] = ()
    setup_fields: tuple[str, ...] = ()  # réglages demandés par setup.py à la détection (les autres : page Réglages)
    every: int | None = None  # s, own reading period of the type by the server's readers (None: the default of the settings)

    def __init__(self, conf: dict, ctx: Context):
        self.conf = conf
        self.name = conf.get("name") or self.type
        self.ctx = ctx.bound(f"{self.type}/{self.name}") if isinstance(ctx, Context) else ctx   # a fake context in the tests stays as it is

    @classmethod
    def validate(cls, conf: dict) -> list[str]:
        """Réglages manquants (champs requis), en clair."""
        return [f"« {f.name} » requis" for f in cls.fields if f.required and conf.get(f.name) in (None, "")]

    @classmethod
    def public(cls, conf: dict) -> dict:
        """Réglages montrables (page, journal) : secrets remplacés par « configuré » / vide."""
        secret = {f.name for f in cls.fields if f.secret}
        return {k: (("configuré" if v else "") if k in secret else v) for k, v in conf.items()}

    def version(self) -> str | None:
        return None

    def test(self) -> Result:
        try:
            v = self.version()
            self.collect()
        except ConnectorError as e:
            return Result(False, str(e))
        return Result(True, "lecture OK", v)

    def collect(self) -> dict:
        raise NotImplementedError

    @classmethod
    def discover(cls, image: str, ip: str, ports: list) -> dict | None:
        """Réglages proposés pour un conteneur reconnu (image, IP de la machine, [(port hôte, port conteneur)])."""
        return None


def version_tested(version: str | None, tested: tuple[str, ...]) -> bool | None:
    """True si la version commence par un préfixe testé (« 2.16 » couvre 2.16.0, 2.16.3) ; None si inconnue."""
    tested = tuple(t.rstrip(".") for t in tested)   # « 0. » would never match: same as « 0 »
    if not version or not tested:
        return None
    return any(version == t or version.startswith(t + ".") for t in tested)


def tally(data: object) -> list[dict]:
    """Ce qu'une lecture a rapporté : pour chaque clé, le nombre d'éléments d'une liste ou d'un dictionnaire, ou la valeur d'un entier.
    Sert de preuve que le connecteur lit vraiment quelque chose (et pas seulement qu'il se connecte)."""
    if not isinstance(data, dict):
        return []
    out = []
    for k, v in data.items():
        if str(k).startswith("_") or isinstance(v, bool):
            continue
        if isinstance(v, (list, dict)):
            out.append({"name": str(k), "count": len(v)})
        elif isinstance(v, int):
            out.append({"name": str(k), "count": v})
    return out[:12]


VERSION_EVERY = 6 * 3600   # s, between two version readings of a service: it changes rarely, one request less per pass
EVERY_FIELD = Field("every", "Lecture toutes les (min)", "number", help="Période de lecture de ce connecteur par le serveur, en minutes (vide : la valeur par défaut des Réglages → Système).")
EVERY_MIN, EVERY_MAX = 60, 24 * 3600   # s, bounds of a period (one minute to one day)


def period(conn: Connector, default: float) -> float:
    """Reading period of this instance in seconds: its own « every » (minutes, from its settings), else its type's, else `default`."""
    own = conn.conf.get("every")
    if isinstance(own, (int, float)) and not isinstance(own, bool) and own > 0:
        return float(min(max(own * 60, EVERY_MIN), EVERY_MAX))
    if conn.every:
        return float(conn.every)
    return float(default)


def run_isolated(conn: Connector, state: dict, timeout: float) -> tuple[dict | None, Status]:
    """collect() avec délai maximal et erreur capturée. state : {clé: {"ok", "since", "failures", "last"}}
    (persisté par l'appelant). En échec, le dernier résultat bon est rendu, marqué périmé."""
    key = f"{conn.type}/{conn.name}"
    prev = state.get(key, {})
    box: dict = {}
    t0 = time.time()
    ver_at = prev.get("version_at")
    keep_version = isinstance(ver_at, (int, float)) and t0 - ver_at < VERSION_EVERY and prev.get("version") is not None

    def work():
        if keep_version:
            box["version"] = prev["version"]
        else:
            try:
                box["version"] = conn.version()
            except ConnectorError:
                box["version"] = None
        try:
            box["data"] = conn.collect()
        except ConnectorError as e:
            box["error"] = str(e)
        except Exception as e:  # bug du connecteur : n'arrête pas le passage
            box["error"] = f"erreur interne du connecteur ({type(e).__name__}: {e})"

    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        box["error"] = f"délai dépassé ({timeout:.0f} s)"
    # Status connectors (status_kit) find the app version while collecting, not in version()
    v = box.get("version") or (box["data"].get("version") if isinstance(box.get("data"), dict) else None)
    st = Status(conn.type, conn.name, "error" not in box, box.get("error") or "OK", v,
                version_tested(v, conn.tested), duration_s=round(time.time() - t0, 2))
    if st.ok:
        st.found = tally(box["data"])
        state[key] = {"ok": True, "failures": 0, "since": None, "last": box["data"], "version": v, "at": t0, "tried": t0,
                      "version_at": ver_at if keep_version else t0, "message": st.message, "duration_s": st.duration_s, "found": st.found}
        return box["data"], st
    st.failures = prev.get("failures", 0) + 1
    st.since = prev.get("since") or t0
    state[key] = {**prev, "ok": False, "failures": st.failures, "since": st.since, "tried": t0, "message": st.message, "duration_s": st.duration_s}
    if prev.get("last") is not None:
        st.stale = True
        st.found = tally(prev["last"])
        return prev["last"], st
    return None, st


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def recent(conn: Connector, state: dict, max_age: float) -> dict | None:
    """Last good result of this connector when read less than max_age seconds ago (by the collection or another task):
    reused instead of calling the service again for the same data."""
    prev = state.get(f"{conn.type}/{conn.name}") or {}
    at = prev.get("at")
    return prev["last"] if prev.get("ok") and prev.get("last") is not None and isinstance(at, (int, float)) and time.time() - at < max_age else None


def status_of(conn: Connector, state: dict) -> Status | None:
    """The Status of this instance as its last reading left it in the state (by the server's reader or another task): what the
    collection reports when it reuses that reading instead of calling the service again. None when it was never read."""
    prev = state.get(f"{conn.type}/{conn.name}")
    if not prev or "tried" not in prev:
        return None
    v = prev.get("version")
    st = Status(conn.type, conn.name, bool(prev.get("ok")), str(prev.get("message") or ("OK" if prev.get("ok") else "lecture en échec")), v,
                version_tested(v, conn.tested), duration_s=float(prev.get("duration_s") or 0), failures=int(prev.get("failures") or 0), since=prev.get("since"))
    if st.ok:
        st.found = prev.get("found") or tally(prev.get("last"))
    elif prev.get("last") is not None:
        st.stale, st.found = True, tally(prev["last"])
    return st


def load_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


_STATE_LOCK = threading.Lock()


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    tmp.chmod(0o600)
    tmp.replace(path)


def merge_state(path: Path, state: dict, keys: list[str] | set[str]) -> dict:
    """Writes only `keys` of `state` into the file, over what it holds now: the server's readers and the collection (another process)
    share this file and each one keeps only the entries it just read, never a whole copy loaded minutes ago. Returns the merged state."""
    with _STATE_LOCK:
        now = load_state(path)
        for k in keys:
            if k in state:
                now[k] = state[k]
        save_state(path, now)
    return now
