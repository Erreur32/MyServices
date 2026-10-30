# Release notes: MyServices 0.30.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.30.1** (30 October 2026) is a small follow-up: the Freebox page gets its own line and fibre frames, and the UniFi view shows the SFP modules of your gear.

## For everyone

**What's new?**
- **Freebox page.** A « Line » frame (state, download and upload against the line's capacity, history over 24 h, 3 days or 7 days) and a « Fibre (SFP) » frame (module, light seen, link, power supply, model, light received and sent, with what the figures mean). The Freebox does not give the temperature of its module.
- **UniFi view.** A « SFP modules » table under the gear cards: temperature, light received and sent, voltage, current and state of each module.
- **Network page.** The « Sources » tile is gone: the sources are the badges of the page title.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.30.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change.
- **Agents**: unchanged (Linux agent 4, Windows agent 9).
- **Migration**: nothing required from 0.30.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
