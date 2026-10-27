#!/usr/bin/env python3
"""MyServices en conteneur : planificateur + page + API (api.py, FastAPI), en un seul processus.

Remplace les unités systemd de l'installation classique :
  myservices.timer / -watcher / -health / -backups  -> planificateur interne (horaires ci-dessous)
  myservices-refresh-api + myservices-refresh.path  -> POST /api/v1/refresh (api.py)
  nginx / Apache                                    -> page servie ici (aucune config web à écrire)

Les scripts (myservices.py, watcher.py, health.py, backups.py) tournent inchangés, chacun dans son
processus, un seul passage à la fois par tâche, avec un délai maximal.

Page: / (the old /myservices/ addresses are still understood) ; fichiers produits (data.json, events.json, health/, backups.json) lus dans
MYSERVICES_WEB_DIR (volume /data), le reste (index.html, js, logos) dans web/ de l'image.
Accès : réseaux de MYSERVICES_ALLOW seulement (défaut : réseaux privés, Tailscale 100.64.0.0/10, boucle locale).
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

# Started as a script, this module is « __main__ »: api.py then does `import server` and would get a second copy, with its own
# TASKS and lock, which the scheduler never touches (the tasks page saw no run and no scheduler). One module under both names.
if __name__ == "__main__":
    sys.modules.setdefault("server", sys.modules[__name__])

import fast
import netscan
import pulse
from config import CFG

HERE = Path(__file__).resolve().parent
STATIC = HERE / "web"
WEB = Path(CFG["web_dir"])
PREFIX = "/"
PORT = int(os.environ.get("MYSERVICES_PORT", "8090"))
COOLDOWN = int(os.environ.get("MYSERVICES_REFRESH_COOLDOWN", "300"))
PROGRESS = os.environ.get("MYSERVICES_PROGRESS") or str(Path(CFG["state_dir"]) / "progress.json")
ALLOW = [ipaddress.ip_network(n.strip(), strict=False) for n in os.environ.get(
    "MYSERVICES_ALLOW", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,127.0.0.0/8,::1/128").split(",") if n.strip()]


def _hours(spec: str) -> set[int] | None:
    return None if spec in ("", "*") else {int(x) for x in spec.split(",")}


def parse_at(spec: str) -> tuple[set[int], set[int] | None]:
    """« minutes heures » (« 10,40 * », « 5 7,19 ») -> (minutes, heures ou None = toutes) ; ValueError sinon."""
    minutes, _, hours = spec.strip().partition(" ")
    mins, hrs = {int(x) for x in minutes.split(",")}, _hours(hours.strip())
    if not mins or not all(0 <= m <= 59 for m in mins) or (hrs is not None and not all(0 <= h <= 23 for h in hrs)):
        raise ValueError("minutes 0-59, heures 0-23 ou *")
    return mins, hrs


# Tâche -> (script, horaire par défaut, délai max en s). Mêmes horaires que install.sh. Priorité :
# MYSERVICES_<TÂCHE>_AT (fixe, non modifiable dans la page) > « schedule » de config.json (Réglages → Système) > défaut.
DEFAULTS_AT = {"collect": ("myservices.py", "0,15,30,45 *", 900), "watch": ("watcher.py", "5,20,35,50 *", 300),
               "health": ("health.py", "0 0,2,4,6,8,10,12,14,16,18,20,22", 600), "backups": ("backups.py", "5 1,7,13,19", 900)}
TASKS = {}
for name, (script, at, timeout) in DEFAULTS_AT.items():
    env = os.environ.get(f"MYSERVICES_{name.upper()}_AT")
    spec = env or (CFG.get("schedule") or {}).get(name) or at
    try:
        mins, hrs = parse_at(spec)
    except ValueError:
        print(f"horaire « {spec} » de {name} illisible : défaut {at}", flush=True)
        spec, (mins, hrs) = at, parse_at(at)
    TASKS[name] = {"script": script, "minutes": mins, "hours": hrs, "at": spec, "fixed": bool(env),
                   "timeout": timeout, "proc": None, "start": None, "end": None, "result": None, "trigger": None}
LOCK = threading.Lock()
# Last run of each task, kept on disk: a restart of the container no longer shows them as « not run yet »
LAST_RUNS = Path(CFG["state_dir"]) / "tasks-last.json"
try:
    for _name, _last in json.loads(LAST_RUNS.read_text(encoding="utf-8")).items():
        if _name in TASKS:
            TASKS[_name].update(start=_last.get("start"), end=_last.get("end"), result=_last.get("result"))
except (OSError, ValueError, AttributeError):
    pass


def save_last_runs() -> None:
    last = {n: {"start": t["start"], "end": t["end"], "result": t["result"]} for n, t in TASKS.items() if t["end"]}
    try:
        tmp = LAST_RUNS.with_suffix(".tmp")
        tmp.write_text(json.dumps(last), encoding="utf-8")
        tmp.replace(LAST_RUNS)
    except OSError as e:
        log(f"⚠ dernier passage des tâches non gardé : {e}")


def log(msg: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


def enabled(name: str) -> bool:
    """Rien sans services-meta.json (installation pas encore configurée) ; santé : toujours, sauf quand un
    health-watcher externe est branché (health_url autre que vide ou "health/") ; sauvegardes : seulement si backups-meta.json existe."""
    if not Path(CFG["meta"]).exists():
        return False
    if name == "health":
        return CFG["health_url"] in ("", "health/")
    if name == "backups":
        return Path(CFG["backups_meta"]).exists()
    return True


def run_task(name: str, why: str, args: tuple = ()) -> bool:
    """Lance la tâche si elle ne tourne pas déjà ; False sinon. Le watcher suit chaque collecte. args : arguments du script
    (ex. health.py --only <ip> : une seule machine)."""
    t = TASKS[name]
    with LOCK:
        if t["proc"] is not None:
            return False
        env = dict(os.environ, MYSERVICES_PROGRESS=PROGRESS, PYTHONDONTWRITEBYTECODE="1")
        if name in ("watch", "health") and alerts_on():
            env["MYSERVICES_ALERTS_ENGINE"] = "1"  # Réglages → Alertes envoie : le script se tait (pas de doublon)
        t["proc"] = subprocess.Popen([sys.executable, str(HERE / t["script"]), *args], cwd=HERE, env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t["start"], t["end"], t["result"] = time.time(), None, None
    log(f"{name} : démarré ({why})")
    threading.Thread(target=_wait, args=(name,), daemon=True).start()
    return True


def run_chain(names: list[str], why: str) -> None:
    """Lance des tâches l'une après l'autre en arrière-plan (ex. santé puis collecte : la collecte ne publie la santé
    qu'une fois son relevé écrit). Une tâche déjà en cours est attendue, jamais doublée."""
    def go() -> None:
        for name in names:
            for _ in range(600):
                if run_task(name, why):
                    break
                time.sleep(1)
            else:
                continue
            while TASKS[name]["proc"] is not None:
                time.sleep(1)
    threading.Thread(target=go, daemon=True, name="chain").start()


def alerts_on() -> bool:
    try:
        return alerts_store().active()
    except Exception as e:  # base illisible : les scripts gardent leurs propres envois
        log(f"⚠ alertes : {e}")
        return False


def _wait(name: str) -> None:
    t = TASKS[name]
    proc = t["proc"]
    timer = threading.Timer(t["timeout"], proc.kill)
    timer.start()
    for line in proc.stdout:  # sortie du script dans le journal du conteneur
        print(f"  [{name}] {line.rstrip()}", flush=True)
    code = proc.wait()
    timer.cancel()
    result = "success" if code == 0 else "timeout" if code == -9 else f"exit-code {code}"
    if name == "collect" and code == 0:
        keep_availability()
        threading.Thread(target=auto_backup_default, daemon=True, name="auto-backup").start()
        threading.Thread(target=auto_adguard, daemon=True, name="auto-adguard").start()
    if name in ("collect", "health", "backups") and code == 0:
        build_map()  # avant de libérer la tâche : les cartes suivent toujours les fichiers qu'elles montrent
    if name in ("watch", "health") and code == 0:
        keep_history(name, alert=True)
    if name == "health" and code == 0:
        keep_metrics()
    with LOCK:
        t.update(proc=None, end=time.time(), result=result)
    save_last_runs()
    log(f"{name} : terminé, {result} ({t['end'] - t['start']:.0f} s)")
    if name == "collect" and code == 0 and enabled("watch"):
        run_chain(["watch"], "après la collecte")   # its events at once, not at the next :15 / :45 (a run on the same data.json counts for nothing twice)


_AUTO_ADGUARD = threading.Lock()


def auto_adguard() -> None:
    """Après une collecte : AdGuard Home vu dans les conteneurs d'une machine lue par SSH = connecteur AdGuard branché (« adguard » posé dans
    services-meta.json), une seule fois par machine ; la collecte suivante le lit et active l'onglet DNS."""
    if not _AUTO_ADGUARD.acquire(blocking=False):
        return
    try:
        import autodetect
        import setup
        meta = json.loads(setup.META.read_text(encoding="utf-8")) if setup.META.exists() else {}
        dock = json.loads((Path(CFG["cache_dir"]) / "docker.json").read_text(encoding="utf-8")).get("data", {})
        found = autodetect.adguard(meta.get("machines", {}), dock, Path(CFG["state_dir"]) / "adguard-auto.json")
        if found:
            for ip, name in found.items():
                meta["machines"][ip]["adguard"] = name
                log(f"AdGuard Home trouvé sur {meta['machines'][ip].get('name', ip)} ({name}) : connecteur branché automatiquement (Réglages → Machines pour le retirer)")
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()):
                setup.save(setup.META, meta)
            run_chain(["collect"], "AdGuard Home trouvé")
    except (OSError, ValueError, KeyError) as e:
        log(f"⚠ détection d'AdGuard : {type(e).__name__}: {e}")
    finally:
        _AUTO_ADGUARD.release()


_AUTO_BACKUP = threading.Lock()


def auto_backup_default() -> None:
    """Après une collecte : /home/backup trouvé sur une machine lue par SSH pour la première fois = sauvegarde suivie tout de suite
    (config « backups_auto »). Un seul passage à la fois ; rien ne bloque la collecte."""
    if not CFG.get("backups_auto", True) or not _AUTO_BACKUP.acquire(blocking=False):
        return
    try:
        import backups_admin
        import system
        added = backups_admin.auto_default(Path(CFG["state_dir"]) / "backups-auto.json")
        for a in added:
            log(f"sauvegardes : {a['path']} trouvé sur {a['name']}, suivi automatiquement (Réglages → Sauvegardes pour le retirer)")
        if added:
            if not CFG.get("backups_url"):
                system.set_backups_url(sys.modules[__name__], "backups.json")
            # one run for all the machines found (one per machine queued a full collection each, two minutes apiece)
            run_chain(["backups", "collect"], "sauvegarde automatique de " + ", ".join(a["name"] for a in added))
    except Exception as e:  # noqa: BLE001 : jamais bloquant
        log(f"⚠ sauvegardes automatiques : {type(e).__name__}: {e}")
    finally:
        _AUTO_BACKUP.release()


PULSE = pulse.Pulse(WEB / "pulse.json", CFG["pulse_confirm"])


def pulse_ips() -> list[str]:
    """Followed machines of the last collection, minus the ones switched off in Settings (no ping for them)."""
    try:
        data = json.loads((WEB / "data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [m["ip"] for m in data.get("machine_list", []) if m.get("ip") and not m.get("disabled")]


HEALTH_TRIED: dict = {}


def pulse_stale_health() -> list[str]:
    """Machines whose health says « unreachable » while they answer the ping: a snapshot older than the machine's return."""
    if not enabled("health"):
        return []
    try:
        stats = json.loads((WEB / "health" / "stats.json").read_text(encoding="utf-8"))
        age = time.time() - datetime.fromisoformat(stats["timestamp"]).timestamp()
    except (OSError, ValueError, KeyError, TypeError):
        return []
    return pulse.contradicted(stats.get("hosts") or [], PULSE.state, age, HEALTH_TRIED, time.time())


def pulse_loop() -> None:
    """Ping every machine every `pulse_every` s; a confirmed change starts the watcher at once (its events, history and alerts)
    and a health reading of that machine alone."""
    owed = pulse.Owed()
    while True:
        t0, every = time.time(), CFG["pulse_every"]   # read again at every pass: a change in the settings applies at once
        PULSE.confirm = max(1, CFG["pulse_confirm"])
        try:
            ips = pulse_ips() if every > 0 else []
            if ips:
                owed.add(PULSE.tick(ips))
                owed.health += [ip for ip in pulse_stale_health() if ip not in owed.health]
            # the machine that moved also gets its health read again at once (not at the next 6 h pass), alone
            owed.settle(lambda: run_task("watch", "pouls"), lambda ip: run_task("health", f"ping de {ip} changé (pouls)", ("--only", ip)),
                        enabled("watch"), enabled("health"))
        except Exception as e:  # a bug here must not stop the pulse
            log(f"⚠ pouls : {e}")
        time.sleep(max(1.0, (every or 5) - (time.time() - t0)))


def fast_loop() -> None:
    """One reader per connector (readers.py): every few seconds the connectors that are due are read, their readings go to the shared
    state, and live.json is derived from it for the page. `fast_every` (Settings → System) is the default period, 0 = off."""
    import readers
    last: dict = {}
    while True:
        t0 = time.time()
        try:
            if readers.on(CFG) and enabled("collect"):
                last = readers.cycle(CFG, Path(CFG["state_dir"]) / "connectors.json", WEB / "live.json", pulse_ips(), last, log)
        except Exception as e:  # a bug here must not stop the loop
            log(f"⚠ lecteurs de connecteurs : {e}")
        time.sleep(max(5.0, READERS_TICK - (time.time() - t0)))


def keep_availability() -> None:
    """Availability of each service, machine and Kuma monitor after a collection (Historique → Disponibilité)."""
    import availability
    from auth import db_path
    try:
        n = availability.sample(db_path(CFG), WEB / "data.json")
    except Exception as e:  # base unavailable: only the availability history misses a point
        log(f"⚠ disponibilité : {e}")
        return
    if n:
        log(f"disponibilité : {n} point(s)")


def keep_metrics() -> None:
    """The figures of each machine after a health pass (24 h, the small curves of the machine page) and the health count of the Machines tiles (7 days)."""
    import metrics
    import tile_history
    from auth import db_path
    try:
        metrics.sample(db_path(CFG), WEB / "health" / "stats.json")
        tile_history.sample(db_path(CFG), WEB / "health" / "stats.json")
    except Exception as e:  # base unavailable: only the curves miss a point
        log(f"⚠ mesures des machines : {e}")


def keep_history(name: str, alert: bool = False) -> None:
    """Événements du passage recopiés dans SQLite (un an d'historique ; events.json n'en garde que 90 jours),
    puis envoyés aux règles d'alerte (pas à la reprise du démarrage : déjà annoncés en leur temps)."""
    import history
    from auth import db_path
    f = WEB / ("events.json" if name == "watch" else "health/events.json")
    added: list[dict] = []
    try:
        n = history.ingest(db_path(CFG), f, "watcher" if name == "watch" else "health", added)
    except Exception as e:  # base indisponible : events.json reste la référence, rien n'est perdu
        log(f"⚠ historique : {e}")
        return
    if n:
        log(f"historique : {n} événement(s) ajouté(s)")
    if alert and added:
        try:
            for msg in alerts_store().dispatch(added):
                log(f"alerte : {msg}")
        except Exception as e:  # une alerte ratée ne bloque pas les tâches
            log(f"⚠ alertes : {e}")
        try:
            for msg in notifications_store().dispatch(added):
                log(f"notification : {msg}")
        except Exception as e:
            log(f"⚠ notifications : {e}")


_ALERTS = None
_NOTIFS = None


def notifications_store():
    """Notifications personnalisées (notifications.py), sur les canaux et la base des alertes."""
    global _NOTIFS
    if _NOTIFS is None:
        import notifications
        _NOTIFS = notifications.Notifications(alerts_store(), WEB)
    return _NOTIFS


def alerts_store():
    """Alertes (alerts.py), dans la même base ; canaux de config.json repris au premier usage."""
    global _ALERTS
    if _ALERTS is None:
        import alerts
        from auth import db_path
        _ALERTS = alerts.Alerts(db_path(CFG), CFG)
    return _ALERTS


ARCHIFY = os.environ.get("MYSERVICES_ARCHIFY", "")


def refresh_nav() -> None:
    """Bandeau « ← MyServices · Généré avec Archify » au bas de chaque schéma existant (idempotent) : aussi sur ceux qui n'ont pas été regénérés,
    et la liste des autres schémas suit ceux qui existent."""
    import diagram_nav
    have = [k for k, *_ in diagram_nav.all_diagrams() if (WEB / f"{k}.html").exists()]
    for k in have:
        page = WEB / f"{k}.html"
        try:
            old = page.read_text(encoding="utf-8")
            new = diagram_nav.inject(old, k, have)
            if new != old:
                tmp = page.with_suffix(".tmp")
                tmp.write_text(new, encoding="utf-8")
                tmp.replace(page)
        except OSError as e:
            log(f"⚠ schéma {k} : bandeau non ajouté ({e})")


def write_alerts_summary() -> None:
    """Chiffres du schéma « chaîne d'alertes » (canaux, règles actives, notifications) dans state_dir/alerts-summary.json ; sans secret."""
    try:
        a, n = alerts_store(), notifications_store().list()
        out = {"channels": [{"type": c["type"], "name": c["name"], "enabled": c["enabled"]} for c in a.channels()],
               "rules": sum(1 for r in a.rules() if r["enabled"]),
               "reports": sum(1 for x in n if x["kind"] == "report" and x["enabled"]), "live": sum(1 for x in n if x["kind"] == "events" and x["enabled"]),
               "collect_at": TASKS["collect"]["at"], "watch_at": TASKS["watch"]["at"]}
        f = Path(CFG["state_dir"]) / "alerts-summary.json"
        f.write_text(json.dumps(out), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 : facultatif, le schéma d'alertes manquera simplement
        log(f"⚠ schéma des alertes : {type(e).__name__}: {e}")


MAP_STATE: dict = {"running": False, "started": None, "last_seconds": None, "last_end": None}   # state of the diagram build, shown by the Diagrams tab


def build_map() -> None:
    """Build the diagrams, recording when it started and how long it took (MAP_STATE). A request that arrives while a build runs
    asks for one more pass afterwards, so a diagram created in the meantime is not missed."""
    if MAP_STATE["running"]:
        MAP_STATE["again"] = True
        return
    while True:
        MAP_STATE.update(running=True, started=time.time(), again=False)
        try:
            _build_map()
        finally:
            MAP_STATE.update(running=False, last_seconds=round(time.time() - MAP_STATE["started"], 1), last_end=time.time())
        if not MAP_STATE["again"]:
            return


def archify_why(stdout: str, stderr: str) -> str:
    """Why Archify refused a map, in one line: its « error », else its error diagnostics, never the raw tail of its JSON."""
    try:
        d = json.loads(stdout)
    except ValueError:   # no JSON at all (node missing, a crash): what it wrote
        return (stdout or stderr).strip()[-300:]
    if not isinstance(d, dict):
        return str(d)[-300:]
    errs = [str(x.get("message", "")) for x in d.get("diagnostics") or [] if isinstance(x, dict) and x.get("severity") == "error"]
    return str(d.get("error") or "; ".join(errs[:3]) or f"stage {d.get('stage') or '?'}, {(stderr or '').strip()[-200:] or 'no detail'}")


def _build_map() -> None:
    """Cartes de l'infra (carte.html, sauvegardes.html ; Archify) depuis les fichiers de la page. Facultatif :
    sans Archify ou en échec, la carte précédente reste, les tâches n'en dépendent pas."""
    if not (ARCHIFY and Path(ARCHIFY).exists()):
        return
    write_alerts_summary()
    import archify_extra
    wanted = [k for k in CFG.get("diagrams_extra") or [] if k in archify_extra.CATALOG]
    for stale in ["connecteurs", *[k for k in archify_extra.CATALOG if k not in wanted]]:   # ancien schéma retiré, schémas proposés qu'on n'a pas (ou plus) demandés
        for suffix in (".html", ".delivery.json"):
            (WEB / f"{stale}{suffix}").unlink(missing_ok=True)
    try:
        specs = subprocess.run([sys.executable, str(HERE / "archify_map.py"), str(WEB), CFG["state_dir"], ",".join(wanted)],
                               check=True, capture_output=True, text=True, timeout=60).stdout.split()
    except (OSError, subprocess.SubprocessError) as e:
        log(f"⚠ carte : {e}")
        return
    for spec in specs:
        out = Path(spec).name.replace(".archify.json", ".html")
        r = None
        try:
            r = subprocess.run(["node", ARCHIFY, "deliver", "architecture", spec, out, "--json"],
                               cwd=WEB, capture_output=True, text=True, timeout=180)  # sortie relative : exigé par Archify
            ok = json.loads(r.stdout or "{}").get("ok")
        except (OSError, ValueError, subprocess.SubprocessError) as e:
            ok = False
            log(f"⚠ carte {out} : {e}")
        if ok:
            log(f"carte : régénérée ({out})")
        elif r is not None:
            log(f"⚠ carte {out} : non régénérée (Archify) : {archify_why(r.stdout, r.stderr)}")
    refresh_nav()


def auto_netscan() -> None:
    """Recherche réseau automatique : la première dès le démarrage, puis toutes
    les « netscan_every » heures (config.json, Réglages → Recherche réseau ; 0 = coupée). Mêmes garanties que le bouton :
    lecture seule, un /24 au plus, un passage à la fois."""
    every = CFG["netscan_every"]
    f = Path(CFG["state_dir"]) / "network-scan.json"
    if netscan.due(f, every) and not netscan.summary()["running"]:
        try:
            import machines_admin
            netscan.start(machines_admin.known_ips(), f, net=",".join(CFG["netscan_nets"]) or None, discreet=CFG["netscan_discreet"])
            log(f"recherche réseau automatique (toutes les {every:g} h)")
        except Exception as e:  # noqa: BLE001 : le planificateur ne s'arrête jamais pour ça
            log(f"recherche réseau automatique impossible : {type(e).__name__}: {e}")


def auto_adopt() -> None:
    """Auto mode (Settings -> Discovery): once per finished network search, the machines worth following are added (machines_admin
    .adopt_found), then a collection reads them. An IP added this way and removed by hand later is never added again (auto-mode.json)."""
    f, mark = Path(CFG["state_dir"]) / "network-scan.json", Path(CFG["state_dir"]) / "auto-mode.json"
    if not CFG["auto_mode"] or not f.exists():
        return
    st = netscan.state(f)
    if st.get("phase") != "done" or st.get("error") or st.get("stopped") or not st.get("ended"):
        return
    try:
        seen = json.loads(mark.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        seen = {}
    if seen.get("scan") == st["ended"]:
        return
    added: list[str] = seen.get("added", [])
    try:
        import machines_admin
        new = machines_admin.adopt_found(st.get("found") or [], set(added) | {x.get("ip") for x in CFG["netscan_ignored"]})
    except Exception as e:  # noqa: BLE001 : the scheduler never stops for it; tried again after the next search
        log(f"mode automatique : ajout des machines impossible : {type(e).__name__}: {e}")
        new = []
    tmp = mark.with_suffix(".tmp")
    tmp.write_text(json.dumps({"scan": st["ended"], "added": added + new}), encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    tmp.replace(mark)
    if new:
        log(f"mode automatique : {len(new)} machine(s) ajoutée(s) d'après la recherche réseau : {', '.join(new)}")
        if enabled("collect"):
            run_chain(["collect"], "machines ajoutées par le mode automatique")


def netscan_task() -> dict:
    """La recherche réseau automatique, présentée comme une tâche (en-tête) : prochaine échéance = dernière recherche + « netscan_every » h
    (vérifiée chaque minute par le planificateur ; tout de suite s'il n'y en a jamais eu) ; coupée si netscan_every = 0."""
    every, f = CFG["netscan_every"], Path(CFG["state_dir"]) / "network-scan.json"
    on = every > 0
    st = netscan.state(f) if f.exists() else {}
    last = st.get("ended") or st.get("started")
    return {"label": "Recherche réseau", "every_h": every, "enabled": on, "running": netscan.summary()["running"],
            "next": (max(last + every * 3600, time.time()) if last else time.time()) if on else None,
            "started": st.get("started"), "ended": st.get("ended"), "result": None}


def next_run(name: str, now: datetime | None = None) -> float | None:
    """Prochain horaire de la tâche (epoch, heure locale comme le planificateur) ; None si coupée ou sans créneau."""
    t = TASKS[name]
    if not enabled(name):
        return None
    slot = (now or datetime.now()).replace(second=0, microsecond=0)
    for _ in range(24 * 60):
        slot += timedelta(minutes=1)
        if slot.minute in t["minutes"] and (t["hours"] is None or slot.hour in t["hours"]):
            return slot.timestamp()
    return None


def notifications_tick() -> None:
    """Chaque minute : les rapports de notification dont l'heure est venue partent."""
    try:
        for msg in notifications_store().tick():
            log(f"notification : {msg}")
    except Exception as e:  # noqa: BLE001 : le planificateur ne s'arrête jamais pour ça
        log(f"⚠ notifications : {type(e).__name__}: {e}")


def update_check() -> None:
    """Latest version published, checked by itself when update_check is on: about.latest keeps its answer 6 h, so this asks GitHub
    at most every 6 h (one anonymous GET), whatever page is open"""
    if not CFG.get("update_check", True):
        return
    import about
    threading.Thread(target=about.latest, args=(Path(CFG["state_dir"]),), kwargs={"current": os.environ.get("MYSERVICES_VERSION")}, daemon=True,
                     name="update-check").start()


def wake_check() -> None:
    """Postes « souvent éteints » dont la fiche est grisée dans Santé : un ping ciblé chaque minute ; si la réponse change (le PC
    s'allume ou s'éteint), la santé de cette seule machine est relue, la fiche passe de « éteinte » à « allumée, agent en attente »."""
    try:
        asleep = json.loads((WEB / "health" / "stats.json").read_text(encoding="utf-8")).get("asleep", [])
    except (OSError, ValueError):
        return
    for a in asleep:
        up = subprocess.run(["ping", "-c1", "-W1", a["ip"]], capture_output=True).returncode == 0
        if up == bool(a.get("ping")):
            continue
        why = f"{a['name']} {'répond' if up else 'ne répond plus'} au ping"
        if not (enabled("health") and run_task("health", why, ("--only", a["ip"]))):
            continue  # santé occupée : on réessaie à la minute suivante (la fiche garde l'ancien état de ping)
        if enabled("collect"):  # l'onglet Machines (ping, SSH, Docker) se met à jour tout de suite, sans attendre l'horaire de la collecte
            import machines_admin
            machines_admin.expire_inventory(a["ip"])
            run_chain(["collect"], why)


READERS_TICK = 10   # s, between two looks at which connectors are due
SCHED_BEAT = {"ts": None}   # last turn of the scheduler loop: the tasks page shows whether the schedule is alive


def scheduler() -> None:
    last = None
    while True:
        now = datetime.now()
        SCHED_BEAT["ts"] = time.time()
        slot = now.replace(second=0, microsecond=0)
        if slot != last:
            last = slot
            for name, t in TASKS.items():
                if now.minute in t["minutes"] and (t["hours"] is None or now.hour in t["hours"]) and enabled(name):
                    if not run_task(name, "horaire"):
                        log(f"{name} : passage précédent encore en cours, horaire sauté")
            auto_netscan()
            auto_adopt()
            wake_check()
            update_check()
            notifications_tick()
        time.sleep(5)


SSH_DIR = Path.home() / ".ssh"  # lien vers /config/ssh dans l'image
CONFIG_DIR = Path(os.environ.get("MYSERVICES_CONFIG", "/config/config.json")).parent
KEY = SSH_DIR / "myservices"
KEY_ECDSA = SSH_DIR / "myservices_ecdsa"  # second key, ECDSA P-256: VMware ESXi (sshd in FIPS mode) refuses ed25519


def host_ip() -> str:
    """IP LAN de la machine hôte (réseau de l'hôte : route par défaut)."""
    w = subprocess.run(["ip", "-4", "route", "show", "default"], capture_output=True, text=True).stdout.split()
    return w[w.index("src") + 1] if "src" in w else ""


def lock_config() -> None:
    """/config : dossiers 700, fichiers 600 (clés publiques 644). Le chmod fixe aussi le masque des ACL :
    une ACL par défaut héritée du dossier de l'hôte (ex. autre compte en rwx) ne donne plus accès aux
    secrets ni aux clés."""
    for p in [CONFIG_DIR, *CONFIG_DIR.rglob("*")]:
        try:
            if p.is_symlink() or p.is_socket():
                continue
            p.chmod(0o700 if p.is_dir() else 0o644 if p.name.endswith(".pub") else 0o600)
        except OSError:
            pass


def with_ecdsa(text: str) -> str:
    """SSH config where every « IdentityFile ~/.ssh/myservices » line (aliases written by the app) is followed by the ECDSA key:
    ssh offers ed25519 first, then ECDSA to a host that refuses it (VMware ESXi in FIPS mode). Aliases of other keys are left alone."""
    return re.sub(r"(?m)^([ \t]*)IdentityFile ~/\.ssh/myservices[ \t]*\n(?![ \t]*IdentityFile ~/\.ssh/myservices_ecdsa)",
                  r"\g<0>\1IdentityFile ~/.ssh/myservices_ecdsa\n", text)


def prepare_ssh() -> None:
    """Clé de l'app (créée une fois) et alias « hote » vers la machine hôte : le conteneur n'a pas le
    socket Docker, il lit sa machine hôte par SSH. Affiche la commande qui autorise la clé sur l'hôte."""
    Path(os.path.realpath(SSH_DIR)).mkdir(mode=0o700, parents=True, exist_ok=True)  # ~/.ssh : lien vers /config/ssh
    if not KEY.exists():
        # one comment per installation (« myservices@<machine>-<date> »): two keys of two installations are no longer indistinguishable in authorized_keys
        comment = f"myservices@{socket.gethostname()[:40]}-{datetime.now():%Y%m%d}"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", str(KEY)], check=True)
        log(f"clé SSH de l'app créée : {KEY}")
    if not KEY_ECDSA.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ecdsa", "-b", "256", "-N", "", "-C", "myservices-esxi", "-f", str(KEY_ECDSA)], check=True)
        log(f"clé SSH ECDSA de l'app créée (VMware ESXi) : {KEY_ECDSA}")
    lock_config()
    conf = SSH_DIR / "config"
    text = conf.read_text(encoding="utf-8") if conf.exists() else ""
    if (both := with_ecdsa(text)) != text:   # aliases written before the ECDSA key: it is offered after the ed25519 one
        conf.write_text(both, encoding="utf-8")
        conf.chmod(0o600)
        text = both
        log("config SSH : clé ECDSA ajoutée aux alias de l'app (VMware ESXi)")
    if not re.search(r"(?im)^\s*Host\s+(.*\s)?hote(\s|$)", text):
        ip = host_ip()
        user = os.environ.get("MYSERVICES_HOST_USER", "root")
        conf.write_text(text + f"\n# Machine hôte du conteneur (ajouté au démarrage)\nHost hote\n    HostName {ip}\n    User {user}\n"
                        f"    IdentityFile ~/.ssh/myservices\n    IdentityFile ~/.ssh/myservices_ecdsa\n    IdentitiesOnly yes\n"
                        "    StrictHostKeyChecking accept-new\n", encoding="utf-8")  # 1re connexion : empreinte retenue, puis vérifiée
        conf.chmod(0o600)
        log(f"alias SSH « hote » ajouté : {user}@{ip}")
    elif "# Machine hôte du conteneur" in text and "StrictHostKeyChecking" not in text:  # alias d'avant : sans known_hosts, SSH échoue
        conf.write_text(re.sub(r"(?m)^(Host hote\n)", r"\1    StrictHostKeyChecking accept-new\n", text, count=1), encoding="utf-8")
        conf.chmod(0o600)
        log("alias SSH « hote » : StrictHostKeyChecking accept-new ajouté")
    try:   # the fingerprint only: the key and the command to authorise it are on the SSH connections page, masked there too
        fp = subprocess.run(["ssh-keygen", "-lf", str(KEY.with_suffix(".pub"))], capture_output=True, text=True, timeout=10).stdout.split()
    except (OSError, subprocess.SubprocessError):
        fp = []
    log(f"clé SSH de l'app : {fp[1] if len(fp) > 1 else '?'} ; la clé publique et la commande pour l'autoriser (sur l'hôte et sur "
        "chaque machine lue par SSH) sont dans la page, Machines › Connexions SSH")


def first_meta() -> None:
    """Installation neuve (version Docker, aucun services-meta.json) : la machine hôte seule, pour que la première
    collecte relève tout de suite ses ports en écoute (et ses conteneurs dès que la clé SSH y est autorisée)."""
    meta = Path(CFG["meta"])
    if meta.exists() or os.environ.get("MYSERVICES_DOCKER") != "1":
        return
    ip = host_ip()
    if not ip:
        return
    meta.write_text(json.dumps({"machines": {ip: {"name": socket.gethostname(), "role": "machine hôte de MyServices",
                                                   "ssh": "hote", "host": True}},
                                "process_hosts": {}, "extra": [], "services": {}}, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    meta.chmod(0o600)
    log(f"installation neuve : {meta} créé avec la machine hôte ({ip}) ; ses ports en écoute sont relevés tout de suite")


FIRST = {"collect": "data.json", "watch": "events.json", "health": "health/stats.json", "backups": "backups.json"}


def first_runs() -> None:
    """Premier démarrage : chaque tâche dont le fichier manque tourne une fois, dans l'ordre (la veille
    et la santé lisent data.json), sans attendre son horaire : la page est complète d'emblée."""
    for name, out in FIRST.items():
        if enabled(name) and not (WEB / out).exists() and run_task(name, "premier démarrage"):
            while TASKS[name]["proc"] is not None:
                time.sleep(2)


def status() -> dict:
    """État du collecteur, lu par la barre de progression du front (GET /api/v1/status)."""
    t, now = TASKS["collect"], time.time()
    running = t["proc"] is not None
    last = max(filter(None, (t["start"], t["trigger"])), default=None)
    wait = 0 if running or last is None else max(0, int(last + COOLDOWN - now))
    prog = None
    if running:
        try:
            prog = json.loads(Path(PROGRESS).read_text())
            if prog.get("ts", 0) < t["start"]:
                prog = None  # fichier du passage précédent
        except (OSError, ValueError):
            pass
    try:
        generated = json.loads((WEB / "data.json").read_text()).get("generated")
    except (OSError, ValueError):
        generated = None
    ts = (lambda x: int(x) if x else None)
    return {"running": running, "progress": prog, "started": ts(t["start"]), "ended": ts(t["end"]),
            "result": t["result"], "generated": generated, "cooldown": COOLDOWN, "wait": wait, "now": int(now),
            "network": netscan.summary()}


def main() -> int:
    import applog
    applog.install()   # ce que montre docker logs, gardé aussi pour Réglages → Journaux
    WEB.mkdir(parents=True, exist_ok=True)
    Path(PROGRESS).parent.mkdir(parents=True, exist_ok=True)
    try:
        prepare_ssh()
    except (OSError, subprocess.CalledProcessError) as e:
        log(f"⚠ préparation SSH impossible ({e}) : /config/ssh inscriptible par le compte {os.geteuid()} ?")
    plan = ", ".join(f"{n} {sorted(t['minutes'])} {'toutes les heures' if t['hours'] is None else sorted(t['hours'])}"
                     for n, t in TASKS.items())
    log(f"MyServices : page http://<hôte>:{PORT}{PREFIX}, horaires : {plan}")
    first_meta()
    if not Path(CFG["meta"]).exists():
        log(f"⚠ {CFG['meta']} absent : rien ne sera collecté avant la configuration. Importer une installation "
            "(import_install.py), ajouter une machine dans la page (Réglages → Machines), ou lancer : "
            "docker compose exec myservices python3 setup.py")
    for name in ("watch", "health"):  # reprise de ce que events.json contient déjà (sans doublon)
        keep_history(name)
    threading.Thread(target=scheduler, daemon=True).start()
    threading.Thread(target=pulse_loop, daemon=True, name="pulse").start()
    threading.Thread(target=fast_loop, daemon=True, name="fast").start()
    threading.Thread(target=first_runs, daemon=True).start()
    import uvicorn

    import api
    from api import app
    import live_events
    threading.Thread(target=live_events.watch, args=(api.stream_sources(),), daemon=True, name="events").start()   # page event stream
    if api.AUTH and not api.store().has_users():
        log(f"aucun compte : ouvrir la page pour créer le compte admin (pendant {api.SETUP_WINDOW // 60} min ; "
            "au-delà, redémarrer le conteneur)")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning", access_log=False, server_header=False,  # NOSONAR S8392: inside the container; MYSERVICES_ALLOW limits who may connect
                proxy_headers=False)  # IP du client telle que vue (contrôle MYSERVICES_ALLOW), jamais X-Forwarded-For
    return 0


if __name__ == "__main__":
    sys.exit(main())
