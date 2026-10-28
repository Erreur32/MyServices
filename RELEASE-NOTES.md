# Release notes: MyServices 0.27.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.27.0** (28 October 2026) brings the Windows agent into the add-machine wizard, lets you import your own icons and shows the right logo for a Freebox or UniFi gear.

## For everyone

**What's new?**
- **Windows machines**: the add-machine assistant now has 3 steps, recognises a Windows PC or server (and a virtual one) by itself and creates the agent right away.
- **Your own icons**: import a PNG, JPEG, WebP, GIF or SVG in the icon picker, under *My icons*.
- **Freebox and UniFi**: the System column shows their photo or logo.
- **Header bell**: the optional suggestions are on two lines, each opening the right page.
- **Fewer false alarms**: no more Windows UPnP / WSD ports reported unreachable, and no Docker fault on a machine nothing reads Docker on.
- **A removed machine** disappears from the pages at once.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.27.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: new routes `GET/POST /api/v1/icons` and `GET/DELETE /api/v1/icons/<key>`; imported icons are kept in the state folder (`icons/`).
- **Migration**: nothing required from 0.26.2, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
