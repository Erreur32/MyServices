# Release notes: MyServices 0.38.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.2** (4 November 2026) stops the services of a Windows PC from coming and going at each report of its agent.

## For everyone

**Fixed**
- **Windows agent v10, services no longer flap**: on a PC with many listening sockets (a browser, Hyper-V, IPv4 and IPv6 of each port), a service such as SMB (445) appeared, went « panne », then disappeared, and another port took its place at the next report. The agent kept the first 400 listening sockets in no fixed order, so a different subset was lost each time and a port left out was taken for closed. Windows' dynamic ports (49152 and up, already ignored) are now dropped before the cut, and the list is sorted.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). A Windows agent with automatic update takes v10 at its next report; otherwise click « Mettre à jour » on its row in Machines › Agents. No new key needed. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: Windows agent v10 (`health.WIN_PS`, served inside `agent.ps1`): `Get-NetTCPConnection -State Listen` is filtered to ports below 49152 and sorted before `Select-Object -First 400`. Linux agent unchanged (v11).
- **Server**: no change.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
