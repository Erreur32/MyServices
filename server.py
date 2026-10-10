#!/usr/bin/env python3
"""MyServices en conteneur : planificateur + page + API (api.py, FastAPI), en un seul processus.

Remplace les unités systemd de l'installation classique :
  myservices.timer / -watcher / -health / -backups  -> planificateur interne (horaires ci-dessous)
  myservices-refresh-api + myservices-refresh.path  -> POST /myservices/api/refresh (api.py)
  nginx / Apache                                    -> page servie ici (aucune config web à écrire)

Les scripts (myservices.py, watcher.py, health.py, backups.py) tournent inchangés, chacun dans son
processus, un seul passage à la fois par tâche, avec un délai maximal.

Page : /myservices/ ; fichiers produits (data.json, events.json, health/, backups.json) lus dans
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
from datetime import datetime
from pathlib import Path

from config import CFG

HERE = Path(__file__).resolve().parent
STATIC = HERE / "web"
WEB = Path(CFG["web_dir"])
PREFIX = "/myservices/"
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
DEFAULTS_AT = {"collect": ("myservices.py", "10,40 *", 900), "watch": ("watcher.py", "15,45 *", 300),
               "health": ("health.py", "0 0,6,12,18", 600), "backups": ("backups.py", "5 7,19", 900)}
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


def log(msg: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


def enabled(name: str) -> bool:
    """Rien sans services-meta.json (installation pas encore configurée) ; santé : seulement avec
    health_url "health/" ; sauvegardes : seulement si backups-meta.json existe."""
    if not Path(CFG["meta"]).exists():
        return False
    if name == "health":
        return CFG["health_url"] == "health/"
    if name == "backups":
        return Path(CFG["backups_meta"]).exists()
    return True


def run_task(name: str, why: str) -> bool:
    """Lance la tâche si elle ne tourne pas déjà ; False sinon. Le watcher suit chaque collecte."""
    t = TASKS[name]
    with LOCK:
        if t["proc"] is not None:
            return False
        env = dict(os.environ, MYSERVICES_PROGRESS=PROGRESS, PYTHONDONTWRITEBYTECODE="1")
        if name in ("watch", "health") and alerts_on():
            env["MYSERVICES_ALERTS_ENGINE"] = "1"  # Réglages → Alertes envoie : le script se tait (pas de doublon)
        t["proc"] = subprocess.Popen([sys.executable, str(HERE / t["script"])], cwd=HERE, env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t["start"], t["end"], t["result"] = time.time(), None, None
    log(f"{name} : démarré ({why})")
    threading.Thread(target=_wait, args=(name,), daemon=True).start()
    return True


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
    if name in ("collect", "health", "backups") and code == 0:
        build_map()  # avant de libérer la tâche : les cartes suivent toujours les fichiers qu'elles montrent
    if name in ("watch", "health") and code == 0:
        keep_history(name, alert=True)
    with LOCK:
        t.update(proc=None, end=time.time(), result=result)
    log(f"{name} : terminé, {result} ({t['end'] - t['start']:.0f} s)")


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


_ALERTS = None


def alerts_store():
    """Alertes (alerts.py), dans la même base ; canaux de config.json repris au premier usage."""
    global _ALERTS
    if _ALERTS is None:
        import alerts
        from auth import db_path
        _ALERTS = alerts.Alerts(db_path(CFG), CFG)
    return _ALERTS


ARCHIFY = os.environ.get("MYSERVICES_ARCHIFY", "")


def build_map() -> None:
    """Cartes de l'infra (carte.html, sauvegardes.html ; Archify) depuis les fichiers de la page. Facultatif :
    sans Archify ou en échec, la carte précédente reste, les tâches n'en dépendent pas."""
    if not (ARCHIFY and Path(ARCHIFY).exists()):
        return
    try:
        specs = subprocess.run([sys.executable, str(HERE / "archify_map.py"), str(WEB), CFG["state_dir"]],
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
            log(f"⚠ carte {out} : non régénérée (Archify) : " + (r.stdout or r.stderr)[-300:])


def scheduler() -> None:
    last = None
    while True:
        now = datetime.now()
        slot = now.replace(second=0, microsecond=0)
        if slot != last:
            last = slot
            for name, t in TASKS.items():
                if now.minute in t["minutes"] and (t["hours"] is None or now.hour in t["hours"]) and enabled(name):
                    if not run_task(name, "horaire"):
                        log(f"{name} : passage précédent encore en cours, horaire sauté")
        time.sleep(5)


SSH_DIR = Path.home() / ".ssh"  # lien vers /config/ssh dans l'image
CONFIG_DIR = Path(os.environ.get("MYSERVICES_CONFIG", "/config/config.json")).parent
KEY = SSH_DIR / "myservices"


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


def prepare_ssh() -> None:
    """Clé de l'app (créée une fois) et alias « hote » vers la machine hôte : le conteneur n'a pas le
    socket Docker, il lit sa machine hôte par SSH. Affiche la commande qui autorise la clé sur l'hôte."""
    Path(os.path.realpath(SSH_DIR)).mkdir(mode=0o700, parents=True, exist_ok=True)  # ~/.ssh : lien vers /config/ssh
    if not KEY.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "myservices", "-f", str(KEY)], check=True)
        log(f"clé SSH de l'app créée : {KEY}")
    lock_config()
    conf = SSH_DIR / "config"
    text = conf.read_text(encoding="utf-8") if conf.exists() else ""
    if not re.search(r"(?im)^\s*Host\s+(.*\s)?hote(\s|$)", text):
        ip = host_ip()
        user = os.environ.get("MYSERVICES_HOST_USER", "root")
        conf.write_text(text + f"\n# Machine hôte du conteneur (ajouté au démarrage)\nHost hote\n    HostName {ip}\n    User {user}\n"
                        f"    IdentityFile ~/.ssh/myservices\n    IdentitiesOnly yes\n", encoding="utf-8")
        conf.chmod(0o600)
        log(f"alias SSH « hote » ajouté : {user}@{ip}")
    pub = (KEY.with_suffix(".pub")).read_text().strip()
    log("clé publique de l'app (à autoriser sur l'hôte et sur chaque machine lue par SSH) :\n"
        f"    {pub}\n  sur l'hôte : echo '{pub}' | sudo tee -a /root/.ssh/authorized_keys")


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
    """Même réponse que refresh-api.py (lue par web/refresh.js)."""
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
            "result": t["result"], "generated": generated, "cooldown": COOLDOWN, "wait": wait, "now": int(now)}


def main() -> int:
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
    threading.Thread(target=first_runs, daemon=True).start()
    import uvicorn

    import api
    from api import app
    if api.AUTH and not api.store().has_users():
        log(f"aucun compte : ouvrir la page pour créer le compte admin (pendant {api.SETUP_WINDOW // 60} min ; "
            "au-delà, redémarrer le conteneur)")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning", access_log=False, server_header=False,
                proxy_headers=False)  # IP du client telle que vue (contrôle MYSERVICES_ALLOW), jamais X-Forwarded-For
    return 0


if __name__ == "__main__":
    sys.exit(main())
