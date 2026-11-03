# Release notes: MyServices 0.35.10

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.10** (3 November 2026) shows the whole reason a Tapo camera picture is refused.

## For everyone

**Fixed**
- **« Picture not read: picture refused (Http(reqwest::Error … »**: when a Tapo camera could not be reached, the tile cut the message before its cause. It now shows the camera's address, then the cause, for instance a connection the camera refused or a secure connection it could not agree on.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.10` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the Tapo connector keeps the end of the library's error, where the cause is. No API or database change.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
