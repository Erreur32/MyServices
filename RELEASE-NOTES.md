# Release notes: MyServices 0.31.7

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.7** (30 October 2026) brings more **cameras** to the Video page, shows the picture of **Tapo** cameras already filmed by a recorder, and removes the **Windows Admin Center** connector.

## For everyone

**What's fixed?**
- **Netatmo through Home Assistant**: the cameras now show on the Video page and on Domotique, Netatmo, with their picture, without a Netatmo connector. A camera read by both stays once.
- **Tapo**: a camera filmed by Frigate or Shinobi shows its picture on the Tapo page, matched by its address. The picture through Frigate was checked on real cameras; the same path through Shinobi has not been tried on a real Shinobi yet.
- **Video**: the picture is asked by the instance name, which can differ from the name of the app.
- **Tapo**: a device that answers the search but not the reading gives its address and the cause of the failure. The account is only blamed when the error says so.

**What's removed?**
- **Windows Admin Center connector.** It only gave a list of names, and the Windows agent already gives the Hyper-V VMs and the system of the machine. It lived for two versions. Windows Admin Center is still recognised in Services, now on port 20443 too. If you added this connector, delete it in Settings, Connectors before updating. If you update first, nothing breaks: see [MIGRATION.md](MIGRATION.md).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.7` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: the camera rows of Frigate and Shinobi gain `ip`, the host of their stream, never its account or path. The connector type `windows-admin-center` is gone: an entry left in `config.json` is skipped. No new dependency.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.6 unless you added the Windows Admin Center connector, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
