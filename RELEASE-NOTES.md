# Release notes: MyServices 0.35.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.3** (2 November 2026) tells clearly why no alert leaves, and lines up the blocks of the home page.

## For everyone

**What's new?**
- **Notifications told clearly**: « Pour aller plus loin » says whether the notifications are not set (no channel), switched off (channels set but all off) or without an active rule (a channel ready, nothing sent), each with its own button: add a channel, switch one back on, create a rule.
- **Three blocks on one line**: « Ce qui a changé depuis hier », the tasks card and the last alerts sent end at the same height.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.3` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: no change, front only.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
