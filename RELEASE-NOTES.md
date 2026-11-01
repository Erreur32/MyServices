# Release notes: MyServices 0.34.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.34.1** (1 November 2026) fixes a false alert on Docker ports and makes reinstalling an agent easier.

## For everyone

**What's new?**
- **False port alert fixed**: on a machine with a root agent, ports published by Docker, such as 80 and 443 of Nginx Proxy Manager, could show as down although they answered.
- **New agent command**: the boxes are ticked from what the agent already reads, with its NPM path and backup folders, so nothing is lost when you reinstall it.
- **Plain http for an agent outside your network**: a box adds `MSV_ALLOW_HTTP=1` to the command, off by default, with the warning kept.
- **Connectors**: switching one on, or saving it, shows its tested state on its card at once.
- **README**: the project's rule is written down: local data only, no cloud, no subscription, no telemetry.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.34.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: Linux agent version 8, updated automatically. It sends the names of its install options, never a secret.
- **Port pulse**: a silent port is judged from the agent only when the agent shows it listening; otherwise the collection decides.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
