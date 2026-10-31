# Release notes: MyServices 0.32.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.32.1** (31 October 2026) is a small security release: two ways a crafted text could stall the server are closed. Nothing changes on screen.

## For everyone

**What's fixed?**
- **Security**: a crafted web page could cost several seconds of the collection, and a very long word in an agent report could hold the server for minutes. Both are now read in milliseconds, with the same results.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.32.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Patterns**: the page generator pattern is bounded, and the Docker networks are read word by word. Each has a test with a crafted text.
- **Code quality**: small SonarCloud remarks cleared (redundant exceptions, unused variables and parameters), with no change in behaviour.
- **Migration**: nothing required from 0.32.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
