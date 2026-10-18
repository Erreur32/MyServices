# Release notes: MyServices 0.16.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.16.1** (18 October 2026): the backup attention points and their settings are linked both ways.

## For everyone

**What's new?**
- **From an attention point to its setting**: in the Backups tab, each attention point about a followed set has a small gear that opens Settings → Backups on that very set, unfolded and framed.
- **From the settings to the attention points**: a followed set listed in the attention points shows a badge with its level (late, critical, unreachable) and the reasons in the tooltip; its source row shows the same badge, and the heading counts the sets to check. Attention points about a machine (full disk, unreachable, Syncthing) stay in the Backups tab, where there is nothing to set.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.16.1` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `backups.json` issues carry `set_id` (followed set) or `host_id` (machine); front `BackupsSettings` takes `issues` from the snapshot, opens `#settings/backups/<set id>` on the set; `IssueBadge` on sets and sources.
