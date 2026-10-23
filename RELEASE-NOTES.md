# Release notes: MyServices 0.20.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.20.1** (23 October 2026): agents and SSH connections at a glance, each access set on a page of its own, and the page of a machine split between its information and its settings.

## For everyone

**What's new?**
- **Machines → Agents lists every agent**: figures on top (active, silent, pending, to update), a table with the machine, type, state, version and last report, and one button to update the late agents. The revoked ones stay below.
- **Machines → SSH connections**, a new sub-page: every machine read over SSH, the account and address it uses, and whether its last read went through, was refused or has not happened yet.
- **Each access on its own page**: « Set » on a row opens the SSH settings of that machine alone, or its agent with all its gestures (automatic or immediate update, new token, revocation, host name to confirm).
- **The page of a machine is split in two**: its information (state, health, software, backups, availability, ports, guests) with a « Settings › » button, and a page with its settings alone (identity, options, access).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file or your settings. Old links to the Access tab of a machine still open the right place.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.20.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Front only**: no API, configuration or data change. New addresses: `#settings/machines/ssh`, `#settings/machines/ssh/<ip>`, `#settings/machines/agents/<ip>`, `#machines/<ip>/settings`. The lists are worked out in `front/src/lib/accessLists.ts`.
- **README**: screenshots and text of the new navigation.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
