# Release notes: MyServices 0.35.8

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.8** (2 November 2026) removes two false notices on the machine settings pages.

## For everyone

**Fixed**
- **« ESXi key » on every machine**: the SSH connections page named the app's second key (the ECDSA one, kept for ESXi) for every machine whose access was set by MyServices. It now names the key SSH tries first: « app key ». Nothing changed in the connections themselves.
- **⚠ on agents that cannot read Docker**: since 0.35.6 the agents page asked to tick « Read Docker » on every machine whose agent cannot read Docker, even where SSH already reads the containers and no Nginx Proxy Manager runs. It now asks for it only where a NPM runs, since only its web traffic needs it; elsewhere it says the containers are read over SSH.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.8` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: no database change.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
