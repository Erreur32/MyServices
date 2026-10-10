"""Alertes Telegram (bot) et vérification des canaux d'alerte, Discord compris, sans rien publier.

Telegram : config.json « telegram_token » (jeton de @BotFather, secret) et « telegram_chat_id » (salon,
groupe ou personne qui reçoit). Les deux vides = pas d'envoi. Discord reste envoyé par watcher.py et health.py.
API vérifiées le 2026-10-09 : Telegram Bot API 10.3, Discord « Get Webhook with Token ».
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from config import CFG

USER_AGENT = "myservices"
TG_MAX = 4096  # longueur maximale d'un message Telegram


def _call(url: str, payload: dict | None = None, timeout: int = 10) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def why(e: Exception) -> str:
    """Motif lisible : description renvoyée par Telegram / Discord, sinon code HTTP ou erreur réseau."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            body = json.loads(e.read() or b"{}")
        except ValueError:
            body = {}
        return f"HTTP {e.code}" + (f" : {body.get('description') or body.get('message')}"
                                   if body.get("description") or body.get("message") else "")
    return str(getattr(e, "reason", None) or e)


def _tg(method: str, payload: dict | None = None, token: str = "") -> dict:
    return _call(f"https://api.telegram.org/bot{token or CFG['telegram_token']}/{method}", payload)


def telegram_on() -> bool:
    return bool(CFG["telegram_token"] and CFG["telegram_chat_id"])


def plain(text: str) -> str:
    """Texte Discord -> texte brut Telegram : sans **gras** ni `code` (envoyé sans parse_mode)."""
    return re.sub(r"\*\*|`", "", text)


def send_telegram(text: str) -> tuple[bool, str]:
    if not telegram_on():
        return False, "pas de Telegram (telegram_token / telegram_chat_id vides)"
    try:
        _tg("sendMessage", {"chat_id": CFG["telegram_chat_id"], "text": plain(text)[:TG_MAX],
                            "link_preview_options": {"is_disabled": True}})
        return True, "notification Telegram envoyée"
    except (OSError, ValueError) as e:
        return False, f"échec notification Telegram : {why(e)}"


def telegram_chats(token: str) -> list[tuple[str, str]]:
    """(chat_id, nom) des conversations récentes du bot (getUpdates) : pour setup.py, après un message au bot."""
    out = {}
    for u in _tg("getUpdates", token=token).get("result", []):
        for k in ("message", "channel_post", "my_chat_member"):
            c = (u.get(k) or {}).get("chat")
            if c:
                out[str(c["id"])] = c.get("title") or " ".join(filter(None, (c.get("first_name"), c.get("last_name")))) \
                    or c.get("username") or "?"
    return list(out.items())


def check_discord(url: str) -> tuple[bool, str]:
    """Webhook valide ? GET sur son URL : nom et salon, sans publier."""
    try:
        w = _call(url)
        return True, f"webhook « {w.get('name') or '?'} » (salon {w.get('channel_id') or '?'})"
    except (OSError, ValueError) as e:
        msg = why(e)
        return False, msg + (" : webhook supprimé ou URL fausse" if msg.startswith(("HTTP 401", "HTTP 404")) else "")


def check_telegram() -> tuple[bool, str]:
    """Jeton valide (getMe) et conversation joignable par le bot (getChat), sans publier."""
    try:
        bot = _tg("getMe")["result"]
    except (OSError, ValueError, KeyError) as e:
        return False, f"jeton refusé ou Telegram injoignable ({why(e)})"
    try:
        chat = _tg("getChat", {"chat_id": CFG["telegram_chat_id"]})["result"]
    except (OSError, ValueError, KeyError) as e:
        return False, (f"bot @{bot.get('username')} : conversation {CFG['telegram_chat_id']} inaccessible ({why(e)}). "
                       "Écrire d'abord au bot (ou l'ajouter au groupe)")
    name = chat.get("title") or chat.get("first_name") or chat.get("username") or chat["id"]
    return True, f"bot @{bot.get('username')} → {name}"
