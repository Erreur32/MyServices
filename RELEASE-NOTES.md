# Release notes: MyServices 0.23.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.23.0** (26 October 2026) lets an AI assistant understand and set up your machines through the MCP, and tells you why a machine is not « ok ».

## For everyone

**What's new?**
- **MCP, a tool to set up your machines** (`machines_config`, for admins): list the machines, add or change one, remove it, check it, re-read a single machine, and set the automatic network search, from an AI assistant. Like the other configuration tools it is **off** until you switch it on in Settings › API and MCP, and every change is in the audit log.
- **MCP, why a machine is not « ok »**: the health answer now lists the controls in warn or critical, and the machine list names the services in trouble of each machine instead of a bare count.
- **A health connector that stops answering is now shown**: Beszel is read by the health task, whose state was dropped, so a Beszel that no longer answered appeared nowhere. It is now listed with the other connectors.
- **Machines › SSH connections**: the agent of a machine that reports is a link to its page. On a machine page, « N down » has a tooltip naming the services.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.23.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **MCP**: new admin tool `machines_config` (actions `list`, `save`, `delete`, `check`, `refresh`, `network_get`, `network_set`, each a route of the Settings pages); `get_health` adds `checks` per machine, `list_machines` adds `problems` and counts running containers, `status` adds the health connectors.
- **`stats.json`**: a new `connectors` key with the state of the connectors read by the health task.
- **Migration**: nothing required from 0.22.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
