# Release notes: MyServices 0.31.9

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.9** (31 October 2026) makes the pages easier to read: **Machines** and **Connectors** are rebuilt, **Services** shows one card per service and counts them the same way everywhere, and **Untracked devices** becomes one list with a « Hide » button.

## For everyone

**What's new?**
- **Untracked devices**: one list instead of two, each device once with who saw it, filters, and « Hide » for what you do not want to follow. « Bring back » returns it.
- **Tapo**: a device refused by the account is listed all the same, with its model, and a camera without a recorder can show its picture with a camera account, set per camera. The C310 works this way too.
- **Machines**: stop following a machine, or follow it again, from its line or its page.

**What's changed?**
- **Services**: one card per service, with all its machines and ports. The tiles, the curves, the home page and the MCP count one service per machine, in its worst state. The curves step down once at the update: earlier points counted each port.
- **Machines**: the machine page sits on three columns, always the same subjects at the same place, with compact cards and the identity first.
- **Connectors**: cards of the same height, a trouble on one line with what it means and what to check first. The open card puts the fields on the left, what the connector reads, troubles and help on the right.
- **Connectors**: the reading time is a real field in minutes, a checkbox sits before its label, and « Verify HTTPS certificate » starts unchecked on a new connector and only shows for an https address. Connectors already saved keep their setting.

**What's fixed?**
- **Collection**: a wrong connector setting no longer stops the whole collection. That instance is skipped and reported, the others keep working.
- **Glances**: a plugin that this Glances does not have is no longer called, which ends the HTTP 400 seen in Settings › Requests.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.9` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: a new `services.up` curve; `/services/history` keeps the older points as they were. A new optional Tapo field, `camera_accounts`, encrypted like the other secrets.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.8, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
