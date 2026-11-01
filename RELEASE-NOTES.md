# Release notes: MyServices 0.33.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.4** (1 November 2026) makes the home page a real starting point: more subjects in one look, and every figure leads to its page.

## For everyone

**What's new?**
- **Your whole fleet in figures**: new frames for Security, Cloudflare, cameras and AI. The AdGuard frame becomes DNS, and the Updates frame shows machines on the left and services on the right.
- **Clickable figures**: a counter with a value opens a filtered list or the right page. Every counter of a card stays on one line, and the frames of a row have the same height.
- **Your installation**: the full list of your tools, with logo, number of instances and state. A click opens the right connector.
- **UniFi cards**: clearer port numbers and WAN / LAN marks, port details on one line, and on access points a narrower front panel with bigger ports.
- **Fixed**: no more false « automatic updates failing » on servers using `mirror+file` sources, and an invalid certificate shows as serious in every language.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.4` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Migration**: nothing required from 0.33.3, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
