# Release notes: MyServices 0.31.5

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.5** (30 October 2026) adds a read-only **Windows Admin Center** connector, to be tried on a real instance.

## For everyone

**What's new?**
- **Windows Admin Center connector (new, read only).** It lists the servers, clusters and PCs that a Windows Admin Center gateway manages, and shows their count on the connector card. You sign in with a Windows account (`DOMAIN\user`), the way WAC asks for it by default. It only reads the list: it opens no session on those machines.
- **Not tried on a real instance yet.** It was written and checked against test vectors and a simulated gateway. If your WAC uses a form sign-in instead of a Windows account, the test says so: that mode is not handled yet. Tell us what the test shows.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.5` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change. No new dependency: the Windows sign-in (NTLMv2) is written in the standard library.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.4, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
