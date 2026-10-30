# Release notes: MyServices 0.31.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.4** (30 October 2026) gives the Domotique page three sub-pages, redoes the Netatmo page, adds a read-only Tapo connector, and fixes two things: SVG icons can be imported again, and the Machines table no longer shows the cards too.

## For everyone

**What's new?**
- **Domotique has an Overview.** The menu now holds « Overview », « Netatmo » and « Tapo ». The overview shows the house in one look: the main figures, a folded « To deal with » panel, one card per brand, and a table of all your devices.
- **Netatmo, redone.** The 24 hour curves are in view without opening anything: temperature, humidity and CO2 side by side, with a legend that switches a line on or off. Each room card has bars for CO2, humidity and battery. Roller shutters and outdoor blinds are in two panels, the heating has its own scale, and the cameras show a picture thumbnail.
- **Tapo connector (new, read only).** Plugs with their power, today's and this month's energy and a 24 hour curve; cameras (online or not); lights; hub sensors. It finds your devices on the local network and reads them with your Tapo account. It has not been tried against a real account yet: tell us what you see.
- **Fix, Machines.** In the Table view the cards were also shown under the table. Each view now shows alone.
- **Fix, icon import.** An SVG that could not be imported now is, including the ones written by editors such as Inkscape or Illustrator.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.4` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit. It carries the new `tapo` library.
- **API and storage**: no change.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.3, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
