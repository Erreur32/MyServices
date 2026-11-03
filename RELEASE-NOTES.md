# Release notes: MyServices 0.36.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.36.0** (3 November 2026) reads IP cameras directly: any camera that speaks ONVIF, and Reolink cameras.

## For everyone

**Added**
- **ONVIF connector**: most IP cameras and recorders speak ONVIF (Hikvision, Dahua, Amcrest, Axis, Foscam, Annke, Reolink, Tapo on port 2020). Give the camera's address and an ONVIF account: MyServices shows its maker, model and firmware, its cameras, and the current picture on the Cameras page. On many cameras ONVIF is off by default: turn it on in the camera's settings first. A camera with the wrong time still works: MyServices reads its clock first.
- **Reolink connector**: a Reolink camera or NVR through its own API: model, firmware, each camera and whether it is online, and the current picture. A guest account of the camera is enough.

Both only read: never the video stream, never a setting. A picture is read when you look at it and never kept.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.36.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: connector types `onvif` (SOAP 1.2, WS-Security password digest, Digest for the picture) and `reolink` (`/cgi-bin/api.cgi`, account in the query, which the request counters drop). No API or database change.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
