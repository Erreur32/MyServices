# Release notes: MyServices 0.35.9

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.9** (2 November 2026) tells why a camera picture cannot be read.

## For everyone

**Fixed**
- **« Picture not read: the tool did not answer »**: the tiles of the Cameras and Tapo pages gave no reason, and behind Cloudflare the server's answer was replaced by its « Bad gateway » page. The tile now shows the reason the camera or its recorder gave, for instance a refused camera account. A Tapo camera paused for 10 minutes after a refusal keeps saying that first reason.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.9` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: `/api/v1/stream/snapshot` and `/api/v1/stream/live` answer `503` with the reason when the camera or its recorder fails (was `502`). No database change.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
