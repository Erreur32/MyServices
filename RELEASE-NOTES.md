# Release notes: MyServices 0.30.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.30.0** (30 October 2026) brings the video pages to the level of the others, correct Windows names, alert thresholds per machine and two new diagrams.

## For everyone

**What's new?**
- **Cameras and Frigate.** The video overview shows what your cameras detect (events over 24 hours, peak hour, objects, last events, storage). Pictures appear by themselves; the live stream starts with the play button and stops after 5 minutes. A new Frigate page shows its detectors, graphics cards and storage when Frigate is connected.
- **Right Windows names.** Windows 11 is no longer shown as Windows 10, servers show their year, and the version (23H2, 25H2) is kept.
- **Alert thresholds per machine.** Choose from which percentage a disk or the memory raises a warning or a critical alert, in the machine's settings (Options).
- **Two new diagrams**: DNS, and who watches what. Generation no longer gets stuck.
- **Tidier pages.** Same head everywhere (title, tags, then connectors icon, period and main button on the right), main tables in a frame. Blue information frames can be hidden with their cross and shown again from your profile.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.30.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API**: new `GET /stream/live` (MJPEG relay, 5 min, 4 at once); `/stream/snapshot` is open to any signed-in user. Machine settings accept `warn_pct` and `crit_pct` limits.
- **Agents**: unchanged (Linux agent 4, Windows agent 9).
- **Migration**: nothing required from 0.29.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
