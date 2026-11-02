# Release notes: MyServices 0.35.6

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.6** (2 November 2026) lets a Linux agent read Docker from a box of its install command, so the web traffic of Nginx Proxy Manager reaches the Security pages.

## For everyone

**What's new?**
- **« Read Docker » box**: the command of a Linux agent gains a box next to sudo. It puts the agent's account in the docker group, and says next to it that this group gives root rights. With it, the agent reads the containers and the access logs of Nginx Proxy Manager, and the Web traffic page fills for that machine.
- **Kept ticked**: a « New command » for an agent that already reads containers comes back with the box ticked.
- **« To do on this agent »**: the Docker line now stays even when the machine has SSH, since SSH never reads the web traffic, and says which box to tick.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else is required. To get the web traffic of a machine whose agent has its own account, make a new command with « Read Docker » ticked and run it there. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.6` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11. The install script with `MSV_DOCKER=1` now sets `ProtectHome=read-only` instead of hiding `/home`.
- **Server**: no database change.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
