"""Historique dans SQLite (/data/myservices.db) : événements du watcher et de la santé, gardés un an.

Le watcher et health.py écrivent toujours leur events.json (90 jours, lu par la page actuelle) ;
après chacun de leurs passages, ingest() recopie les nouveaux événements dans la table « events »
(sans doublon : même horodatage, même clé, même genre, même source). L'API v1 les lit ici, avec filtres
et comptes par jour pour les graphes.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

RETENTION_DAYS = 365

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts REAL NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, key TEXT,
  label TEXT, machine TEXT, target TEXT, detail TEXT,
  UNIQUE (ts, source, kind, key));
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind, ts);
"""


@contextmanager
def _db(path: str | Path):
    """Connexion fermée en sortie de bloc (le « with » de sqlite3 seul ne ferme pas)."""
    db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(SCHEMA)
        yield db
    finally:
        db.close()


def _ts(e: dict) -> float | None:
    """Horodatage d'un événement : « ts » ISO 8601, sinon « at » (heure locale, anciens événements)."""
    try:
        if e.get("ts"):
            return datetime.fromisoformat(e["ts"]).timestamp()
        return datetime.strptime(e["at"], "%Y-%m-%d %H:%M").astimezone().timestamp()
    except (KeyError, TypeError, ValueError):
        return None


def ingest(db_path: str | Path, events_file: Path, source: str, added: list | None = None) -> int:
    """Événements de events_file pas encore en base ; nombre ajouté. Fichier absent ou illisible : 0.
    added : reçoit les événements ajoutés (pour les alertes)."""
    try:
        events = json.loads(events_file.read_text(encoding="utf-8")).get("events", [])
    except (OSError, ValueError):
        return 0
    oldest = time.time() - RETENTION_DAYS * 86400
    # Clé vide plutôt que NULL : deux NULL ne sont jamais « égaux » pour UNIQUE, d'où des doublons
    rows = [(t, source, e.get("kind", "?"), e.get("key") or "", e.get("label"), e.get("machine"), e.get("target"),
             e.get("detail")) for e in events if (t := _ts(e)) is not None and t >= oldest]
    with _db(db_path) as db:
        db.execute("DELETE FROM events WHERE ts < ?", (oldest,))
        n = 0
        for row in rows:
            if db.execute("INSERT OR IGNORE INTO events (ts, source, kind, key, label, machine, target, detail) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", row).rowcount:
                n += 1
                if added is not None:
                    added.append(dict(zip(("ts", "source", "kind", "key", "label", "machine", "target", "detail"), row)))
        return n


def query(db_path: str | Path, since: float | None = None, until: float | None = None, kind: str | None = None,
          machine: str | None = None, source: str | None = None, q: str | None = None, limit: int = 500) -> list[dict]:
    where, args = [], []
    for col, val in (("ts >=", since), ("ts <", until), ("kind =", kind), ("machine =", machine), ("source =", source)):
        if val is not None:
            where.append(f"{col} ?")
            args.append(val)
    if q:
        where.append("(label LIKE ? OR detail LIKE ? OR target LIKE ?)")
        args += [f"%{q}%"] * 3
    sql = ("SELECT ts, source, kind, key, label, machine, target, detail FROM events"
           + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY ts DESC LIMIT ?")
    with _db(db_path) as db:
        return [dict(r) for r in db.execute(sql, (*args, min(max(limit, 1), 5000)))]


def per_day(db_path: str | Path, days: int = 30) -> list[dict]:
    """Nombre d'événements par jour (heure locale) et par genre, sur les derniers jours : pour les graphes."""
    with _db(db_path) as db:
        return [dict(r) for r in db.execute(
            "SELECT date(ts, 'unixepoch', 'localtime') AS day, kind, COUNT(*) AS n FROM events "
            "WHERE ts >= ? GROUP BY day, kind ORDER BY day", (time.time() - min(max(days, 1), RETENTION_DAYS) * 86400,))]
