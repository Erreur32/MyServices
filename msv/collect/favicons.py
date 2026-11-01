"""Favicons of the proxied services, read on the service itself and kept in the cache for the interface.

Nothing goes out to a third party: a public icon service would learn every private domain. Only the address the
proxy forwards to is ever contacted: a link or a redirect gives a path on it, and anything pointing elsewhere is dropped.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path

MAX_ICON = 256 * 1024   # the largest seen on a real install is 176 KB
MAX_PAGE = 65536
MAX_HOPS = 3
MAX_LINKS = 5
WORKERS = 6
WEEK = 7 * 86400
INDEX = "index.json"
MEDIA = {"png": "image/png", "ico": "image/x-icon", "gif": "image/gif", "jpg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml"}
SVG_START = (b"<svg", b"<?xml", b"<!--", b"<!doctype svg")


class _Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.icons: list[tuple[bool, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = dict(attrs)
        rel = (a.get("rel") or "").lower().split()
        if a.get("href") and ("icon" in rel or "apple-touch-icon" in rel):
            self.icons.append(("icon" not in rel, a["href"].strip()))


def icon_links(page: bytes) -> list[str]:
    """The icons a page declares, plain icons first: a touch icon often has an opaque background"""
    p = _Links()
    p.feed(page.decode("utf-8", "replace"))
    return [href for _, href in sorted(p.icons, key=lambda i: i[0])][:MAX_LINKS]


def kind_of(data: bytes) -> str | None:
    """The real type of a file, from its first bytes: what the server declares is not trusted"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\0\0\1\0"):
        return "ico"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    head = data[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    return "svg" if head.startswith(SVG_START) and b"<svg" in head else None


def path_of(link: str, page_url: str, host: str) -> str | None:
    """The path a link gives on this service, None when it points anywhere else"""
    try:
        u = urllib.parse.urlsplit(urllib.parse.urljoin(page_url, link))
        same = u.scheme in ("http", "https") and u.hostname in (urllib.parse.urlsplit(page_url).hostname, host.lower())
    except ValueError:
        return None
    return urllib.parse.urlunsplit(("", "", u.path or "/", u.query, "")) if same else None


def _inline(link: str) -> bytes | None:
    head, _, payload = link.partition(",")
    try:
        return base64.b64decode(payload) if head.endswith(";base64") else urllib.parse.unquote_to_bytes(payload)
    except ValueError:
        return None


def _read(opener, url: str, host: str, limit: int, timeout: float):
    req = urllib.request.Request(url, headers={"User-Agent": "myservices-probe", "Accept": "*/*", "Host": host})
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.headers, r.read(limit + 1)
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read(limit + 1) if e.fp else b""
    except (http.client.HTTPException, OSError, ValueError):
        return 0, {}, b""


def _page(opener, root: str, host: str, timeout: float) -> tuple[str, bytes]:
    """The home page, whose icons a login page behind a redirect usually declares too"""
    path = "/"
    for _ in range(MAX_HOPS):
        status, headers, body = _read(opener, root + path, host, MAX_PAGE, timeout)
        location = headers.get("Location") if 300 <= status < 400 else None
        if not location:
            return path, body
        path = path_of(location, root + path, host)
        if path is None:
            break
    return "/", b""


def fetch(opener, scheme: str, ip: str, port: int, host: str, timeout: float) -> bytes | None:
    """The first icon of the service that is really an image of a sane size"""
    root = f"{scheme}://{ip}:{port}"
    path, page = _page(opener, root, host, timeout)
    for link in (*icon_links(page), "/favicon.ico"):
        if link.startswith("data:"):
            data = _inline(link)
        else:
            target = path_of(link, root + path, host)
            status, _, data = _read(opener, root + target, host, MAX_ICON, timeout) if target else (0, {}, b"")
            data = data if status == 200 else None
        if data and len(data) <= MAX_ICON and kind_of(data):
            return data
    return None


def _write(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _load(folder: Path) -> dict:
    try:
        index = json.loads((folder / INDEX).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return index if isinstance(index, dict) else {}


def refresh(rows: list[dict], folder: Path, opener, timeout: float) -> None:
    """Sets `favicon` on each row with a domain; a service is read again once a week, and keeps its icon if that read fails"""
    now = time.time()
    folder.mkdir(parents=True, exist_ok=True)
    index = _load(folder)
    wanted = {r["domains"][0]: r for r in rows if r.get("domains")}
    due = {d: r for d, r in wanted.items()
           if r.get("web") == "ui" and r.get("web_scheme") and now - index.get(d, {}).get("at", 0) >= WEEK}
    with ThreadPoolExecutor(WORKERS) as ex:
        found = list(ex.map(lambda i: fetch(opener, i[1]["web_scheme"], i[1]["ip"], i[1]["port"], i[0], timeout), due.items()))
    for domain, data in zip(due, found):
        name = index.get(domain, {}).get("file")
        if data:
            name = f"{hashlib.sha256(data).hexdigest()[:32]}.{kind_of(data)}"   # services sharing an icon share one file
            _write(folder / name, data)
        index[domain] = {"file": name, "at": now}
    index = {d: e for d, e in index.items() if d in wanted}
    kept = {e.get("file") for e in index.values()} | {INDEX}
    for p in folder.iterdir():
        if p.name not in kept:
            p.unlink(missing_ok=True)
    _write(folder / INDEX, json.dumps(index).encode())
    for domain, r in wanted.items():
        if file := index.get(domain, {}).get("file"):
            r["favicon"] = file
