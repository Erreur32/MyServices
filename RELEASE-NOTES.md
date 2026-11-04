# Release notes: MyServices 0.38.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.1** (4 November 2026) fixes a Windows agent shown as Linux on its machine's page.

## For everyone

**Fixed**
- **Windows agent shown as Linux**: a Windows PC whose settings had no system set (only its icon), and that the collector could not identify by itself, opened its agent block, the « Installer un agent » choice and a renewed key as Linux, with the Linux options. The machine's page now takes the type of its last known agent (the active one, else the newest revoked), so a Windows agent stays Windows, even right after it is deleted to be redone.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change.
- **Server**: no change. Only `front/src/tabs/MachinesSettings.tsx`: the Windows guess of a machine's page also reads the kind of its last known agent.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
