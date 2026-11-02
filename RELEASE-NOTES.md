# Release notes: MyServices 0.35.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.4** (2 November 2026) notices a container updated in place, and tells which boxes to tick for a Linux agent.

## For everyone

**What's new?**
- **Which boxes to tick**: the command of a Linux agent now carries a note above its boxes. When in doubt, tick only sudo. Local DNS and backups only where they exist. borgmatic and Nginx Proxy Manager only on the machine that runs them, otherwise the install stops. Docker and disk health are added by hand (`MSV_DOCKER=1`, `MSV_SMART=1`).
- **Automatic update has a limit**: it replaces only the agent's script. A box added or removed (sudo, DNS, backups…) needs a new command, run again on the machine.
- **Agent health in words**: the Health column of the Agents page says « Good », or names the problem (reports late, script out of date, host to confirm) instead of a bar.
- **Root or sudo**: the command says where to paste it, as root or from an account with sudo. It goes through sudo either way, so the sudo package is needed even as root.

**Fixed**
- **A container updated in place is read again**: after `docker compose pull` then `up -d`, the container keeps its name but starts anew. MyServices now notices it at the next collection, instead of showing the old image and version for up to 2 hours.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.4` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the Docker inventory of a machine is read again when one of its containers started after it.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
