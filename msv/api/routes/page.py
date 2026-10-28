"""API routes: page."""
from __future__ import annotations

import mimetypes
import re
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from msv.api import server as core
from msv.api.common import deny, find

router = APIRouter()

# Files Vite names after their content (assets/index-BmiUWhOT.js): a new build is a new name, so a browser may keep them for good
HASHED_ASSET = re.compile(r"^assets/[\w.-]+-[\w-]{8}\.(?:js|css|woff2?|png|jpe?g|svg|webp)$")
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache, must-revalidate"


def not_found() -> HTMLResponse:
    return HTMLResponse('<!doctype html><meta charset="utf-8"><title>MyServices</title>'
                        '<p style="font:16px system-ui;padding:2em">Page introuvable. <a href="/">Retour à MyServices</a></p>', status_code=404)


@router.get("/{rel:path}", include_in_schema=False)
def files(rel: str, request: Request):
    if rel in ("v2", "v2/") or rel.startswith("v2/"):   # the front used to live under /v2/: it is the root now
        return RedirectResponse("/" + quote(rel[3:].lstrip("/")), status_code=302)
    if rel.startswith(("api/", "mcp", "agent/")):        # unknown API route: JSON, not the HTML « page not found »
        return deny(404, "introuvable")
    if rel in ("", "index.html"):                        # the React front (an old index.html left in the volume must not shadow it)
        f = core.STATIC / "v2" / "index.html"
        f = f if f.is_file() else None
    else:
        if rel.endswith("/"):
            rel += "index.html"
        f = find(rel)
        if f is None and find(rel + "/index.html"):      # folder typed without the final « / »
            return RedirectResponse("/" + quote(rel.strip("/")) + "/", status_code=302)   # NOSONAR S5146 ; always on this site, never another one
    if f is None:
        return not_found()
    ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/json", "application/javascript", "image/svg+xml"):
        ctype += "; charset=utf-8"
    hashed = HASHED_ASSET.match(rel) and f.is_relative_to((core.STATIC / "v2").resolve())   # only the compiled front, never a file of the volume
    resp = FileResponse(f, media_type=ctype, headers={"Cache-Control": IMMUTABLE if hashed else REVALIDATE})
    resp.set_stat_headers(f.stat())  # l'ETag n'est posé qu'à l'envoi : on le veut avant, pour comparer
    tags = {t.strip().removeprefix("W/") for t in request.headers.get("if-none-match", "").split(",")}
    if resp.headers.get("etag") in tags:  # inchangé depuis la dernière lecture : pas de corps (data.json pèse ~200 Ko)
        return Response(status_code=304, headers={k: v for k, v in resp.headers.items() if k in ("etag", "cache-control", "last-modified")})
    return resp
