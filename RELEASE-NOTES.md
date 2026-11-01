# Release notes: MyServices 0.34.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.34.2** (1 November 2026) shows what each agent reads, and fixes the new command of the Agents page.

## For everyone

**What's new?**
- **Options column on the Agents page**: every box of a Linux agent's install, ticked or not, so you can tell whether a new command is needed without creating one. The same list is on the machine's Access page.
- **New command fixed**: on the Agents page, the frame with the boxes and the command closed by itself once the token had changed, and the new token was lost. It now stays open.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.34.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 8. The column fills once an agent runs it.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
