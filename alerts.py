"""Alertes (version Docker) : canaux, règles et journal des envois, dans SQLite (/data/myservices.db).

Sur le modèle de GpuViewR (Réglages → Alertes) : une règle choisit des genres d'événements (panne, machine
hors ligne, santé critique…), éventuellement une machine ou un texte, et les canaux qui reçoivent ; un délai
évite de renvoyer la même alerte (même règle, même élément, même genre) trop souvent. Les retours à la normale
partent aussi si la règle le demande.

Les événements viennent de l'historique : après chaque passage du watcher et de la santé, server.py recopie
les nouveaux événements dans SQLite (history.ingest) puis appelle dispatch() avec eux. Les pannes y sont déjà
confirmées (CONFIRM_RUNS passages de suite) : pas de durée « maintenu » à rejouer ici.

Canaux : Discord (webhook), Telegram (bot + conversation), webhook générique (POST JSON, jeton Bearer
facultatif). Secrets (URL de webhook, jeton) chiffrés au repos avec la clé de config.json (secrets_store) ;
jamais renvoyés à la page (champ « set » seulement).

Dès qu'une règle active existe, watcher.py et health.py n'envoient plus eux-mêmes (MYSERVICES_ALERTS_ENGINE,
posé par server.py) : pas de doublon. Au premier usage, les canaux de config.json (discord_webhook,
telegram_*) sont repris avec une règle « comme avant ».
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import notify
import secrets_store

# Genres d'événements, par famille (même regroupement que l'onglet Historique). Chaque genre « problème »
# a son retour à la normale : envoyé avec la règle si elle le demande.
KINDS = {
    "panne": ("Service en panne", "services"), "unhealthy": ("Conteneur unhealthy", "services"),
    "hors_ligne": ("Machine hors ligne", "machines"), "ssh_down": ("SSH injoignable", "machines"),
    "health_crit": ("Santé critique", "sante"), "health_warn": ("Santé à surveiller", "sante"),
    "health_down": ("Machine injoignable (santé)", "sante"),
    "securite": ("Sécurité (ACL, SSL)", "securite"), "ui_hors": ("Interface sans domaine", "securite"),
    "dns": ("DNS", "securite"), "connecteur": ("Connecteur en panne", "connecteurs"),
    "perime": ("Collecte en retard", "connecteurs"),
    "nouveau": ("Nouveau service", "inventaire"), "disparu": ("Service disparu", "inventaire"),
}
GROUPS = {"services": "Services", "machines": "Machines", "sante": "Santé", "securite": "Sécurité / DNS",
          "connecteurs": "Connecteurs et collecte", "inventaire": "Inventaire"}
RESOLVES = {"retabli": "panne", "en_ligne": "hors_ligne", "ssh_ok": "ssh_down", "connecteur_ok": "connecteur",
            "health_ok": ("health_crit", "health_warn", "health_down")}
CHANNELS = {"discord": ("url",), "telegram": ("token", "chat_id"), "webhook": ("url", "token")}
SECRET_FIELDS = {"url", "token"}  # chat_id n'est pas un secret
MAX_LINES = 15
SENT_KEEP_DAYS = 90

# Préréglages : ajoutés désactivés, à relire avant de les activer (comme GpuViewR)
PRESETS = [
    {"name": "Pannes de services", "kinds": ["panne", "unhealthy"], "resolved": True, "cooldown_min": 60},
    {"name": "Machines hors ligne", "kinds": ["hors_ligne", "ssh_down", "health_down"], "resolved": True, "cooldown_min": 60},
    {"name": "Santé critique", "kinds": ["health_crit"], "resolved": True, "cooldown_min": 360},
    {"name": "Sécurité et DNS", "kinds": ["securite", "ui_hors", "dns"], "resolved": False, "cooldown_min": 1440},
    {"name": "Connecteurs et collecte", "kinds": ["connecteur", "perime"], "resolved": True, "cooldown_min": 120},
    {"name": "Inventaire (nouveaux / disparus)", "kinds": ["nouveau", "disparu"], "resolved": False, "cooldown_min": 0},
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_channels (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kinds TEXT NOT NULL, machine TEXT NOT NULL DEFAULT '',
  match TEXT NOT NULL DEFAULT '', channels TEXT NOT NULL, cooldown_min INTEGER NOT NULL DEFAULT 60,
  resolved INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS alert_sent (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, rule TEXT, channel TEXT, ok INTEGER NOT NULL, n INTEGER NOT NULL,
  info TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS alert_last (rule_id INTEGER NOT NULL, key TEXT NOT NULL, ts REAL NOT NULL,
  PRIMARY KEY (rule_id, key));
CREATE TABLE IF NOT EXISTS alert_meta (k TEXT PRIMARY KEY, v TEXT);
"""


class AlertError(Exception):
    """Refus lisible (canal inconnu, champ manquant…)."""


def _config_file() -> Path:
    return Path(os.environ.get("MYSERVICES_CONFIG") or Path(__file__).resolve().parent / "config.json")


class Alerts:
    def __init__(self, path: str | Path, cfg: dict | None = None):
        self.path = str(path)
        with self._db() as db:
            db.executescript(SCHEMA)
        if cfg is not None:
            self._import_legacy(cfg)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA journal_mode = WAL")
            yield db
        finally:
            db.close()

    # ── secrets ──
    def _seal(self, conf: dict) -> str:
        f = secrets_store._fernet(_config_file(), create=True)
        return json.dumps({k: (secrets_store.PREFIX + f.encrypt(v.encode()).decode() if k in SECRET_FIELDS and v else v)
                           for k, v in conf.items()})

    def _open(self, raw: str) -> dict:
        return secrets_store.decrypt_all(json.loads(raw), _config_file())

    # ── canaux ──
    def channels(self) -> list[dict]:
        """Canaux pour la page : secrets masqués (« set » dit seulement s'ils sont renseignés)."""
        out = []
        with self._db() as db:
            for r in db.execute("SELECT * FROM alert_channels ORDER BY id"):
                conf = json.loads(r["config"])
                out.append({"id": r["id"], "name": r["name"], "type": r["type"], "enabled": bool(r["enabled"]),
                            "config": {k: ("" if k in SECRET_FIELDS else v) for k, v in conf.items()},
                            "set": {k: bool(v) for k, v in conf.items() if k in SECRET_FIELDS}})
        return out

    def _check_channel(self, type_: str, conf: dict) -> dict:
        if type_ not in CHANNELS:
            raise AlertError(f"canal inconnu (canaux : {', '.join(CHANNELS)})")
        conf = {k: str(conf.get(k) or "").strip() for k in CHANNELS[type_]}
        need = {"discord": ("url",), "telegram": ("token", "chat_id"), "webhook": ("url",)}[type_]
        if missing := [k for k in need if not conf[k]]:
            raise AlertError(f"champ requis : {', '.join(missing)}")
        if conf.get("url") and not conf["url"].startswith(("https://", "http://")):
            raise AlertError("l'URL doit commencer par https:// (ou http:// sur le réseau local)")
        return conf

    def add_channel(self, name: str, type_: str, conf: dict, enabled: bool = True) -> int:
        conf = self._check_channel(type_, conf)
        with self._db() as db:
            return db.execute("INSERT INTO alert_channels (name, type, config, enabled, created) VALUES (?, ?, ?, ?, ?)",
                              (name.strip() or type_, type_, self._seal(conf), int(enabled), time.time())).lastrowid

    def update_channel(self, cid: int, name: str | None = None, conf: dict | None = None, enabled: bool | None = None) -> None:
        """Secret laissé vide = gardé tel quel (la page ne le connaît pas)."""
        with self._db() as db:
            r = db.execute("SELECT * FROM alert_channels WHERE id = ?", (cid,)).fetchone()
            if r is None:
                raise AlertError("canal inconnu")
            if conf is not None:
                old = self._open(r["config"])
                merged = {k: (conf.get(k) or old.get(k, "") if k in SECRET_FIELDS else conf.get(k, old.get(k, "")))
                          for k in CHANNELS[r["type"]]}
                db.execute("UPDATE alert_channels SET config = ? WHERE id = ?",
                           (self._seal(self._check_channel(r["type"], merged)), cid))
            if name is not None:
                db.execute("UPDATE alert_channels SET name = ? WHERE id = ?", (name.strip() or r["type"], cid))
            if enabled is not None:
                db.execute("UPDATE alert_channels SET enabled = ? WHERE id = ?", (int(enabled), cid))

    def delete_channel(self, cid: int) -> None:
        with self._db() as db:
            if not db.execute("DELETE FROM alert_channels WHERE id = ?", (cid,)).rowcount:
                raise AlertError("canal inconnu")

    def test_channel(self, cid: int) -> tuple[bool, str]:
        """Message d'essai sur ce canal (noté dans le journal)."""
        ch = self._channel(cid)
        ev = {"kind": "essai", "label": "Essai", "machine": None, "target": None,
              "detail": "message d'essai envoyé depuis Réglages → Alertes", "ts": time.time()}
        ok, info = send(ch, "Essai", [ev], test=True)
        self._log("Essai", ch["name"], ok, 1, info, "message d'essai")
        return ok, info

    def _channel(self, cid: int) -> dict:
        with self._db() as db:
            r = db.execute("SELECT * FROM alert_channels WHERE id = ?", (cid,)).fetchone()
        if r is None:
            raise AlertError("canal inconnu")
        return {"id": r["id"], "name": r["name"], "type": r["type"], "enabled": bool(r["enabled"]), **self._open(r["config"])}

    # ── règles ──
    def rules(self) -> list[dict]:
        with self._db() as db:
            return [{**dict(r), "kinds": json.loads(r["kinds"]), "channels": json.loads(r["channels"]),
                     "resolved": bool(r["resolved"]), "enabled": bool(r["enabled"])}
                    for r in db.execute("SELECT * FROM alert_rules ORDER BY id")]

    def _check_rule(self, r: dict) -> dict:
        kinds = [k for k in r.get("kinds") or [] if k in KINDS]
        if not kinds:
            raise AlertError("choisir au moins un genre d'événement")
        return {"name": (r.get("name") or "").strip() or ", ".join(KINDS[k][0] for k in kinds)[:80],
                "kinds": json.dumps(kinds), "machine": (r.get("machine") or "").strip(),
                "match": (r.get("match") or "").strip(), "channels": json.dumps([int(c) for c in r.get("channels") or []]),
                "cooldown_min": max(0, min(int(r.get("cooldown_min", 60)), 7 * 1440)),
                "resolved": int(bool(r.get("resolved", True))), "enabled": int(bool(r.get("enabled", True)))}

    def add_rule(self, r: dict) -> int:
        v = self._check_rule(r)
        with self._db() as db:
            return db.execute(f"INSERT INTO alert_rules ({', '.join(v)}, created) VALUES ({', '.join('?' * len(v))}, ?)",
                              (*v.values(), time.time())).lastrowid

    def update_rule(self, rid: int, r: dict) -> None:
        with self._db() as db:
            old = db.execute("SELECT * FROM alert_rules WHERE id = ?", (rid,)).fetchone()
            if old is None:
                raise AlertError("règle inconnue")
            cur = {**dict(old), "kinds": json.loads(old["kinds"]), "channels": json.loads(old["channels"])}
            v = self._check_rule({**cur, **{k: x for k, x in r.items() if x is not None}})
            db.execute(f"UPDATE alert_rules SET {', '.join(f'{k} = ?' for k in v)} WHERE id = ?", (*v.values(), rid))

    def delete_rule(self, rid: int) -> None:
        with self._db() as db:
            if not db.execute("DELETE FROM alert_rules WHERE id = ?", (rid,)).rowcount:
                raise AlertError("règle inconnue")
            db.execute("DELETE FROM alert_last WHERE rule_id = ?", (rid,))

    def add_presets(self, names: list[str]) -> int:
        """Préréglages choisis, ajoutés désactivés, sur tous les canaux ; ceux déjà présents (même nom) sont sautés."""
        have = {r["name"] for r in self.rules()}
        chans = [c["id"] for c in self.channels()]
        n = 0
        for p in PRESETS:
            if p["name"] in names and p["name"] not in have:
                self.add_rule({**p, "channels": chans, "enabled": False})
                n += 1
        return n

    def active(self) -> bool:
        """Au moins une règle active avec un canal actif : le moteur envoie, watcher et santé se taisent."""
        on = {c["id"] for c in self.channels() if c["enabled"]}
        return any(r["enabled"] and on & set(r["channels"]) for r in self.rules())

    # ── envoi ──
    def dispatch(self, events: list[dict], now: float | None = None) -> list[str]:
        """Évalue les règles actives sur ces nouveaux événements et envoie ; lignes de journal en retour."""
        now = now or time.time()
        chans = {c["id"]: c for c in self.channels() if c["enabled"]}
        out = []
        for rule in self.rules():
            targets = [c for c in rule["channels"] if c in chans]
            if not rule["enabled"] or not targets:
                continue
            picked = [e for e in events if matches(rule, e) and self._due(rule, e, now)]
            if not picked:
                continue
            for cid in targets:
                ch = self._channel(cid)
                ok, info = send(ch, rule["name"], picked)
                self._log(rule["name"], ch["name"], ok, len(picked), info, summary(picked))
                out.append(f"{rule['name']} → {ch['name']} : {info}")
            with self._db() as db:
                db.executemany("INSERT OR REPLACE INTO alert_last (rule_id, key, ts) VALUES (?, ?, ?)",
                               [(rule["id"], _last_key(e), now) for e in picked])
        return out

    def _due(self, rule: dict, e: dict, now: float) -> bool:
        if not rule["cooldown_min"]:
            return True
        with self._db() as db:
            r = db.execute("SELECT ts FROM alert_last WHERE rule_id = ? AND key = ?", (rule["id"], _last_key(e))).fetchone()
        return r is None or now - r["ts"] >= rule["cooldown_min"] * 60

    def _log(self, rule: str, channel: str, ok: bool, n: int, info: str, text: str) -> None:
        with self._db() as db:
            db.execute("INSERT INTO alert_sent (ts, rule, channel, ok, n, info, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (time.time(), rule, channel, int(ok), n, info[:300], text[:500]))
            db.execute("DELETE FROM alert_sent WHERE ts < ?", (time.time() - SENT_KEEP_DAYS * 86400,))

    def sent(self, limit: int = 100) -> list[dict]:
        with self._db() as db:
            return [dict(r) for r in db.execute("SELECT ts, rule, channel, ok, n, info, summary FROM alert_sent "
                                                "ORDER BY id DESC LIMIT ?", (min(max(limit, 1), 500),))]

    # ── reprise de config.json ──
    def _import_legacy(self, cfg: dict) -> None:
        """Une seule fois : canaux de config.json repris, avec une règle « comme avant » (tous les genres,
        retours compris, sans délai), pour que rien ne change quand le moteur prend la main."""
        with self._db() as db:
            if db.execute("SELECT 1 FROM alert_meta WHERE k = 'legacy_imported'").fetchone():
                return
            db.execute("INSERT INTO alert_meta (k, v) VALUES ('legacy_imported', ?)", (str(time.time()),))
        disc, hook = cfg.get("discord_webhook") or "", cfg.get("health_webhook") or ""
        main = [self.add_channel("Discord", "discord", {"url": disc})] if disc else []
        if cfg.get("telegram_token") and cfg.get("telegram_chat_id"):
            main.append(self.add_channel("Telegram", "telegram", {"token": cfg["telegram_token"],
                                                                  "chat_id": str(cfg["telegram_chat_id"])}))
        health = [k for k in KINDS if KINDS[k][1] == "sante"]
        rule = {"cooldown_min": 0, "resolved": True}
        if hook and hook != disc:  # santé sur son propre webhook (health_webhook), le reste sur discord_webhook
            tg = main[1:] if disc else main
            self.add_rule({**rule, "name": "Santé (repris de config.json)", "kinds": health,
                           "channels": [self.add_channel("Discord (santé)", "discord", {"url": hook}), *tg]})
            if main:
                self.add_rule({**rule, "name": "Comme avant (repris de config.json)",
                               "kinds": [k for k in KINDS if k not in health], "channels": main})
        elif main:
            self.add_rule({**rule, "name": "Comme avant (repris de config.json)", "kinds": list(KINDS), "channels": main})


def _last_key(e: dict) -> str:
    return f"{e.get('kind')}|{e.get('key') or e.get('label')}"


def matches(rule: dict, e: dict) -> bool:
    kind = e.get("kind", "")
    if kind not in rule["kinds"]:
        firing = RESOLVES.get(kind)
        firing = (firing,) if isinstance(firing, str) else firing or ()
        if not (rule["resolved"] and set(firing) & set(rule["kinds"])):
            return False
    if rule["machine"] and rule["machine"].casefold() not in f"{e.get('machine') or ''} {e.get('target') or ''}".casefold():
        return False
    text = f"{e.get('label') or ''} {e.get('target') or ''} {e.get('detail') or ''}".casefold()
    return not rule["match"] or rule["match"].casefold() in text


def state(e: dict) -> str:
    return "resolved" if e.get("kind") in RESOLVES else "firing"


def label(kind: str) -> str:
    if kind in KINDS:
        return KINDS[kind][0]
    return {"retabli": "Service rétabli", "en_ligne": "Machine en ligne", "ssh_ok": "SSH rétabli",
            "connecteur_ok": "Connecteur rétabli", "health_ok": "Santé OK", "essai": "Essai"}.get(kind, kind)


def line(e: dict) -> str:
    icon = "🔔" if e.get("kind") == "essai" else "🟢" if state(e) == "resolved" else "🔴"
    where = f" ({e['machine']})" if e.get("machine") else ""
    return f"{icon} {label(e.get('kind', ''))} : {e.get('label') or '?'}{where} · {e.get('detail') or ''}"


def summary(events: list[dict]) -> str:
    return "\n".join(line(e) for e in events[:MAX_LINES]) + (
        f"\n… et {len(events) - MAX_LINES} autre(s)" if len(events) > MAX_LINES else "")


def send(ch: dict, rule: str, events: list[dict], test: bool = False) -> tuple[bool, str]:
    """Envoi sur un canal ; (réussi, motif lisible). Jamais d'exception : un canal en panne n'arrête pas les autres."""
    title = f"MyServices · {rule}" + ("" if test else f" · {len(events)} événement{'s' if len(events) > 1 else ''}")
    text = f"{title}\n{summary(events)}"
    try:
        if ch["type"] == "discord":
            _post(ch["url"], {"content": f"**{title}**\n{summary(events)}"[:1900]})
        elif ch["type"] == "telegram":
            notify._tg("sendMessage", {"chat_id": ch["chat_id"], "text": text[:notify.TG_MAX],
                                       "link_preview_options": {"is_disabled": True}}, token=ch["token"])
        else:
            _post(ch["url"], payload(rule, events, text, test), ch.get("token"))
        return True, "envoyé"
    except (OSError, ValueError, KeyError) as e:
        return False, f"échec : {notify.why(e)}"


def payload(rule: str, events: list[dict], text: str, test: bool = False) -> dict:
    """Corps du webhook générique : stable, documenté dans la page (Réglages → Alertes)."""
    return {"source": "myservices", "test": test, "rule": rule, "message": text,
            "sent_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "events": [{"state": state(e), "kind": e.get("kind"), "title": label(e.get("kind", "")),
                        "label": e.get("label"), "machine": e.get("machine"), "target": e.get("target"),
                        "detail": e.get("detail"), "ts": e.get("ts")} for e in events]}


def _post(url: str, body: dict, token: str | None = None) -> None:
    headers = {"Content-Type": "application/json", "User-Agent": notify.USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()
