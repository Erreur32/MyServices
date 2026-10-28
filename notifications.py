"""Notifications personnalisées (version Docker) : des messages que l'on compose soi-même, par opposition aux alertes (qui préviennent d'un
problème). Même canaux que les alertes (Discord, Telegram, webhook : Réglages → Notifications), même base SQLite.

Deux sortes :
  report   rapport de machines à heure fixe : les machines choisies (ou toutes) et les capteurs voulus (CPU, mémoire, disque le plus rempli,
           température, charge, durée de marche, mises à jour, services en échec, Docker, SMART…), lus dans la dernière santé
  events   événements en direct, filtrés ou non : genres (vide = tous), machine, texte, retours à la normale, délai entre deux envois

Des exemples fonctionnels s'ajoutent d'un clic (désactivés, sur les canaux actifs) ; « Envoyer maintenant » envoie un vrai message de la
notification (le rapport avec les vraies valeurs, ou les derniers événements correspondants).
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime

import alerts
import notify

SENSORS: dict[str, tuple[str, str]] = {   # clé -> (libellé, repère)
    "level": ("État de la santé", "🩺"), "cpu": ("Processeur", "⚙️"), "mem": ("Mémoire", "🧠"), "disk": ("Disque le plus rempli", "💽"),
    "disks": ("Tous les disques", "💾"), "temp": ("Température", "🌡️"), "load": ("Charge", "📈"), "uptime": ("En marche depuis", "⏱️"),
    "updates": ("Mises à jour en attente", "⬆️"), "reboot": ("Redémarrage requis", "🔁"), "systemd": ("Services en échec", "🧯"),
    "docker": ("Conteneurs Docker", "🐳"), "smart": ("Disques SMART", "🔎"), "ssh_failed": ("Connexions SSH refusées (24 h)", "🚫"),
    "ping": ("Réponse au ping", "📡"),
}
LEVEL_ICON = {"ok": "🟢", "warn": "🟡", "crit": "🔴", "down": "⚪", "na": "⚪"}
LEVEL_NAME = {"ok": "OK", "warn": "à surveiller", "crit": "critique", "down": "injoignable", "na": "sans objet"}
ALL_KINDS = list(alerts.KINDS) + list(alerts.RESOLVES)
KINDS_OK = set(ALL_KINDS)
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
IP = re.compile(r"^[0-9a-fA-F:.]{3,45}$")
MAX_TEXT = 1900
SCHEMA = """
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL, channels TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL, last_sent REAL);
"""

# Exemples fonctionnels : ajoutés désactivés, sur les canaux actifs, à relire puis activer ; chacun s'essaie avec « Envoyer maintenant »
EXAMPLES = [
    {"name": "Rapport du matin : toutes les machines", "kind": "report",
     "config": {"machines": [], "sensors": ["level", "cpu", "mem", "disk", "temp", "uptime", "updates"], "at": ["08:00"], "days": [0, 1, 2, 3, 4, 5, 6]}},
    {"name": "Rapport du lundi : disques, SMART et mises à jour", "kind": "report",
     "config": {"machines": [], "sensors": ["disks", "smart", "updates", "reboot", "systemd"], "at": ["09:00"], "days": [0]}},
    {"name": "Flux en direct : tous les événements", "kind": "events",
     "config": {"kinds": [], "machine": "", "match": "", "resolved": True, "cooldown_min": 0}},
    {"name": "Pannes de services en direct", "kind": "events",
     "config": {"kinds": ["panne", "unhealthy", "hors_ligne", "ssh_down"], "machine": "", "match": "", "resolved": True, "cooldown_min": 0}},
    {"name": "Nouveaux et disparus (inventaire)", "kind": "events",
     "config": {"kinds": ["nouveau", "disparu", "appareil"], "machine": "", "match": "", "resolved": False, "cooldown_min": 0}},
    {"name": "Une machine : tous ses événements", "kind": "events",
     "config": {"kinds": [], "machine": "@first", "match": "", "resolved": True, "cooldown_min": 0}},   # @first : la première machine connue, à changer
]


class NotificationError(Exception):
    """Refus lisible (champ invalide, notification inconnue…)."""


def dur(sec: float) -> str:
    sec = int(sec)
    d, h, m = sec // 86400, sec % 86400 // 3600, sec % 3600 // 60
    return f"{d} j {h} h" if d else f"{h} h {m:02d}" if h else f"{m} min"


# ── rapport ───────────────────────────────────────────────────────────────────────────────

def ip_of(host: dict) -> str:
    return host["name"].rsplit(" · ", 1)[-1] if " · " in host["name"] else host.get("ip", "")


def sensor_values(h: dict, m: dict | None) -> dict[str, str]:
    """Valeur lisible de chaque capteur disponible pour cette machine ({clé: texte}) ; un capteur absent n'est pas listé."""
    out: dict[str, str] = {}
    lvl = "down" if h.get("reachable") is False else h.get("level", "ok")
    out["level"] = f"{LEVEL_ICON.get(lvl, '⚪')} {LEVEL_NAME.get(lvl, lvl)}"
    res = h.get("res") or {}
    if res.get("available") and res.get("cpu_pct") is not None:
        out["cpu"] = f"{res['cpu_pct']:.0f} %"
    if res.get("available") and res.get("mem_pct") is not None:
        gb = f" ({res['mem_used_mb'] / 1024:.1f}/{res['mem_total_mb'] / 1024:.1f} Go)" if res.get("mem_total_mb") else ""
        out["mem"] = f"{res['mem_pct']:.0f} %{gb}"
    disks = [d for d in h.get("disks") or [] if (d.get("size_gb") or 1) >= 1]
    if disks:
        top = max(disks, key=lambda d: d.get("used_pct", 0))
        out["disk"] = f"{top['mount']} {top['used_pct']} %"
        out["disks"] = " · ".join(f"{d['mount']} {d['used_pct']} %" for d in sorted(disks, key=lambda d: -d.get("used_pct", 0)))
    t = h.get("temp") or {}
    if t.get("available") and t.get("celsius") is not None:
        out["temp"] = f"{t['celsius']:.0f} °C"
    ld = h.get("load") or {}
    if ld.get("available") and ld.get("ncpu"):
        out["load"] = f"{ld['load_1']:.2f} / {ld['ncpu']} cœurs"
    up = ((m or {}).get("info") or {}).get("uptime_s") or ((m or {}).get("agent") or {}).get("uptime_s")
    if up:
        out["uptime"] = dur(up)
    apt = h.get("apt") or {}
    if apt.get("available", True) and apt.get("upgradable") is not None:
        out["updates"] = f"{apt['upgradable']}"
    if "reboot_required" in h:
        out["reboot"] = "oui" if h["reboot_required"] else "non"
    sd = (h.get("systemd") or {}).get("failed")
    if sd is not None:
        out["systemd"] = f"{len(sd)}" + (f" ({', '.join(u['unit'] for u in sd[:3])})" if sd else "")
    dk = h.get("docker") or {}
    if dk.get("accessible"):
        out["docker"] = f"{dk.get('total', 0)} conteneurs" + (f", {dk['unhealthy']} unhealthy" if dk.get("unhealthy") else "")
    sm = h.get("smart") or {}
    if sm.get("accessible") and sm.get("disks"):
        bad = [d["device"] for d in sm["disks"] if d.get("failed") or not d.get("healthy", True)]
        out["smart"] = f"{len(sm['disks'])} disque(s), " + (f"défaut : {', '.join(bad)}" if bad else "tous sains")
    sa = h.get("ssh_auth") or {}
    if sa.get("available"):
        out["ssh_failed"] = f"{sa.get('failed_24h', 0)}"
    if m is not None and "ping" in m:
        out["ping"] = "répond" if m["ping"] else "ne répond pas"
    return out


def build_report(stats: dict, data: dict, cfg: dict, name: str, now: datetime | None = None) -> tuple[str, dict]:
    """(texte, charge utile webhook) du rapport : machines choisies (vide = toutes celles de la dernière santé), capteurs choisis."""
    now = now or datetime.now().astimezone()
    wanted = [s for s in cfg.get("sensors") or [] if s in SENSORS] or ["level", "cpu", "mem", "disk"]
    ips = set(cfg.get("machines") or [])
    machines = {m["ip"]: m for m in data.get("machine_list") or []}
    rows, asleep = [], []
    for h in stats.get("hosts") or []:
        if not ips or ip_of(h) in ips:
            rows.append((h, machines.get(ip_of(h))))
    for a in stats.get("asleep") or []:
        if not ips or a.get("ip") in ips:
            asleep.append(a)
    lines = [f"📊 {name} · {now.strftime('%d/%m/%Y %H:%M')}"]
    payload = []
    for h, m in rows:
        vals = sensor_values(h, m)
        shown = [(k, vals[k]) for k in wanted if k in vals]
        title = h["name"].replace(" · ", " (") + ")" if " · " in h["name"] else h["name"]
        lines.append(f"🖥 {title}")
        lines.append("   " + (" · ".join(f"{SENSORS[k][1]} {SENSORS[k][0]} : {v}" if len(wanted) <= 3 else f"{SENSORS[k][1]} {v}" for k, v in shown) if shown else "aucune donnée pour ces capteurs"))
        payload.append({"name": h["name"].split(" · ")[0], "ip": ip_of(h), "values": dict(shown)})
    for a in asleep:
        lines.append(f"💤 {a['name'].split(' · ')[0]} : éteinte (aucun relevé récent)" + (" · répond au ping" if a.get("ping") else ""))
        payload.append({"name": a["name"].split(" · ")[0], "ip": a.get("ip"), "values": {}, "asleep": True})
    if not rows and not asleep:
        lines.append("Aucune machine ne correspond (santé pas encore relevée ?).")
    if len(wanted) > 3:
        lines.append("Capteurs : " + " · ".join(f"{SENSORS[k][1]} {SENSORS[k][0]}" for k in wanted))
    return "\n".join(lines), {"machines": payload, "sensors": wanted}


def send_text(ch: dict, title: str, text: str, extra: dict | None = None, test: bool = False) -> tuple[bool, str]:
    """Texte libre sur un canal ; (réussi, motif). Jamais d'exception."""
    body = text if len(text) <= MAX_TEXT else text[:MAX_TEXT - 40].rsplit("\n", 1)[0] + "\n… (rapport tronqué)"
    try:
        if ch["type"] == "discord":
            alerts._post(ch["url"], {"content": body})
        elif ch["type"] == "telegram":
            notify._tg("sendMessage", {"chat_id": ch["chat_id"], "text": body[:notify.TG_MAX], "link_preview_options": {"is_disabled": True}}, token=ch["token"])
        else:
            alerts._post(ch["url"], {"source": "myservices", "type": "notification", "test": test, "name": title, "message": text,
                                     "sent_at": datetime.now().astimezone().isoformat(timespec="seconds"), **(extra or {})}, ch.get("token"))
        return True, "envoyé"
    except (OSError, ValueError, KeyError) as e:
        return False, f"échec : {notify.why(e)}"


# ── stockage et envoi ─────────────────────────────────────────────────────────────────────

class Notifications:
    """S'appuie sur le magasin d'alertes (canaux, journal, secrets) : un seul endroit pour régler Discord / Telegram / webhook."""

    def __init__(self, store: alerts.Alerts, web_dir):
        self.a, self.web = store, web_dir
        with self.a._db() as db:
            db.executescript(SCHEMA)

    # lecture
    def list(self) -> list[dict]:
        with self.a._db() as db:
            return [{**dict(r), "config": json.loads(r["config"]), "channels": json.loads(r["channels"]), "enabled": bool(r["enabled"])}
                    for r in db.execute("SELECT * FROM notifications ORDER BY id")]

    def _data(self) -> tuple[dict, dict]:
        def load(rel):
            try:
                return json.loads((self.web / rel).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return {}
        return load("health/stats.json"), load("data.json")

    # validation
    def _check(self, v: dict) -> dict:
        kind = v.get("kind")
        if kind not in ("report", "events"):
            raise NotificationError("type de notification : rapport ou événements")
        c = v.get("config") or {}
        if kind == "report":
            sensors = [s for s in c.get("sensors") or [] if s in SENSORS]
            if not sensors:
                raise NotificationError("choisir au moins un capteur")
            at = sorted({str(t) for t in c.get("at") or []})
            if not at or not all(HHMM.match(t) for t in at) or len(at) > 12:
                raise NotificationError("heures d'envoi : HH:MM, 12 au plus")
            days = sorted({int(d) for d in c.get("days") or range(7) if str(d).isdigit() and 0 <= int(d) <= 6})
            machines = [str(m).strip() for m in c.get("machines") or [] if IP.match(str(m).strip())][:100]
            conf = {"machines": machines, "sensors": sensors, "at": at, "days": days or list(range(7))}
        else:
            kinds = [k for k in c.get("kinds") or [] if k in KINDS_OK]
            conf = {"kinds": kinds, "machine": str(c.get("machine") or "").strip()[:120], "match": str(c.get("match") or "").strip()[:120],
                    "resolved": bool(c.get("resolved", True)), "cooldown_min": max(0, min(int(c.get("cooldown_min") or 0), 7 * 1440))}
        return {"name": (v.get("name") or "").strip()[:80] or ("Rapport" if kind == "report" else "Événements"), "kind": kind,
                "config": json.dumps(conf), "channels": json.dumps([int(x) for x in v.get("channels") or []]), "enabled": int(bool(v.get("enabled", True)))}

    def add(self, v: dict) -> int:
        r = self._check(v)
        with self.a._db() as db:
            return db.execute(f"INSERT INTO notifications ({', '.join(r)}, created) VALUES ({', '.join('?' * len(r))}, ?)", (*r.values(), time.time())).lastrowid

    def update(self, nid: int, v: dict) -> None:
        old = next((n for n in self.list() if n["id"] == nid), None)
        if old is None:
            raise NotificationError("notification inconnue")
        r = self._check({**old, **{k: x for k, x in v.items() if x is not None}, "config": {**old["config"], **(v.get("config") or {})}})
        with self.a._db() as db:
            db.execute(f"UPDATE notifications SET {', '.join(f'{k} = ?' for k in r)} WHERE id = ?", (*r.values(), nid))

    def delete(self, nid: int) -> None:
        with self.a._db() as db:
            if not db.execute("DELETE FROM notifications WHERE id = ?", (nid,)).rowcount:
                raise NotificationError("notification inconnue")
            db.execute("DELETE FROM alert_last WHERE rule_id = ?", (-nid,))

    def add_examples(self, names: list[str]) -> int:
        """Exemples choisis, ajoutés désactivés sur les canaux actifs ; ceux déjà présents (même nom) sont sautés."""
        have = {n["name"] for n in self.list()}
        chans = [c["id"] for c in self.a.channels() if c["enabled"]]
        stats, data = self._data()
        first = next((m["name"] for m in data.get("machine_list") or [] if not m.get("disabled")), "")
        n = 0
        for ex in EXAMPLES:
            if ex["name"] in names and ex["name"] not in have:
                cfg = {**ex["config"], **({"machine": first} if ex["config"].get("machine") == "@first" else {})}
                self.add({**ex, "config": cfg, "channels": chans, "enabled": False})
                n += 1
        return n

    # envoi
    def _targets(self, n: dict) -> list[dict]:
        on = {c["id"]: c for c in self.a.channels() if c["enabled"]}
        return [self.a._channel(c) for c in n["channels"] if c in on]

    def send_report(self, n: dict, test: bool = False) -> list[str]:
        stats, data = self._data()
        text, extra = build_report(stats, data, n["config"], n["name"])
        out = []
        for ch in self._targets(n):
            ok, info = send_text(ch, n["name"], text, {"report": extra}, test)
            self.a._log(f"🔔 {n['name']}", ch["name"], ok, len(extra["machines"]), info, text)
            out.append(f"{n['name']} → {ch['name']} : {info}")
        return out

    def send_now(self, nid: int) -> list[str]:
        """« Envoyer maintenant » : un vrai message de cette notification (rapport avec les valeurs du moment, ou derniers événements correspondants)."""
        n = next((x for x in self.list() if x["id"] == nid), None)
        if n is None:
            raise NotificationError("notification inconnue")
        if not self._targets(n):
            raise NotificationError("aucun canal actif sélectionné pour cette notification")
        if n["kind"] == "report":
            return self.send_report(n, test=True)
        from msv.core import history
        recent = history.query(self.a.path, time.time() - 30 * 86400, limit=200)   # plus récents d'abord
        found = [e for e in reversed(recent) if self._event_ok(n, e)][-5:]
        ev = found or [{"kind": "essai", "label": "Aucun événement correspondant pour l'instant", "machine": None, "target": None, "detail": "le filtre est valide, rien n'a encore été vu", "ts": time.time()}]
        out = []
        for ch in self._targets(n):
            ok, info = alerts.send(ch, n["name"], ev, test=True)
            self.a._log(f"🔔 {n['name']}", ch["name"], ok, len(ev), info, alerts.summary(ev))
            out.append(f"{n['name']} → {ch['name']} : {info}")
        return out

    def _event_ok(self, n: dict, e: dict) -> bool:
        c = n["config"]
        return alerts.matches({"kinds": c["kinds"] or ALL_KINDS, "resolved": c["resolved"], "machine": c["machine"], "match": c["match"]}, e)

    def dispatch(self, events: list[dict], now: float | None = None) -> list[str]:
        """Événements en direct vers les notifications « événements » actives (filtre, puis délai entre deux envois)."""
        now = now or time.time()
        out = []
        for n in self.list():
            if n["kind"] != "events" or not n["enabled"]:
                continue
            targets = self._targets(n)
            picked = [e for e in events if targets and self._event_ok(n, e) and self._due(n, e, now)]
            if not picked:
                continue
            for ch in targets:
                ok, info = alerts.send(ch, n["name"], picked)
                self.a._log(f"🔔 {n['name']}", ch["name"], ok, len(picked), info, alerts.summary(picked))
                out.append(f"{n['name']} → {ch['name']} : {info}")
            with self.a._db() as db:
                db.executemany("INSERT OR REPLACE INTO alert_last (rule_id, key, ts) VALUES (?, ?, ?)", [(-n["id"], alerts._last_key(e), now) for e in picked])
        return out

    def _due(self, n: dict, e: dict, now: float) -> bool:
        cd = n["config"].get("cooldown_min", 0)
        if not cd:
            return True
        with self.a._db() as db:
            r = db.execute("SELECT ts FROM alert_last WHERE rule_id = ? AND key = ?", (-n["id"], alerts._last_key(e))).fetchone()
        return r is None or now - r["ts"] >= cd * 60

    def tick(self, now: datetime | None = None) -> list[str]:
        """Chaque minute : les rapports dont l'heure est venue (jour de la semaine compris) partent, une seule fois par minute."""
        now = now or datetime.now()
        hhmm = now.strftime("%H:%M")
        out = []
        for n in self.list():
            c = n["config"]
            if n["kind"] != "report" or not n["enabled"] or hhmm not in c["at"] or now.weekday() not in c["days"]:
                continue
            if n["last_sent"] and now.timestamp() - n["last_sent"] < 90:
                continue
            with self.a._db() as db:
                db.execute("UPDATE notifications SET last_sent = ? WHERE id = ?", (now.timestamp(), n["id"]))
            out += self.send_report(n)
        return out
