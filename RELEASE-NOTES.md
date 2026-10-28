# Release notes: MyServices 0.29.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.29.0** (28 October 2026) is a speed and tidy-up release. Nothing new on screen: the code is easier to maintain and the server does less work.

## For everyone

**What's new?**
- **Lighter server.** The live stream that keeps an open page up to date uses about 60 % less processor, and the scheduled tasks start 2 to 3 times faster (the image now ships compiled Python).
- **Faster page loads.** The compiled front-end files are kept by the browser for a year (a new version has new file names).
- **Cleaner code.** The Python code is split into folders (`msv/`), with no more circular imports, and the 3,300-line API file is now one shared module and eleven route modules. The API itself is unchanged (same 177 operations).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.29.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change.
- **Migration**: nothing required from 0.28.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
