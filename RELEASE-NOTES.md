# Release notes: MyServices 0.24.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.24.0** (26 October 2026) lets an AI assistant set up the general settings of MyServices through the MCP, and stops a harmless Samba notice from turning a machine to « warn ».

## For everyone

**What's new?**
- **MCP, a tool for the general settings** (`settings_config`, for admins): e-mail sending (read, change, send a test), the schedule of each task, the pulse and the fast connectors, the automatic check for updates, and the alerts (channels with a test message, rules, presets), from an AI assistant. Like the other configuration tools it is **off** until you switch it on in Settings › API and MCP, and every change is in the audit log. The export and import of the configuration, the container log, the app's SSH key, accounts and tokens are left out on purpose.
- **A harmless Samba notice no longer raises a kernel warning**: a Linux machine that mounts a Samba share logs `CIFS: VFS: Autodisabling the use of server inode numbers…`. It is no longer counted as a kernel error, so the machine stops flipping between « ok » and « warn ». The MCP health answer also shows the journal lines behind a kernel warning.
- **Lighter MCP answers**: the configuration tools no longer carry the whole changelog (200 KB) when they read the update settings.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.24.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **MCP**: new admin tool `settings_config` (actions `mail_get/set/test`, `tasks_list`, `task_schedule`, `live_get/set`, `updates_get/check/set`, `alerts_list`, `channel_*`, `rule_*`, `presets_add`, each a route of the Settings pages). The test e-mail of a token goes to the account that created the token. `get_health` adds `kernel_errors`. The `*_config` tools drop the `changelog` key.
- **Health**: `KERNEL_IGNORE_RE` ignores the CIFS inode-number notice.
- **Migration**: nothing required from 0.23.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
