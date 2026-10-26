# Release notes: MyServices 0.24.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.24.2** (26 October 2026) stops a service from showing red when its Docker container is stopped on purpose.

## For everyone

**What's new?**
- **Services stopped on purpose are grey, not red**: a service whose container never started, was stopped cleanly, or is listed in the machine's **Options › Containers stopped on purpose** now reads « stopped on purpose ». It is not probed, is not a point to fix and sends no alert. It goes back to normal by itself when the container runs again. A container that crashes (exit code 1, not listed) stays red. The « stop following » button stays for services that are not in Docker.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.24.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Services**: the Docker rule of the health reading now lives in `docker_state.py` and is shared with the services collection; a service row carries `stopped` (the container's Docker status), is not probed and is left out of the machine's `down` count. The watcher and the availability history file it with `paused` / `machine_off` (« off »).
- **Migration**: nothing required from 0.24.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
