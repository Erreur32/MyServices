"""New services found on the machines (containers, processes): « follow it? » on the home page.

A service of a machine (type « local ») first seen in the last WINDOW_DAYS days (watcher event « nouveau ») is proposed until an
admin decides. Follow = keep it as it is, the choice is only remembered (state_dir/services-decided.json). Don't follow = the
existing « pause » of services-meta.json, written under « ip:port »: no probe, no alert, still listed in Services as paused, and
resumed from its detail. A container name is not used as the key: the same name can run on two machines.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import time
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


def pending(data: dict, events: list[dict], state_dir: str | Path) -> list[dict]:
    """Services to propose, newest first. events: the « nouveau » events of the window (history.query)."""
    rows = {_key(r): r for r in data.get("hosts") or [] if r.get("type") == "local"}
    decided, out, seen = _decided(state_dir), [], set()
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
