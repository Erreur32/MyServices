# Release notes: MyServices 0.37.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.37.2** (3 November 2026) makes the pictures of Tapo cameras work, and says plainly when a camera account is wrong.

## For everyone

**Fixed**
- **Tapo camera pictures**: a picture is now one frame of the camera's main stream (`stream1`), read by ffmpeg, as Home Assistant and Frigate do. Cameras the Tapo library could not read now give their picture: a C520WS, and cameras whose old encryption the library refused (« HandshakeFailure »).
- **« Test » checks each camera**: in Settings › Connectors › Tapo, « Test » now tries one picture per camera account and says for each one « picture OK » or why it is refused. A refused camera does not switch the connector off: plugs and other devices are still read.
- **The right camera account**: a camera account is the one created in the Tapo app (camera › Advanced settings › Camera account), not your Tapo e-mail login. Saving now refuses the Tapo e-mail and password given as a camera account, and a refused account (401) reminds you that the name and password are case sensitive.
- A refused picture is asked again at once: no more 10-minute wait after a refusal.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.37.2` (amd64 and arm64), about 200 MB larger: it now carries one static ffmpeg binary (9.0.2, pinned by digest). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the Tapo connector (`connectors/tapo.py`) and the connector settings check (`connectors/settings.py`).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
