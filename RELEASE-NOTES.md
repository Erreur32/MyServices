# Release notes: MyServices 0.34.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.34.3** (1 November 2026) makes a new agent command easier: automatic update stays on, new rights show at once, and revoked agents are quicker to clean up.

## For everyone

**What's new?**
- **New command keeps automatic update**: the new agent takes the choice of the old one, which used to be switched off each time.
- **New rights show on the first report**: a reinstall clears what the agent had kept in cache, instead of showing the old rights for up to 6 hours.
- **Revoked agents**: the « New agent » button is gone from their card, and deleting one no longer asks for confirmation, since its token already stopped working.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.34.3` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 8. An agent switched to manual by an earlier new command stays on manual until you switch it back on.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
