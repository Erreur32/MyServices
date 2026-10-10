"""Canaux d'alerte : Discord (webhook) et Telegram (bot). test() vérifie sans rien publier (notify.py).

L'envoi reste fait par watcher.py et health.py (notify.py) ; ces connecteurs servent à la vérification
(--check), à la page Réglages et au registre commun.
"""
from __future__ import annotations

import notify
from connectors.base import Connector, Field, Result


class Discord(Connector):
    type = "discord"
    label = "Discord"
    kinds = ("alerts",)
    fields = (
        Field("webhook", "URL du webhook", "password", required=True, secret=True,
              help="Salon → Intégrations → Webhooks → Copier l'URL"),
        Field("scope", "Alertes envoyées", "choice", default="all", choices=("all", "watcher", "health")),
    )

    def test(self) -> Result:
        good, msg = notify.check_discord(self.conf["webhook"])
        return Result(good, msg)

    def collect(self) -> dict:
        return {}


class Telegram(Connector):
    type = "telegram"
    label = "Telegram"
    kinds = ("alerts",)
    fields = (
        Field("token", "Jeton du bot (@BotFather)", "password", required=True, secret=True),
        Field("chat_id", "Conversation (chat_id)", required=True),
    )

    def test(self) -> Result:
        saved = {k: notify.CFG[k] for k in ("telegram_token", "telegram_chat_id")}
        notify.CFG.update(telegram_token=self.conf["token"], telegram_chat_id=self.conf["chat_id"])
        try:
            good, msg = notify.check_telegram()
        finally:
            notify.CFG.update(saved)
        return Result(good, msg)

    def collect(self) -> dict:
        return {}
