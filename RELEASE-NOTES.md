# Release notes: MyServices 0.21.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.21.0** (24 October 2026): a tidier menu, alerts as a filter of each page, the SSH key with its connections, an AI assistant that can set MyServices up, three more themes and update notices in the header.

## For everyone

**What's new?**
- **A tidier side menu**: « At a glance » first, a new « Activity » entry (requests, audit log, logs), Notifications under Administration, the backup settings pages flat like everywhere else. Old addresses still work.
- **Alerts, a filter of the page**: the « To watch » pages are gone. The dot of a menu entry opens its page on an « Alerts » chip (Backups › Sets, DNS › Details, Services › All services, Network › Devices and equipment) and its tooltip lists the alerts. Security keeps one « Overview » page.
- **Services**: a crossed eye on each row hides a known alert, or stops following a service for good; a hidden service no longer counts anywhere (tiles, machine headers, home page, statistics, the Apache chip of the machine list). The search and filters sit on one line.
- **Backups**: the Sets page has a search, a machine filter and groups by machine. A set's page edits everything: retention, note, how the copies are compared, and for the source and each copy the machine, folder, files, depth, way and encryption.
- **Discovery, each part with its subject**: the machines found are in Machines › Devices not followed, the apps recognised in Connectors › Found, to link (sortable, by machine first), the mode and the other suggestions in Application › Automatic discovery.
- **Machines › SSH connections** now holds the app's key: a band on top (type, fingerprint, show, copy the command), the machines refusing the key, and a « Key » column telling which key each machine signs in with. The logs give the key by its fingerprint only.
- **Configure MyServices from an AI assistant**: four new MCP tools for connectors, backups, agents and a validation of every connector. They are **off** until you switch them on, need an admin MCP token, and each answers `help` with its actions. Every change goes through the same checks as the Settings page and is in the audit log.
- **Updates in the header**: « Check now » shows its result in the middle of the header, with an animated orb, and the new version's pill shows at once. A release found by the automatic check is announced once. A switch in Settings › Updates turns these notices off for your browser.
- **Themes**: One Dark, Nord and Dracula join the dark themes; the profile shows each theme as a small preview in its own colours. The account menu now switches the language (the theme is chosen in the profile).
- **Also**: the Profile and Help pages take the site's layout (Help is up to date: agent first, current menu names, MCP); Logs let you choose how many lines to show (200 to all, 10,000 kept); Export and import open their cards.
- **Fixes**: Activity › Requests opened the audit log instead of the requests; a map not regenerated now logs Archify's real error instead of a cut piece of its answer.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file or your settings.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.21.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Security change**: an admin token (API or MCP) can now manage the agents and every backup setting (the agents needed a browser session before). Accounts, tokens, showing a saved secret, installing `npm-api.sh` and the config import stay closed to tokens.
- **MCP**: `connectors_config`, `backups_config`, `agents_config` take `{action, params}` and run the REST route of that action in process, as the token's user; `validate_config` tries every saved connector (or one type). Off by default (`OFF_BY_DEFAULT`).
- **New route**: `PATCH /api/v1/backups/settings/{id}/locations/{index}` (one location of a set).
- **Addresses**: `#settings/network` → `#settings/discovery`, `#security/watch` → `#security/overview`, `#settings/ssh` → `#settings/machines/ssh`, all redirected.
- **`GET /api/v1/me`**: `update` now carries the last check kept even when the automatic check is off.
- **Logs**: the in-memory ring keeps 10,000 lines (was 3,000).
- **Migration**: nothing to change from 0.20.2, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
