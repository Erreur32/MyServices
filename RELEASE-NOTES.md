# Release notes: MyServices 0.37.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.37.1** (3 November 2026) makes a refused Tapo camera picture say its real cause.

## For everyone

**Fixed**
- **Tapo cameras, a picture that cannot be read**: when the picture is read from the camera's video stream, the tile used to show only the connection details that end the error (« conn: …(me)->…:554 msg: … »). It now shows the cause, such as a refused camera account.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.37.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the Tapo connector only (`connectors/tapo.py`).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
