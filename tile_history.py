"""History of the figures shown in the tiles of a page that the other histories do not keep, in SQLite (/data/myservices.db).

The health of the machines (how many read machines are fully healthy, out of how many were read), taken from health/stats.json
after each health pass, with the same rule as the « Health » tile of the Machines page; and the figures of the Network tiles (equipment
online, clients, devices online), taken from data.json after each collection with the same merge as the page. One point every MIN_GAP s at most, kept for
KEEP_S (7 days: the longest period a tile can draw). Reachability is not stored here: availability.py already keeps it.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

KEEP_S = 7 * 24 * 3600
MIN_GAP = 540
LIVE_GAP = 55   # s, the keys read every minute (GPU, DNS answers): two points at least this far apart
HEALTH = "machines.health"
NET_GEAR, NET_CLIENTS, NET_DEVICES = "network.gear", "network.clients", "network.devices"
NETWORK = (NET_GEAR, NET_CLIENTS, NET_DEVICES)
BACKUPS_OK, BACKUPS_LATE, BACKUPS_BAD = "backups.ok", "backups.late", "backups.bad"
BACKUPS = (BACKUPS_OK, BACKUPS_LATE, BACKUPS_BAD)
SERVICES_WARN, SERVICES_HEALTH = "services.warn", "services.health"
AGENTS_RUNNING, AGENTS_LATE, AGENTS_HEALTH = "agents.running", "agents.late", "agents.health"
AGENTS = (AGENTS_RUNNING, AGENTS_LATE, AGENTS_HEALTH)
VIRT = ("virt.hosts", "virt.guests", "virt.cpu", "virt.mem", "virt.storage", "virt.backups")
AI = ("ai.gpu", "ai.vram", "ai.temp", "ai.power", "ai.engines", "ai.models", "ai.agents", "ai.ram")

SCHEMA = """
CREATE TABLE IF NOT EXISTS tile_samples (key TEXT NOT NULL, ts INTEGER NOT NULL, value INTEGER NOT NULL, total INTEGER NOT NULL,
  PRIMARY KEY (key, ts)) WITHOUT ROWID;
"""


@contextmanager
def _db(path: str | Path):
    db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(SCHEMA)
        yield db
    finally:
        db.close()


def health_point(stats: dict) -> tuple[int, int, int] | None:
    """(time, healthy machines, machines read) of stats.json; None without a readable time or without any machine read."""
    try:
        ts = int(datetime.fromisoformat(str(stats.get("timestamp"))).timestamp())
    except ValueError:
        return None
    read = [h for h in stats.get("hosts") or [] if isinstance(h, dict) and h.get("level") not in (None, "na")]
    if not read:
        return None
    return ts, sum(1 for h in read if h.get("reachable") is not False and h.get("level") == "ok"), len(read)


def sample(db_path: str | Path, stats_file: Path, now: float | None = None) -> int:
    """The health point of stats_file when it is new enough to add; how many were added (0 or 1). Missing or unreadable file: 0."""
    try:
        pt = health_point(json.loads(stats_file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0
    return store(db_path, HEALTH, pt, now) if pt else 0


def _gear_up(g: dict) -> bool:
    if g.get("online") is not None:
        return bool(g["online"])
    return not re.search(r"offline|disconnect|interrupt|isolat", str(g.get("state") or "online"), re.I)


def _merge_unifi(lists: list[tuple[str, object]]) -> tuple[dict[str, dict], dict[str, dict]]:
    """The UniFi equipment and clients of several sources merged by MAC (the later source wins field by field)."""
    gear: dict[str, dict] = {}
    clients: dict[str, dict] = {}
    for source, u in lists:
        if not isinstance(u, dict):
            continue
        for d in u.get("devices") or []:
            k = str(d.get("mac") or "").lower() or f"{source}/{d.get('name')}"
            gear[k] = {**gear.get(k, {}), **d}
        for c in u.get("clients") or []:
            k = str(c.get("mac") or "").lower() or f"{c.get('ip')}/{c.get('name')}"
            clients[k] = {**clients.get(k, {}), **c}
    return gear, clients


def network_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Network tiles from data.json: equipment online / equipment, clients (wifi + wired, same count as total),
    devices online / devices. UniFi lists of MynetworK then of the UniFi connector are merged by MAC (the later one fresher), like the page.
    A figure the sources do not give is left out."""
    net = [c for c in data.get("network") or [] if isinstance(c, dict)]
    lists = [(str(c.get("label")), c.get("unifi")) for c in net]
    lists += [(str(c.get("label")), c.get("unifi")) for c in data.get("services_status") or [] if isinstance(c, dict) and c.get("connector") == "unifi"]
    gear, clients = _merge_unifi(lists)
    out: dict[str, tuple[int, int]] = {}
    if gear:
        out[NET_GEAR] = (sum(1 for g in gear.values() if _gear_up(g)), len(gear))
    if clients:
        out[NET_CLIENTS] = (len(clients), len(clients))
    devices = [d for c in net for d in c.get("devices") or [] if isinstance(d, dict)]
    if devices:
        out[NET_DEVICES] = (sum(1 for d in devices if d.get("status") == "online"), len(devices))
    return out


def _followed(h: dict) -> bool:
    """A service is followed unless it is paused, its machine or container stopped on purpose, or it is disabled."""
    return not (h.get("paused") or h.get("machine_off") or h.get("stopped")) and bool(h.get("enabled"))


def _proxied_warns(h: dict, p: dict, b: dict) -> bool:
    """The warning of a service behind the proxy (the last rules of front lib/status.ts): none while its backend is down or answers an error."""
    if b.get("internal") or b.get("up") is False or (p.get("code") or 0) >= 500:
        return False
    if p.get("err") == "RemoteDisconnected":
        return not h.get("closes_root")
    return bool(p.get("err"))


def _service_warns(h: dict) -> bool | None:
    """True when a service of data.json is « to watch » (front lib/status.ts, class warn), False when it is in another state, None when it is not
    followed (paused, machine or container stopped on purpose, disabled, listening on an internal address only)."""
    if not _followed(h):
        return None
    p, b = h.get("public") or {}, h.get("backend") or {}
    kind = h.get("type")
    if kind == "dead":
        return p.get("code") != 404
    if kind == "stream":
        return False
    if kind == "redirect":
        return bool(p.get("code")) and ((h.get("follow") or {}).get("code") or 0) >= 500
    if kind == "local":
        return None if b.get("internal") and not b.get("up") else False
    return _proxied_warns(h, p, b)


def _service_down(h: dict) -> bool:
    """True when a service followed is « down » (front lib/status.ts, class bad): backend or stream unreachable, a server error, a redirect with no answer."""
    p, b = h.get("public") or {}, h.get("backend") or {}
    kind = h.get("type")
    if kind == "dead":
        return False
    if kind == "stream" or (kind == "local" and not b.get("internal")):
        return not b.get("up")
    if kind == "redirect":
        return not p.get("code")
    if b.get("internal"):
        return not p.get("code") or p["code"] >= 500
    return b.get("up") is False or (p.get("code") or 0) >= 500


def services_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Services « Warning » tile: the services followed that are not in warning, out of the services followed
    (so a strip counts the ones in warning). The services the user hid from « To watch » are counted like the others."""
    followed = [(h, w) for h in data.get("hosts") or [] if isinstance(h, dict) and (w := _service_warns(h)) is not None]
    if not followed:
        return {}
    healthy = sum(1 for h, w in followed if not w and not _service_down(h))
    return {SERVICES_WARN: (sum(1 for _, w in followed if not w), len(followed)), SERVICES_HEALTH: (round(healthy / len(followed) * 100), 100)}


def sample_services(db_path: str | Path, data_file: Path, now: float | None = None) -> int:
    """The Services tile point of data.json (read at its own time) when new enough to add; how many were added."""
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
        ts = int(datetime.fromisoformat(str(data.get("generated"))).timestamp())
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (ts, *vt), now) for key, vt in services_points(data).items())


def agent_health(a: dict) -> int | None:
    """Health of an agent out of 100 (front lib/accessLists.ts agentHealth): 50 answering in time, 30 script up to date, 20 machine recognized.
    None for a revoked agent, 0 while it never reported."""
    if a.get("state") == "révoqué":
        return None
    if a.get("state") == "en attente":
        return 0
    return (50 if a.get("state") == "actif" else 0) + (0 if a.get("outdated") else 30) + (0 if a.get("host_pending") else 20)


def agents_points(agents: list[dict]) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Agents tiles, counted like the page: the agents not revoked; « running » is the ones answering in time, « late »
    the ones with an older script that no update was asked for yet (as the value of its key the ones that are not, so a strip counts the late ones)."""
    live = [a for a in agents if a.get("state") != "révoqué"]
    if not live:
        return {}
    n = len(live)
    late = sum(1 for a in live if a.get("outdated") and not a.get("update_requested"))
    scores = [agent_health(a) or 0 for a in live]
    return {AGENTS_RUNNING: (sum(1 for a in live if a.get("state") == "actif"), n), AGENTS_LATE: (n - late, n),
            AGENTS_HEALTH: (round(sum(scores) / n), 100)}


def sample_agents(db_path: str | Path, agents: list[dict], now: float | None = None) -> int:
    """The state of the agents as of now, one point per key at each collection."""
    now = now or time.time()
    return sum(store(db_path, key, (int(now), *vt), now) for key, vt in agents_points(agents).items())


def _mean(values: list[float]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def _gpu_points(gpus: list[dict]) -> dict[str, tuple[int, int]]:
    """The GPU tiles: mean load, memory in use, hottest, power (and its limit) over the GPUs given."""
    out: dict[str, tuple[int, int]] = {}
    if (load := _mean([g["util"] for g in gpus if g.get("util") is not None])) is not None:
        out["ai.gpu"] = (load, 100)
    used, total = sum(g.get("mem_used") or 0 for g in gpus), sum(g.get("mem_total") or 0 for g in gpus)
    if total:
        out["ai.vram"] = (round(used / total * 100), 100)
    if temps := [g["temp"] for g in gpus if g.get("temp") is not None]:
        out["ai.temp"] = (round(max(temps)), 100)
    if watts := [g["power"] for g in gpus if g.get("power") is not None]:
        w = round(sum(watts))
        out["ai.power"] = (w, max(w, round(sum(g.get("power_limit") or 0 for g in gpus))))
    return out


def _ai_role(c: dict) -> str | None:
    return (c.get("ai") or {}).get("role")


def _ai_content_points(rows: list[dict]) -> dict[str, tuple[int, int]]:
    """The tiles of the content: engines answering, models loaded, agent platforms connected."""
    out: dict[str, tuple[int, int]] = {}
    if engines := [c for c in rows if _ai_role(c) == "engine"]:
        out["ai.engines"] = (sum(1 for c in engines if c.get("ok")), len(engines))
        if models := [m for c in engines for m in (c.get("ai") or {}).get("models") or [] if isinstance(m, dict)]:
            out["ai.models"] = (sum(1 for m in models if m.get("loaded")), len(models))
    if plats := [p for c in rows if _ai_role(c) == "agent" for p in (c.get("ai") or {}).get("platforms") or [] if isinstance(p, dict)]:
        out["ai.agents"] = (sum(1 for p in plats if p.get("state") == "connected"), len(plats))
    return out


def _ai_machines(rows: list[dict]) -> tuple[list[dict], set[str]]:
    """The GPUs, and the addresses, of the machines GpuViewR reads that answer."""
    gpus: list[dict] = []
    ips: set[str] = set()
    for m in (m for c in rows if c.get("connector") == "gpuviewr" for m in c.get("machines") or []):
        if isinstance(m, dict) and m.get("online"):
            gpus += [g for g in m.get("gpus") or [] if isinstance(g, dict)]
            ips.update(m.get("ips") or [])
    return gpus, ips


def ai_points(data: dict, stats: dict | None = None) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the « IA et agents » tiles from data.json (and the machine memory of stats.json), counted like the page: the GPUs
    GpuViewR reads on machines that answer (load, memory in use, hottest, power), the engines and agent platforms read, the models loaded."""
    rows = [c for c in data.get("services_status") or [] if isinstance(c, dict)]
    gpus, ips = _ai_machines(rows)
    out = {**_gpu_points(gpus), **_ai_content_points(rows)}
    mem = [h["res"]["mem_pct"] for h in (stats or {}).get("hosts") or []
           if isinstance(h, dict) and str(h.get("name", "")).rsplit(" · ", 1)[-1] in ips and (h.get("res") or {}).get("mem_pct") is not None]
    if (ram := _mean(mem)) is not None:
        out["ai.ram"] = (ram, 100)
    return out


def sample_gpu_live(db_path: str | Path, state_file: Path, now: float | None = None) -> int:
    """The GPU tiles from the readings the GpuViewR readers keep in the shared state (connectors.json), at the time of the reading: no call of
    its own, a point only when the connector has read again. How many points were added."""
    now = now or time.time()
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    rows = [{"connector": "gpuviewr", "machines": e["last"].get("machines") or []} for k, e in (state.items() if isinstance(state, dict) else [])
            if str(k).startswith("gpuviewr/") and isinstance(e, dict) and isinstance(e.get("last"), dict)]
    ats = [e["at"] for k, e in state.items() if str(k).startswith("gpuviewr/") and isinstance(e, dict) and isinstance(e.get("at"), (int, float))] if rows else []
    if not rows or not ats:
        return 0
    points = _gpu_points(_ai_machines(rows)[0])
    return sum(store(db_path, key, (int(max(ats)), *vt), now, gap=LIVE_GAP) for key, vt in points.items())


def sample_ai(db_path: str | Path, data_file: Path, stats_file: Path, now: float | None = None) -> int:
    """The state of the AI tiles as of now, one point per key at each collection; the memory needs stats.json, the rest only data.json."""
    now = now or time.time()
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    try:
        stats = json.loads(stats_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        stats = None
    return sum(store(db_path, key, (int(now), *vt), now) for key, vt in ai_points(data, stats).items())


def _virt_nodes_points(nodes: list[dict]) -> dict[str, tuple[int, int]]:
    """The hosts online, and the mean processor and memory of the ones online."""
    up = [n for n in nodes if n.get("online")]
    out = {"virt.hosts": (len(up), len(nodes))}
    for key, field in (("virt.cpu", "cpu_pct"), ("virt.mem", "mem_pct")):
        if (avg := _mean([n[field] for n in up if n.get(field) is not None])) is not None:
            out[key] = (avg, 100)
    return out


def _vzdump_sets(backups: dict | None) -> list[dict]:
    """The sets followed that are the vzdump of a machine."""
    return [x for x in (backups or {}).get("sets") or [] if isinstance(x, dict) and not x.get("archived") and ((x.get("locations") or [{}])[0] or {}).get("vzdump")]


def virt_points(data: dict, backups: dict | None = None) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Virtualization tiles from data.json (the hosts and machines every hypervisor read gives) and backups.json
    (the sets that are the vzdump of a machine), counted like the page: hosts online, machines running (templates out), the mean processor and
    memory of the hosts online, the fullest volume, and the vzdump sets up to date."""
    rows = [c for c in data.get("virtualization") or [] if isinstance(c, dict)]
    nodes = [n for c in rows for n in c.get("nodes") or [] if isinstance(n, dict)]
    guests = [g for c in rows for g in c.get("guests") or [] if isinstance(g, dict) and not g.get("template")]
    out = _virt_nodes_points(nodes) if nodes else {}
    if guests:
        out["virt.guests"] = (sum(1 for g in guests if g.get("status") == "running"), len(guests))
    if used := [st["used_pct"] for c in rows for st in c.get("storage") or [] if isinstance(st, dict) and st.get("used_pct") is not None]:
        out["virt.storage"] = (round(max(used)), 100)
    if sets := _vzdump_sets(backups):
        out["virt.backups"] = (sum(1 for x in sets if x.get("level") == "ok"), len(sets))
    return out


def sample_virt(db_path: str | Path, data_file: Path, backups_file: Path, now: float | None = None) -> int:
    """The Virtualization tiles as of now, one point per key at each collection; the backups figure needs backups.json, the rest only data.json."""
    now = now or time.time()
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    try:
        backups = json.loads(backups_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        backups = None
    return sum(store(db_path, key, (int(now), *vt), now) for key, vt in virt_points(data, backups).items())


def backups_points(data: dict) -> dict[str, tuple[int, int]]:
    """{key: (value, total)} of the Backups tiles from backups.json, counted like the page: the sets not archived; « up to date » as the value of
    its key, « late » and « missing or failing » as the sets that are not (so a strip counts the missing ones, like the Machines tiles)."""
    live = [s for s in data.get("sets") or [] if isinstance(s, dict) and not s.get("archived")]
    if not live:
        return {}
    n = len(live)
    late = sum(1 for s in live if s.get("level") == "warn")
    bad = sum(1 for s in live if s.get("level") in ("crit", "down"))
    return {BACKUPS_OK: (sum(1 for s in live if s.get("level") == "ok"), n), BACKUPS_LATE: (n - late, n), BACKUPS_BAD: (n - bad, n)}


def sample_backups(db_path: str | Path, backups_file: Path, now: float | None = None) -> int:
    """The state of the backups as of now (backups.json is written a few times a day, the tiles want a point at each collection)."""
    now = now or time.time()
    try:
        points = backups_points(json.loads(backups_file.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (int(now), *vt), now) for key, vt in points.items())


def sample_network(db_path: str | Path, data_file: Path, now: float | None = None) -> int:
    """The Network points of data.json (read at its own time) when new enough to add; how many were added. Missing or unreadable file: 0."""
    try:
        data = json.loads(data_file.read_text(encoding="utf-8"))
        ts = int(datetime.fromisoformat(str(data.get("generated"))).timestamp())
    except (OSError, ValueError):
        return 0
    return sum(store(db_path, key, (ts, *vt), now) for key, vt in network_points(data).items())


def store(db_path: str | Path, key: str, pt: tuple[int, int, int], now: float | None = None, gap: int | None = None) -> int:
    """One point (time, value, total) unless the key has one less than `gap` s older; purges what is past KEEP_S."""
    ts, value, total = pt
    gap = MIN_GAP if gap is None else gap
    oldest = int((now or time.time()) - KEEP_S)
    with _db(db_path) as db:
        db.execute("DELETE FROM tile_samples WHERE ts < ?", (oldest,))
        last = db.execute("SELECT MAX(ts) FROM tile_samples WHERE key = ?", (key,)).fetchone()[0]
        if ts < oldest or (last is not None and ts < last + gap):
            return 0
        return db.execute("INSERT OR IGNORE INTO tile_samples (key, ts, value, total) VALUES (?, ?, ?, ?)", (key, ts, value, total)).rowcount


def series(db_path: str | Path, key: str, hours: int, now: float | None = None) -> list[list[int]]:
    """[[time, value, total], ...] of the last `hours`, oldest first."""
    with _db(db_path) as db:
        rows = db.execute("SELECT ts, value, total FROM tile_samples WHERE key = ? AND ts >= ? ORDER BY ts",
                          (key, int((now or time.time()) - hours * 3600))).fetchall()
    return [list(r) for r in rows]
