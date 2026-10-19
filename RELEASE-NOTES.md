# Release notes: MyServices 0.18.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.18.2** (19 October 2026): the request counters become Settings › Requests on every build, a connector turned back on is read at once, and a few screens are tidied.

## For everyone

**What's new?**
- **Settings › Requests**: what each connector asks its service, route by route (calls per minute and per hour, durations, last code, 429 answers and their delay), measured in real conditions on any image, with « Copy the reading » (to paste for analysis) and « Reset ». The former development-only block is gone.
- **A connector turned back on works at once**: saving, turning on or off, or removing a connector is applied to the running server right away; before, the live view, the machine sheets and the UniFi cards could ignore a connector turned back on until a restart.
- Home: the rows of « What changed since yesterday » are aligned on one grid. History: the Events / Availability switch sits in the middle of the period row of both views, and the three home sub-pages start at the same height. Network: the title line is a row of tags. « To watch » at zero shows a green zero and stays shut. The collection step shown by the header orb is translated. A « Settings » entry in the account menu.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.18.2` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `RequestsSettings` (Settings section) in `components/RequestStats.tsx`, `POST /api/v1/connectors/requests/reset` (admin), `settings_applied()` in `api.py` (configuration reloaded in place through `system.reload_config`, UniFi cards and network figures caches dropped).
- **Changed**: `GET /api/v1/connectors/requests` answers on every build (admin) and carries the version; the counters block under the connector cards and under the network diagnostic is removed.
- **Fixed**: whitespace text nodes before JSX comments in table rows, duplicate uplink port keys on the UniFi cards.
