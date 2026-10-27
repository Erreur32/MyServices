# Release notes: MyServices 0.27.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.27.0** (27 October 2026) adds the speed of your Internet link to the Network page and extends the tiles with a history to Backups and Services.

## For everyone

**What's new?**
- **Download and Upload** on the Network page: the rate of your Internet link for the Freebox (red) and the UniFi gateway (blue), each with its own curve and its own value. Click a name in the legend to hide its curve. The Freebox page shows the Freebox only. A source that does not report a rate is left out.
- **Backups tiles with a history**: up to date (a curve), late and missing or failing (strips), over the period switch (24 h, 3 days, 7 days).
- **Services**: the Warning tile draws a strip of the services in warning.
- **Sources tile** of the Network page is now small and shows the short names of the sources.
- Tiles keep the same room for their figure, so the charts line up from one tile to the next.
- **Development**: a herdr pane « PR et git » shows the release chain, main and the open branches (for people running the dev setup).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md). The new curves start empty and fill by themselves.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.27.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API**: new `GET /backups/history`; `GET /services/history` carries `warn`; `GET /network/history` carries `bw` (rates in kbit/s and link capacity per source and direction). All take `hours=24|72|168`.
- **Storage**: `tile_samples` gains the keys `backups.*`, `services.warn`, `bw.*` (7 days). A `bandwidth` thread reads the link rate every 2 minutes at most, reusing the connector readers' reading (Freebox) and the UniFi cards cache (30 s).
- **Migration**: nothing required from 0.26.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
