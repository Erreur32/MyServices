# Release notes: MyServices 0.26.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.26.2** (28 October 2026) tidies the menu: the history now lives under Home, and the request pages sit with the application settings.

## For everyone

**What's new?**
- **Home** now holds the history, right under the dashboard: Dashboard, Events, Availability, Statistics. The pages and their addresses are the same, only their place in the menu changes.
- **Requests**, **Audit log** and **Logs** moved from the **Activity** item to **Application** in Settings, next to Updates, E-mail, Export and import, and Information.
- **Development**: the herdr pane « PR et git » now shows the pull request line and the working branch (for people running the dev setup).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.26.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change.
- **Migration**: nothing required from 0.26.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
