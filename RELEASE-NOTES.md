# Release notes: MyServices 0.28.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.28.0** (28 October 2026) is a tidy-up release: the Python code is now organised in folders, and the old installation without Docker is retired. Nothing changes on screen.

## For everyone

**What's new?**
- **Nothing changes in the app.** The 66 Python files that sat in one folder are now ordered in a package (`msv/`), which makes the project easier to read and to maintain.
- **Command lines moved.** Commands run inside the container now use the module name, for example `docker compose exec myservices python3 -m msv.tools.manage users` (accounts) or `python3 -m msv.machines.setup --check`. See [MIGRATION.md](MIGRATION.md).
- **The old installation without Docker is no longer maintained.** `install.sh` and the systemd units are kept in `legacy/` as a reference only. Use the Docker image.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.28.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change.
- **Migration**: nothing required from 0.27.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
