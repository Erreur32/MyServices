"""An ONVIF camera or recorder, read-only: the standard most IP cameras speak (Hikvision, Dahua, Amcrest, Axis, Foscam, Annke, Reolink…).

SOAP 1.2 over HTTP with a WS-Security account (password digest, dated at the camera's own clock: many have none set):
GetSystemDateAndTime (no account), GetDeviceInformation, GetCapabilities (where the media service is), GetProfiles (one camera per video
source: a stream has several profiles), GetSnapshotUri then the picture, with Digest. Every address the camera gives is used on the camera's
own host only, so a camera cannot send MyServices elsewhere. The XML goes through defusedxml (upnp_box.parse_xml)."""
from __future__ import annotations

import base64
import calendar
import hashlib
import os
import time
import urllib.parse
from xml.sax.saxutils import escape

from connectors.base import ConnectorError, Field
from connectors.homelab_stream import MAX_ITEMS, VERIFY, camera, cameras_fact
from connectors.status_kit import StatusConnector, fact
from connectors.upnp_box import local_name, on_host, parse_xml

DEVICE = "/onvif/device_service"
WSDL_DEVICE = "http://www.onvif.org/ver10/device/wsdl"
WSDL_MEDIA = "http://www.onvif.org/ver10/media/wsdl"
WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
WSS_PROFILE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-"
REFUSED = ("HTTP 400", "HTTP 401", "HTTP 403", "accès refusé")   # a camera says a wrong account or clock with a SOAP fault, often a 400


def _all(root, name: str) -> list:
    return [e for e in root.iter() if local_name(e.tag) == name]


def _text(root, name: str) -> str:
    found = _all(root, name) if root is not None else []
    return (found[0].text or "").strip() if found else ""


def security(user: str, password: str, at: float, nonce: bytes | None = None) -> str:
    """The WS-Security header: SHA-1 of nonce, date and password, as the ONVIF standard asks."""
    nonce = nonce or os.urandom(16)
    created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at))
    digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode(), usedforsecurity=False).digest()).decode()   # NOSONAR S4790: WS-Security imposes SHA-1; nothing is stored
    return (f'<s:Header><Security s:mustUnderstand="1" xmlns="{WSSE}"><UsernameToken><Username>{escape(user)}</Username>'
            f'<Password Type="{WSS_PROFILE}username-token-profile-1.0#PasswordDigest">{digest}</Password>'
            f'<Nonce EncodingType="{WSS_PROFILE}soap-message-security-1.0#Base64Binary">{base64.b64encode(nonce).decode()}</Nonce>'
            f'<Created xmlns="{WSU}">{created}</Created></UsernameToken></Security></s:Header>')


class Onvif(StatusConnector):
    """See the module. One profile per video source becomes a camera; the camera's clock is read first, the account is dated at it."""
    type = "onvif"
    label = "ONVIF"
    images = ()
    tested = ()
    fields = (
        Field("url", "Adresse de la caméra", "url", required=True, help="http://<IP>, avec le port ONVIF s'il n'est pas 80 (http://<IP>:8000)"),
        Field("user", "Utilisateur ONVIF", "text", required=True),
        Field("password", "Mot de passe", "password", required=True, secret=True),
        VERIFY,
    )
    setup_fields = ("url",)
    guide = ("Activez ONVIF dans les réglages de la caméra (souvent coupé par défaut) et créez-y un compte ONVIF : un compte « utilisateur » suffit.",
             "MyServices lit le fabricant, le modèle, le firmware, les caméras et l'image du moment, jamais le flux.")
    _offset: float | None = None

    def _on_camera(self, url: str) -> str:
        """An address given by the camera, kept on its host: else its path is asked at the address set here."""
        if on_host(url, urllib.parse.urlsplit(self.base_url()).hostname):
            return url
        parts = urllib.parse.urlsplit(url)
        return self.base_url() + (parts.path or "/") + (f"?{parts.query}" if parts.query else "")

    def _soap(self, url: str, body: str, signed: bool = True):
        head = security(self.conf.get("user") or "", self.conf.get("password") or "", self._clock() + time.time()) if signed else ""   # the camera's clock first: reading it takes time
        envelope = f'<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">{head}<s:Body>{body}</s:Body></s:Envelope>'
        try:
            raw = self.ctx.http(url, method="POST", payload=envelope.encode(), binary=True, verify_tls=self.tls(),
                                headers={"Content-Type": "application/soap+xml; charset=utf-8", "Accept": "application/soap+xml"})
        except ConnectorError as e:
            if signed and str(e).startswith(REFUSED):
                raise ConnectorError("accès refusé : compte ONVIF à vérifier (ou ONVIF coupé sur la caméra)") from None
            raise
        return parse_xml(raw)

    def _clock(self) -> float:
        """How far the camera's clock is from ours: the account is dated at the camera's time, or a camera without the right time refuses it."""
        if self._offset is None:
            self._offset = 0.0
            utc = _all(self._soap(self.base_url() + DEVICE, f'<GetSystemDateAndTime xmlns="{WSDL_DEVICE}"/>', signed=False), "UTCDateTime")
            try:
                parts = [int(_text(utc[0], k)) for k in ("Year", "Month", "Day", "Hour", "Minute", "Second")]
                self._offset = calendar.timegm((*parts, 0, 0, 0)) - time.time()
            except (IndexError, ValueError):
                pass   # no date said: our own clock is used
        return self._offset

    def _media(self) -> str:
        caps = self._soap(self.base_url() + DEVICE, f'<GetCapabilities xmlns="{WSDL_DEVICE}"><Category>All</Category></GetCapabilities>')
        media = next(iter(_all(caps, "Media")), None)
        return self._on_camera(_text(media, "XAddr") or self.base_url() + DEVICE)

    def _profiles(self, media: str, model: str) -> list[dict]:
        """One camera per video source, named by its source, or by the model when it is alone."""
        by_source: dict[str, dict] = {}
        for p in _all(self._soap(media, f'<GetProfiles xmlns="{WSDL_MEDIA}"/>'), "Profiles"):
            source = _text(p, "SourceToken") or p.get("token") or ""
            by_source.setdefault(source, {"token": p.get("token") or "", "name": _text(p, "Name")})
        cams = list(by_source.values())[:MAX_ITEMS]
        for i, c in enumerate(cams):
            c["name"] = (model or "Caméra") if len(cams) == 1 else f"Caméra {i + 1}"
        return [c for c in cams if c["token"]]

    def _device(self) -> tuple[dict, str]:
        info = self._soap(self.base_url() + DEVICE, f'<GetDeviceInformation xmlns="{WSDL_DEVICE}"/>')
        got = {k: _text(info, k) for k in ("Manufacturer", "Model", "FirmwareVersion")}
        return got, f'{got["Manufacturer"]} {got["Model"]}'.strip()

    def collect(self) -> dict:
        info, model = self._device()
        cams = self._profiles(self._media(), model)
        rows = [camera(c["name"], up=True if len(cams) == 1 else None) for c in cams]
        head, problems = cameras_fact(rows)
        out = self.out(info["FirmwareVersion"], [fact("Modèle", model or "?"), head], problems)
        out["stream"] = {"role": "nvr", "engine": info["Manufacturer"] or "ONVIF", "cameras": rows, "snapshot": True}
        return out

    def snapshot(self, cam: str) -> bytes:
        media = self._media()
        cams = self._profiles(media, "")
        token = cams[0]["token"] if len(cams) == 1 else next((c["token"] for c in cams if c["name"] == cam), None)   # alone, it is named by its model
        if not token:
            raise ConnectorError("caméra inconnue")
        answer = self._soap(media, f'<GetSnapshotUri xmlns="{WSDL_MEDIA}"><ProfileToken>{escape(token)}</ProfileToken></GetSnapshotUri>')
        uri = _text(answer, "Uri")
        if not uri:
            raise ConnectorError("la caméra ne donne pas d'image par ONVIF")
        # shortcut: Digest only, as ONVIF asks; a camera that wants Basic answers 401 here, add Basic when one shows up
        return self.ctx.http(self._on_camera(uri), binary=True, verify_tls=self.tls(), digest=(self.conf.get("user") or "", self.conf.get("password") or ""))
