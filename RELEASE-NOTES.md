# Release notes: MyServices 0.38.6

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.6** (17 November 2026) makes MyServices installable as a web app.

## For everyone

**Added**
- **Install MyServices as an app**: in Chrome or Edge, an install icon now appears at the right of the address bar (or menu, then « Install MyServices »). MyServices then opens in its own window, without tabs or address bar, with its own icon in the taskbar or the start menu.
- The browser only offers the install on a secure address: open MyServices through your domain in HTTPS (for instance behind your reverse proxy), or on `localhost`. A plain `http://IP:port` address does not qualify. Nothing changes if you do not use it.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.6` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agents**: unchanged (Windows v11, Linux v11).
- **Server**: the web app manifest and its three PNG icons are public paths (no session), since the browser fetches them without a cookie. No service worker, so no cache to invalidate.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
