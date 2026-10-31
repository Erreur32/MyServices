# Release notes: MyServices 0.33.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.3** (1 November 2026) makes the Agents page calmer: a mark now means there is something to do.

## For everyone

**What's new?**
- **Agents page**: a warning mark appears beside an agent only when something is to be done: it cannot read Docker or the owners of its ports, and its machine has no SSH to read them instead. What an update brings is in the tooltip of its arrow.
- **Late agents**: the button that updates them pulses while agents are waiting, and goes away once the update is asked.
- **Confirmations**: they show for a few seconds in the header, so nothing moves in the page. An error stays next to its agent.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.3` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Migration**: nothing required from 0.33.2, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
