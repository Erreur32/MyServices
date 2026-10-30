# Release notes: MyServices 0.31.6

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.6** (30 October 2026) lets the **Windows Admin Center** connector sign in to recent gateways, and makes **Tapo** clearer about refused devices.

## For everyone

**What's new?**
- **Windows Admin Center: recent gateways.** The versions with a login page (port 20443 by default) are now signed in the way that page does it. Older gateways keep the Windows sign-in, and the connector picks by itself: there is nothing to choose.
- **Not fully tried yet.** The first steps of the sign-in were checked on a real gateway; the complete sign-in with an account still has to be. Tell us what the test of the connector shows.

**What's fixed?**
- **Tapo**: a refused device now says why, with a reminder about the camera account, and the address of a device is shown as its IP alone.
- **Windows Admin Center**: the guide names the right access rule (the local Users group, or WAC Settings, Access).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.6` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change. No new dependency: the login page sign-in uses `cryptography`, already in the image.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.5, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
