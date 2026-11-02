# Release notes: MyServices 0.35.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.2** (2 November 2026) puts the home page in a logical order, shows the last alerts sent, and gives the alert rules a single way to start.

## For everyone

**What's new?**
- **Last alerts sent on the home page** (administrator): the 5 last sends with the logo of their channel (Discord, Telegram, webhook), date, time and reason, a failed send in red with its cause, and a link to the whole list.
- **Home in a logical order**: right under « À traiter maintenant » come « Pour aller plus loin » and the discoveries to follow, so a new installation sees first what is left to plug in. Both disappear once there is nothing to propose. « Ton installation » closes the page.
- **One way to add an alert rule**: « New rule » starts from an empty rule or from a ready model, which ticks its events; read them, then Add. The Presets button is gone.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: no change, front only.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
