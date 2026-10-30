# Release notes: MyServices 0.31.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.2** (30 October 2026) is a small update: an opened Services card marked « To check » now says why, and two things move to a better place.

## For everyone

**What's new?**
- **Fix, Services.** A card marked « To check » used to open onto nothing when the cause was a check on its address (no access list, name not resolving outside the local network, unknown target, not identified). The reasons are now listed in a « To check » block, each with its explanation and the address concerned.
- **Menu.** « AI and agents » now sits right after Domotique.
- **Ignored domains.** The panel of Services > All services moved to the top of the page, just under the tiles. It is still folded by default.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
