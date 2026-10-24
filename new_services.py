"""New services found on the machines (containers, processes): « follow it? » on the home page.

A service of a machine (type « local ») first seen in the last WINDOW_DAYS days (watcher event « nouveau ») is proposed until an
admin decides, unless a connector already reads it (its address, or its Docker image on that machine: covered()). Follow = keep it as it is, the choice is only remembered (state_dir/services-decided.json). Don't follow = the
existing « pause » of services-meta.json, written under « ip:port »: no probe, no alert, still listed in Services as paused, and
resumed from its detail. A container name is not used as the key: the same name can run on two machines.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import time
import urllib.parse
from pathlib import Path

WINDOW_DAYS = 7
MACHINE_OWN = {"openssh"}   # the machine's own SSH: already followed with the machine (SSH access, « SSH refused » alerts), never proposed
PAUSE_REASON = "not followed ({0})"


def _key(r: dict) -> str:
    return f'{r["type"]}:{r["id"]}'   # same key as watcher.key: the « nouveau » events carry it


def _decided_file(state_dir: str | Path) -> Path:
    return Path(state_dir) / "services-decided.json"


def _decided(state_dir: str | Path) -> dict[str, float]:
    try:
        got = json.loads(_decided_file(state_dir).read_text(encoding="utf-8"))
        return got if isinstance(got, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(f: Path, data: object) -> None:
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


def _endpoints(conf: dict) -> set[tuple[str, int | None]]:
    """(host, port) of every address set in a connector (url, indexer_url…); port None when the address gives none."""
    out = set()
    for v in conf.values():
        if isinstance(v, str) and v.startswith(("http://", "https://")):
            u = urllib.parse.urlsplit(v)
            try:
                port = u.port
            except ValueError:
                port = None
            if u.hostname:
                out.add((u.hostname, port))
    return out


def covered(rows: list[dict], connectors: list[tuple[dict, tuple[str, ...]]]) -> set[str]:
    """Keys of the services a set connector already reads: the same address and port, or a container of one of its images on the machine
    its address points to (Wazuh's manager also listens on 1514 and 1515). connectors: (settings, Docker images of its type)."""
    out = set()
    for conf, images in connectors:
        ends = _endpoints(conf)
        hosts = {h for h, _ in ends}
        for r in rows:
            image = str((r.get("service") or {}).get("image") or "").split(":")[0]
            if (r.get("ip"), r.get("port")) in ends or (r.get("ip") in hosts and image and image in images):
                out.add(_key(r))
    return out


def pending(data: dict, events: list[dict], state_dir: str | Path, connectors: list[tuple[dict, tuple[str, ...]]] | None = None) -> list[dict]:
    """Services to propose, newest first. events: the « nouveau » events of the window (history.query); connectors: see covered()."""
    rows = {_key(r): r for r in data.get("hosts") or [] if r.get("type") == "local"}
    decided, out, seen = _decided(state_dir), [], set(covered(list(rows.values()), connectors or []))
    for e in events:
        k, r = e.get("key"), rows.get(e.get("key"))
        if not r or k in seen or k in decided or r.get("paused") or (r.get("app") or {}).get("key") in MACHINE_OWN:
            continue
        seen.add(k)
        s = r.get("service") or {}
        out.append({"key": k, "name": s.get("name") or r.get("name") or r["id"], "kind": s.get("kind") or "", "image": s.get("image"),
                    "app": (r.get("app") or {}).get("label"), "machine": r.get("machine"), "ip": r.get("ip"), "port": r.get("port"), "since": e.get("ts")})
    return out


def follow(keys: list[str], state_dir: str | Path) -> None:
    """Keep these services as they are: no longer proposed (choices older than the window are dropped)."""
    now, horizon = time.time(), (WINDOW_DAYS + 1) * 86400
    marks = {k: v for k, v in _decided(state_dir).items() if now - v < horizon}
    marks.update({k: now for k in keys})
    _write_json(_decided_file(state_dir), marks)


def _target(data: dict, key: str) -> str:
    r = next((r for r in data.get("hosts") or [] if r.get("type") == "local" and _key(r) == key), None)
    if not r or not r.get("ip") or not r.get("port"):
        raise LookupError("service introuvable (déjà disparu ?)")
    return f'{r["ip"]}:{r["port"]}'


def _set_meta(meta_path: Path, target: str, field: str, value) -> None:
    """One field of the services-meta.json entry of `target` (a domain, « ip:port »…); None removes it, an empty entry goes."""
    import setup
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    services = meta.setdefault("services", {})
    entry = dict(services.get(target) or {})
    if value is None:
        entry.pop(field, None)
    else:
        entry[field] = value
    if entry:
        services[target] = entry
    else:
        services.pop(target, None)
    with contextlib.redirect_stdout(io.StringIO()):
        setup.save(meta_path, meta)


def set_pause(meta_path: Path, web_dir: str | Path, target: str, reason: str | None) -> None:
    """Pause (reason) or resume (None) the service at « ip:port »: services-meta.json for the next collections, and the published
    data.json at once so the pages show it without waiting."""
    _set_meta(meta_path, target, "pause", reason or None)

    def apply(r: dict) -> None:
        if r.get("type") == "local" and f'{r.get("ip")}:{r.get("port")}' == target:
            if reason:
                r["paused"] = reason
            else:
                r.pop("paused", None)
    _rewrite_hosts(web_dir, apply)


def set_public(meta_path: Path, web_dir: str | Path, domain: str, public: bool) -> None:
    """« Public site, on purpose » (an NPM host without access list that is meant to be reached from the Internet), set or removed under its
    domain in services-meta.json, and in the published data.json at once."""
    _set_meta(meta_path, domain, "public", True if public else None)

    def apply(r: dict) -> None:
        if domain in (r.get("domains") or []):
            r["public_ok"] = public
    _rewrite_hosts(web_dir, apply)


EDITABLE = ("name", "icon", "category", "description", "tags", "app", "web", "open_url", "public", "direct_ok", "pause", "alerts")
ALERTS = ("down", "none")   # « alerts »: outage only, or none; absent: every alert
HAND_PAUSE = "paused by hand"


def meta_keys(r: dict) -> list[str]:
    """The services-meta.json keys a row is looked up under, in the collector's order (myservices.meta_for): its domains, « ip:port », its service name."""
    return [*(r.get("domains") or []), f'{r.get("ip")}:{r.get("port")}', str((r.get("service") or {}).get("name") or "")]


def categories(meta_path: Path, data: dict) -> list[str]:
    """The categories a service can be given: the rules of services-meta.json and the ones already on a service, sorted."""
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    names = {c[0] for c in meta.get("categories") or [] if isinstance(c, list) and c and isinstance(c[0], str)}
    names |= {r["category"] for r in data.get("hosts") or [] if isinstance(r.get("category"), str) and r["category"]}
    return sorted(names, key=str.lower)


def current_entry(meta_path: Path, r: dict) -> tuple[str | None, dict]:
    """The services-meta.json entry a row uses (the collector's order), and its key; (None, {}) when it has none."""
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    services = meta.get("services") or {}
    key = next((k for k in meta_keys(r) if k in services), None)
    return key, dict(services[key]) if key else {}


def _entry_value(field: str, value, old: dict):
    """What one edited field writes (None: the field goes, back to what the detection finds)."""
    if field in ("public", "direct_ok"):
        return True if value else None
    if field == "pause":
        return (old.get("pause") or HAND_PAUSE) if value else None
    if field == "tags":
        return [t for t in value or [] if t] or None
    return value or None


def _meta_target(services: dict, r: dict) -> str:
    """The services-meta.json key to edit: the entry the row already uses, else its first domain, else « ip:port »."""
    keys = [k for k in meta_keys(r) if k and k != "None:None"]
    target = next((k for k in keys if k in services), keys[0] if keys else None)
    if not target:
        raise LookupError("service sans domaine ni adresse")
    return target


def apply_hand(r: dict, m: dict) -> None:
    """The hand-set fields the collector and the edit write the same way: display name, icon, address to open, alerts level, and the list
    of the fields set by hand (the page says where each value comes from)."""
    for field, out in (("name", "display_name"), ("icon", "icon"), ("open_url", "open_url"), ("alerts", "alerts")):
        if m.get(field):
            r[out] = m[field]
        else:
            r.pop(out, None)
    r["hand"] = [f for f in EDITABLE if m.get(f) not in (None, "", [], False)]


def _apply_entry(h: dict, entry: dict) -> None:
    """One published row following its edited entry (a category or an app back to automatic waits for the next collection)."""
    import known_apps
    if entry.get("category"):
        h["category"] = entry["category"]
    h["description"] = entry.get("description") or ((h.get("service") or {}).get("description")) or None
    h["tags"] = entry.get("tags", [])
    if entry.get("web"):
        h["web"] = entry["web"]
    h["public_ok"], h["direct_ok"] = bool(entry.get("public")), bool(entry.get("direct_ok"))
    if entry.get("pause"):
        h["paused"] = entry["pause"]
    else:
        h.pop("paused", None)
    if entry.get("app"):
        known_apps.annotate(h, keep_category=bool(entry.get("category")), app_key=entry["app"])
    apply_hand(h, entry)


def edit_meta(meta_path: Path, web_dir: str | Path, r: dict, fields: dict) -> str:
    """The hand-set fields of one service (EDITABLE), written in its existing services-meta.json entry (else a new one under its first domain,
    or « ip:port »), and in the published data.json at once. Returns the key used."""
    import setup
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    services = meta.setdefault("services", {})
    target = _meta_target(services, r)
    old = dict(services.get(target) or {})
    entry = {k: v for k, v in old.items() if k not in EDITABLE}
    entry.update({f: v for f in EDITABLE if (v := _entry_value(f, fields.get(f), old)) is not None})
    if entry:
        services[target] = entry
    else:
        services.pop(target, None)
    with contextlib.redirect_stdout(io.StringIO()):
        setup.save(meta_path, meta)
    key = (r.get("type"), str(r.get("id")))
    _rewrite_hosts(web_dir, lambda h: _apply_entry(h, entry) if (h.get("type"), str(h.get("id"))) == key else None)
    return target


def _rewrite_hosts(web_dir: str | Path, apply) -> None:
    """Applies `apply` to every host of the published data.json, written whole then renamed (no data.json yet: nothing to do)."""
    p = Path(web_dir) / "data.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    for r in data.get("hosts") or []:
        apply(r)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")  # NOSONAR S2083: path from the config or environment, never from a request; only the content comes from the user
    os.chmod(tmp, p.stat().st_mode & 0o777)
    tmp.replace(p)


def ignore(key: str, data: dict, meta_path: Path, web_dir: str | Path, state_dir: str | Path) -> str:
    """Don't follow: paused under its « ip:port », and no longer proposed. Returns the target."""
    target = _target(data, key)
    set_pause(meta_path, web_dir, target, PAUSE_REASON.format(time.strftime("%Y-%m-%d")))
    follow([key], state_dir)
    return target
