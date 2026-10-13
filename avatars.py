"""Account avatars (Profile): PNG, JPEG, WebP, GIF or SVG, 512 KB at most, kept in the accounts database.

Raster images are recognised by their first bytes, never by the name or the type the browser says. An SVG can carry script,
so it is only kept when it is plain drawing: no DOCTYPE or entity, no script, foreignObject, iframe, animation of an href, no
on* attribute, links only inside the file (#id) or to an embedded image (data:image/png|jpeg|webp|gif). It is also served with
a sandbox policy, so even opened on its own it runs nothing.
"""
from __future__ import annotations

import base64
import hashlib
import re
import xml.etree.ElementTree as ET

MAX_BYTES = 512 * 1024
SERVE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
_RASTER = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"GIF87a", "image/gif"), (b"GIF89a", "image/gif"))
_SVG_TAGS = {"svg", "g", "defs", "title", "desc", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
             "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "image",
             "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feMerge", "feMergeNode", "feFlood", "feComposite",
             "feDropShadow", "metadata", "style"}
_SAFE_DATA = re.compile(r"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$")


class AvatarError(Exception):
    pass


def from_data_url(data_url: str) -> tuple[bytes, str]:
    """(bytes, MIME type) of an image sent as « data:<type>;base64,… », checked."""
    m = re.match(r"^data:([\w/+.-]+);base64,(.*)$", data_url or "", re.S)
    if not m:
        raise AvatarError("image attendue (PNG, JPEG, WebP, GIF ou SVG)")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except ValueError:
        raise AvatarError("image illisible") from None
    return raw, check(raw)


def check(raw: bytes) -> str:
    """MIME type of an accepted avatar, read from its content; AvatarError otherwise."""
    if not raw:
        raise AvatarError("image vide")
    if len(raw) > MAX_BYTES:
        raise AvatarError(f"image trop lourde : {MAX_BYTES // 1024} Ko au plus")
    for magic, mime in _RASTER:
        if raw.startswith(magic):
            return mime
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    head = raw[:512].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if head.startswith((b"<svg", b"<?xml")):
        _check_svg(raw)
        return "image/svg+xml"
    raise AvatarError("format non reconnu : PNG, JPEG, WebP, GIF ou SVG")


def _check_svg(raw: bytes) -> None:
    text = raw.decode("utf-8", "replace")
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
        raise AvatarError("SVG refusé : DOCTYPE ou entité")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise AvatarError("SVG illisible") from None
    if _local(root.tag) != "svg":
        raise AvatarError("SVG attendu")
    for el in root.iter():
        tag = _local(el.tag)
        if tag not in _SVG_TAGS:
            raise AvatarError(f"SVG refusé : élément « {tag} » non permis")
        if tag == "style" and re.search(r"@import|url\s*\(\s*['\"]?(?!#)|expression\s*\(", el.text or "", re.I):
            raise AvatarError("SVG refusé : style qui charge autre chose")
        for name, value in el.attrib.items():
            n, v = _local(name).lower(), (value or "").strip()
            if n.startswith("on"):
                raise AvatarError("SVG refusé : script dans un attribut")
            if n == "href" and not (v.startswith("#") or _SAFE_DATA.match(v)):
                raise AvatarError("SVG refusé : lien vers l'extérieur")
            if re.search(r"javascript:|url\s*\(\s*['\"]?(?!#)", v, re.I):
                raise AvatarError("SVG refusé : lien vers l'extérieur")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def version(raw: bytes | None) -> str | None:
    """Short fingerprint put in the image address: a new avatar is not taken from the browser cache."""
    return hashlib.sha256(raw).hexdigest()[:12] if raw else None
