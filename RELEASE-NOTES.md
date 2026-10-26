# Release notes: MyServices 0.24.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.24.1** (26 October 2026) lets you tell MyServices which Docker containers may stay stopped, so a container you stopped on purpose no longer turns its machine to « warn ».

## For everyone

**What's new?**
- **Containers stopped on purpose**: some apps exit with an error code (1, for example) when they are asked to stop, so a container you stopped by hand or with a script was counted as a Docker failure and its machine showed « warn ». On a machine's page, **Options › Containers stopped on purpose**, add the container names: they are filed with the intended stops, without a warning. A container that restarts in a loop is still reported. It applies to Linux machines read over SSH or by an agent, and an AI assistant can set it through the MCP tool `machines_config` (field `stopped_ok`).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.24.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **`services-meta.json`**: a machine can carry `stopped_ok`, a list of container names (30 at most, letters, digits, `_`, `.`, `-`, compared without case). Absent: nothing changes.
- **Health**: `collect_docker` takes the list and files a listed `Exited` container with the stopped ones (`stopped_list`), not in `exited`/`issues`; `Restarting` is never excused.
- **Migration**: nothing required from 0.24.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
