# Release notes: MyServices 0.33.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.1** (31 October 2026) shows what really runs on a machine: its systemd services join the Software and services table, and every open port is listed. It also fixes the daily availability bars after a change of clock.

## For everyone

**What's new?**
- **Running services**: the Software and services table of a machine lists its systemd services. Those you added by hand are marked « custom », those of the system stay under the System filter, and programs listening on a port get their row.
- **Open ports**: the card no longer stops at six ports. It opens on your applications, shows its count in a badge, and the All and System filters are one click away.
- **Agents**: an outdated agent shows both versions and what its update brings, and the page tells which agents keep an older rhythm.
- **Filters**: every filter and view choice now looks the same, as a pill.
- **UniFi cards**: a resized card zooms its ports and pictures, keeps its texts and always reaches the edges of its frame.
- **Copy buttons**: each copy confirms, or says when it failed.

**Fixed**
- **Availability**: after a change of clock, a day could take two cells and push the oldest day out of the bar.
- **Reread button**: its answer is in the tooltip, so the buttons around it no longer shift.
- **Kernel errors**: a CIFS share closing a file left open by an interrupted request is no longer a warning.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change for Docker. Update your Linux agents to see their running services, and read [MIGRATION.md](MIGRATION.md) about installing an agent over plain http.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agents**: Linux agent 5 adds one command, sent again from its cache for an hour. Version 4 keeps its whole inventory. Over SSH the list goes through the same connection.
- **Installers**: `install.sh` and `install.ps1` refuse plain http beyond the local network, unless `MSV_ALLOW_HTTP=1` is set.
- **Migration**: see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
