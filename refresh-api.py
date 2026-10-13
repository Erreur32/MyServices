#!/usr/bin/env python3
"""Bouton « Rafraîchir » de MyServices : relance myservices.service à la demande, sans aucun droit root.

Écoute sur 127.0.0.1 seulement (nginx /myservices/api/ fait l'accès LAN + limit_req).
  GET  /status   état du passage (en cours, étape, compteur de sondes), dernière génération, délai restant
  POST /refresh  demande un passage : touche STATE_DIR/trigger, que myservices-refresh.path
                 transforme en démarrage de myservices.service (root). Rien d'autre n'est exécuté.

Garde-fous : un seul passage à la fois (systemd + flock du script), délai minimal COOLDOWN entre
deux passages (manuel OU cron), contrôle de l'Origin contre les requêtes venues d'autres sites.
"""
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("REFRESH_HOST", "127.0.0.1")
PORT = int(os.environ.get("REFRESH_PORT", "9201"))
COOLDOWN = int(os.environ.get("REFRESH_COOLDOWN", "300"))
UNIT = "myservices.service"
STATE_DIR = os.environ.get("STATE_DIRECTORY", "/var/lib/myservices-refresh")
TRIGGER = os.path.join(STATE_DIR, "trigger")
PROGRESS = "/run/myservices/progress.json"
# Pas de lecture de config.json (mode 600, propriétaire différent) : install.sh passe le chemin
DATA = os.path.join(os.environ.get("MYSERVICES_WEB_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "web"),
                    "data.json")

_lock = threading.Lock()


def unit_state():
    """ActiveState + horodatages (secondes epoch) de myservices.service, lus via systemctl show."""
    out = subprocess.run(["systemctl", "show", UNIT, "--timestamp=unix", "-p",
                          "ActiveState,Result,ExecMainStartTimestamp,ExecMainExitTimestamp"],
                         capture_output=True, text=True, timeout=5).stdout
    v = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)

    def ts(k):
        x = v.get(k, "").lstrip("@")
        return int(x) if x.isdigit() else None
    return {"active": v.get("ActiveState"), "result": v.get("Result"),
            "start": ts("ExecMainStartTimestamp"), "end": ts("ExecMainExitTimestamp")}


def last_trigger():
    try:
        return os.path.getmtime(TRIGGER)
    except OSError:
        return None


def status():
    u, now = unit_state(), time.time()
    running = u["active"] in ("activating", "active", "reloading")
    # Le délai court depuis le dernier passage, qu'il vienne du bouton ou du timer
    last = max(filter(None, (u["start"], last_trigger())), default=None)
    wait = 0 if running or last is None else max(0, int(last + COOLDOWN - now))
    prog = None
    if running:
        try:
            with open(PROGRESS) as f:
                prog = json.load(f)
            if u["start"] and prog.get("ts", 0) < u["start"]:
                prog = None  # fichier du passage précédent
        except (OSError, ValueError):
            pass
    try:
        with open(DATA) as f:
            generated = json.load(f).get("generated")
    except (OSError, ValueError):
        generated = None
    return {"running": running, "progress": prog, "started": u["start"], "ended": u["end"],
            "result": u["result"], "generated": generated, "cooldown": COOLDOWN, "wait": wait, "now": int(now)}


class Handler(BaseHTTPRequestHandler):
    server_version = "myservices-refresh"

    def send(self, code, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)  # NOSONAR S5131: JSON body sent as application/json, not HTML

    def do_GET(self):
        if self.path.split("?")[0] != "/status":
            return self.send(404, {"error": "inconnu"})
        self.send(200, status())

    def do_POST(self):
        if self.path != "/refresh":
            return self.send(404, {"error": "inconnu"})
        # Requête venue d'une autre page que celle servie par nginx : refusée (CSRF)
        origin, host = self.headers.get("Origin"), self.headers.get("X-Forwarded-Host") or self.headers.get("Host")
        if origin and origin.split("://", 1)[-1] != host:
            return self.send(403, {"error": "origine refusée"})
        with _lock:
            st = status()
            if st["running"]:
                return self.send(409, dict(st, error="passage déjà en cours"))
            if st["wait"]:
                return self.send(429, dict(st, error=f"trop tôt, réessayer dans {st['wait']} s"))
            with open(TRIGGER, "w") as f:
                f.write(f"{time.time():.0f} {self.headers.get('X-Real-IP') or self.client_address[0]}\n")
            # Laisse à systemd le temps de démarrer l'unité, pour que le statut renvoyé soit « en cours »
            for _ in range(20):
                time.sleep(0.1)
                if unit_state()["active"] in ("activating", "active"):
                    break
            self.send(202, status())

    def log_message(self, fmt, *args):
        if self.command == "GET" and args[1:2] == ("200",):
            return  # la page interroge /status toutes les 30 s : seuls les déclenchements et refus sont journalisés
        print(f"{self.headers.get('X-Real-IP') or self.client_address[0]} {fmt % args}", flush=True)


if __name__ == "__main__":
    os.makedirs(STATE_DIR, exist_ok=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
