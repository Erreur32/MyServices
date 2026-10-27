# Release notes: MyServices 0.26.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.26.0** (27 October 2026) puts a history in the figure tiles of the main pages, gives every list page the same head, adds a Collection group to the menu, and lets a backup copy say how often it runs.

## For everyone

**What's new?**
- **Tiles with a history**: on **Machines**, **Services**, **Network** and **Security**, the figure tiles draw what happened over the last 24 hours, 3 days or 7 days (one switch at the top of the page, remembered by your browser). Reachable and Unreachable machines are a strip of states, health, services online, clients and devices are curves, bans are bars. Point at a chart to read one moment. On Machines, a click on a tile lists the machines behind it.
- **Processor and Memory tiles** on Machines: the average of your machines, the most loaded one under the figure, and a curve from 0 to 100 %. A click lists the machines over 80 %.
- **Network** history starts empty and fills at each collection: give it a few minutes before the curves appear.
- **One head for every list page**: the title and its tags on one line, and the actions of the page (period, Connectors link, buttons) at the far right. Backups gets an **Add backups** button, Network a **Connectors** link.
- **Menu**: a new **Collection** group holds Connectors, Discovery and Tasks and schedules. Clicking the name of a category opens its main page and unfolds it.
- **Backups, rhythm of a copy**: a copy that does not run every day, such as a weekly rsync to a NAS, can say so (**Rhythm**, in days). It is no longer reported « late » between two runs.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.26.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API**: new `GET /services/history`, `GET /network/history`; `GET /machines/history` carries `cpu` and `mem`; all take `hours=24|72|168`. Backup copies accept `every_days` (1 to 31).
- **Storage**: `tile_samples` (machines health and Network figures, one point per 9 minutes at most, 7 days); `metric_samples` now kept 7 days instead of 24 h.
- **Migration**: nothing required from 0.25.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
