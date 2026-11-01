# Release notes: MyServices 0.33.6

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.6** (1 November 2026) gives your services their own icons, and makes the History events easier to sort.

## For everyone

**What's new?**
- **Service icons**: a proxied service without a known logo now shows the favicon of its own site, in the Services list, on its card and in « What changed since yesterday ». A service with no icon gets a coloured letter.
- **Private by design**: icons are read directly on your services, once a week. No third-party service is involved, so your private domain names stay on your network.
- **Service cards**: the link is shown in full, with its icon.
- **History, direct filters**: show only Docker updates, machine updates, services, or services that are new or gone.
- **Machine updates in History**: a machine that gets pending system updates is now recorded. You can pick this event in your alert rules; nothing is sent by default.
- **Clearer chips**: « Hide » becomes « Also show »: a lit chip always means its events are shown. Fail2ban threats stay off by default.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.6` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Migration**: nothing required from 0.33.5, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
