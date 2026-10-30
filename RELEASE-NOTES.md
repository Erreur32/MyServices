# Release notes: MyServices 0.31.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.0** (30 October 2026) rebuilds the Home, Services and Connectors pages, adds a Smart home page with a Netatmo connector, and translates what the connectors say.

## For everyone

**What's new?**
- **Home page.** A sentence tells the state of the network beside the machines to watch first, then the key figures, each one opening its page. Alerts carry a coloured category badge, what to do, and for an administrator a button to the setting that settles it. The Statistics page merged into it (`#stats` still works). A first visit with no machine gets a welcome page.
- **Smart home page.** The state of the house in a sentence, key figures, every sensor room by room, then the shutters and the cameras. A click on a sensor opens its 24-hour curves. It reads Netatmo directly, or through Home Assistant, and adds the room sensors, shutters and heating Home Assistant knows.
- **Netatmo connector.** Read-only, for every product of an account: weather stations, Home Coach, thermostats, cameras, detectors, shutters. Its cameras appear on the Video page.
- **Services page.** One card per real service, gathered by application or by machine, with the domain when there is one, and connectors without a machine shown as Cloud services.
- **Connectors page.** Smaller cards with plain figures, a search box and filters, and everything about a connector (what it reads, its problems, test, settings, delete) behind a click on its card.
- **Cameras page.** Filter by place (indoors, outdoors, other) and a logo per brand or recorder.
- **English.** Connector forms, help guides and what connectors report are now translated.
- **Agents.** The Windows installer checks what it downloaded before writing anything, and an agent back from a silence is read at once.
- **Tautulli.** The connector works again (it asked for a command that does not exist).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: the Netatmo connector keeps its rotating token encrypted beside `config.json` (already a volume). No other change.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). The Windows installer script changed; installed agents keep running as they are.
- **Migration**: nothing required from 0.30.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
