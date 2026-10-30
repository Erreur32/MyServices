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

MAX_BYTES = 512 * 1024
SERVE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
_RASTER = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"GIF87a", "image/gif"), (b"GIF89a", "image/gif"))
_SVG_TAGS = {"svg", "g", "defs", "title", "desc", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
             "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "image",
             "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feMerge", "feMergeNode", "feFlood", "feComposite",
             "feDropShadow", "metadata", "style", "switch", "marker", "namedview", "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feFuncA",
             "feTurbulence", "feMorphology", "feTile", "feConvolveMatrix", "feDiffuseLighting", "feSpecularLighting", "feDistantLight", "fePointLight",
             "feSpotLight", "feDisplacementMap"}
_OUTSIDE_CSS = re.compile(r"@import|url\s*\(\s*['\"]?(?!#)|expression\s*\(", re.I)
_OUTSIDE_VALUE = re.compile(r"javascript:|url\s*\(\s*['\"]?(?!#)", re.I)
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
    if head.startswith((b"<svg", b"<?xml", b"<!--", b"<!doctype")):
        _check_svg(raw)
        return "image/svg+xml"
    raise AvatarError("format non reconnu : PNG, JPEG, WebP, GIF ou SVG")


def _strip_plain_doctype(raw: bytes) -> bytes:
    """The plain DOCTYPE editors write (Illustrator, Inkscape) is dropped; one with an internal subset (« [ ») stays and is refused.
    A linear search: a regex here is slow on a file made of many « <!doctype »."""
    start = raw.lower().find(b"<!doctype")
    end = raw.find(b">", start) if start >= 0 else -1
    if end < 0 or b"[" in raw[start:end]:
        return raw
    return raw[:start] + raw[end + 1:]


def _check_svg(raw: bytes) -> None:
    from defusedxml import DefusedXmlException
    from defusedxml.ElementTree import ParseError, fromstring
    try:
        root = fromstring(_strip_plain_doctype(raw), forbid_dtd=True, forbid_entities=True, forbid_external=True)   # no DTD, entity or outside file
    except DefusedXmlException:
        raise AvatarError("SVG refusé : DOCTYPE ou entité") from None
    except ParseError:
        raise AvatarError("SVG illisible") from None
    if _local(root.tag) != "svg":
        raise AvatarError("SVG attendu")
    todo = [root]
    while todo:   # a metadata block (editors fill it with RDF) is inert and not looked into
        el = todo.pop()
        _check_element(el)
        if _local(el.tag) != "metadata":
            todo.extend(el)


def _check_element(el) -> None:
    tag = _local(el.tag)
    if tag not in _SVG_TAGS:
        raise AvatarError(f"SVG refusé : élément « {tag} » non permis")
    if tag == "style" and _OUTSIDE_CSS.search(el.text or ""):
        raise AvatarError("SVG refusé : style qui charge autre chose")
    for name, value in el.attrib.items():
        _check_attribute(_local(name).lower(), (value or "").strip())


def _check_attribute(name: str, value: str) -> None:
    if name.startswith("on"):
        raise AvatarError("SVG refusé : script dans un attribut")
    if name == "href" and not (value.startswith("#") or _SAFE_DATA.match(value)):
        raise AvatarError("SVG refusé : lien vers l'extérieur")
    if _OUTSIDE_VALUE.search(value):
        raise AvatarError("SVG refusé : lien vers l'extérieur")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def version(raw: bytes | None) -> str | None:
    """Short fingerprint put in the image address: a new avatar is not taken from the browser cache."""
    return hashlib.sha256(raw).hexdigest()[:12] if raw else None
