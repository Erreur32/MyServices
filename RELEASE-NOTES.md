# Release notes: MyServices 0.32.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.32.0** (31 October 2026) sees problems sooner and says more about them: **availability** is kept to the minute, a failing service is **tried again** after 90 seconds, machine notices tell **since when** they last, and an **agent** can now replace SSH for reading a machine. The pages you use every day also line up.

## For everyone

**What's new?**
- **Availability to the minute**: machines and services keep their outages from the port pulses, and the 24 hour view shows 96 quarter-hour cells.
- **Quick recheck**: a service found bad although its port answers (a 5xx, or no answer on its public site) is tried again about 90 seconds later, so an outage is confirmed sooner.
- **Since when**: each machine notice says how long it has lasted, and what is behind it. A hot processor gives its thresholds, its hottest probe and the load, a disk its free space, the memory its amounts, the updates how many are for security.
- **Header**: every scheduled task can appear in the header, chosen per browser in Tasks and schedules, each with its own colours.
- **Internet box**: a Liberty gateway connector for Virgin Media Hub 5 and Ziggo SmartWifi, simulated here: please tell us how it behaves on a real one.

**What's changed?**
- **Agent first**: a machine with a fresh and complete agent report is no longer read over SSH for its inventory, ports and logins. When an agent cannot read everything, the Agents and SSH connections pages say what is missing and how to fix it.
- **Tasks and schedules**: the coming runs in a table sorted by time, with state, schedule, next run and header columns on wide screens.
- **Machines, Services, Connectors**: the same frame, with the search centred in its title. Services shows its main filters on the left like Machines, and Connectors has tighter cards, six a line at most.
- **Services**: « Ignored domains » is now a small button in the title line, with the domains beside it.
- **Cloudflare and Audit log**: your browser keeps the chosen period, and the chosen domain on the Cloudflare pages.
- **Remote folder**: a Samba account is presented as the simple way, and the READMEs give a read-only mount example.

**What's fixed?**
- **Requests**: the date of the reading is right.
- **Login page**: the button text uses the page font at its proper size.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.32.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Storage**: a new `avail_runs` table, about 2 MB estimated with 100 pulsed services, older rows removed by themselves. `recheck.json` appears next to `ports.json`, and `health.json` keeps a start date per control.
- **Notices**: the count starts at the first health pass after the update, so a notice already there shows a shorter time at first. There is one date per control, so two full disks share the oldest one.
- **Requests**: Rybbit and Umami are read every 15 minutes instead of 5, and Settings › Requests shows what the port pulses cost.
- **Frigate**: with an account, the sign-in is kept in memory between readings and camera pictures, never in a file.
- **Security**: the key of a custom icon is checked where the file path is built.
- **Removed**: `legacy/`, the old systemd installation, unused since the Docker version.
- **Migration**: nothing required from 0.31.10, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
