# Release notes: MyServices 0.37.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.37.3** (3 November 2026) makes the pictures of Shinobi cameras work, and says which permission the API key lacks.

## For everyone

**Fixed**
- **Shinobi camera pictures**: a picture is now taken at once from the camera's stream by Shinobi itself, so « JPEG API » no longer has to be on for each camera.
- **The right API key**: when the Shinobi API key may not view pictures, the tile now says to tick « Can View Snapshots » on the key (Shinobi › API), instead of « the answer is not a picture ». The help of the « API key » field says so too.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.37.3` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the Shinobi connector (`connectors/homelab_stream.py`): the picture comes from `/<key>/icon/<group>/<monitor>?noflags=1` instead of `/<key>/jpeg/<group>/<monitor>/s.jpg`.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
