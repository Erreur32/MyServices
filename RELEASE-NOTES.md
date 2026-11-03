# Release notes: MyServices 0.37.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.37.0** (3 November 2026) gives each connector and each service its own page, and says where a warning comes from.

## For everyone

**Changed**
- **One page per connector**: in Settings › Connectors, a card opens the connector's own page, alone in a blue frame: its state, what it reads and its settings. Back, Close or Cancel bring you back to the list with the same filter and search. If you changed a setting without saving, the page asks before leaving.
- **Where a warning comes from**: a connector's page tells apart two things. « Reading » is MyServices reading the tool (failed, stale, partial). « Tool » is what the tool itself reports, such as a Nextcloud share without a password: that one is to fix in Nextcloud, the connector works. The list has two chips for them, « Reading to check » and « Reported by the tool ».
- **The dot of the Connectors menu** also lights for a stale or partial reading, never for what a tool reports. A click on it opens the connectors to check.
- **One page per service**: on Services, a card opens the service's own page: where it runs, its full sheet (identity, service, network and NPM), then its settings, always open. When a service runs in several places, a click on a row shows that place.
- **Services, the follow button** is green when the service is followed, orange when it is hidden.
- **Machine page**: the machine's information sits in one blue frame, like the connector and service pages.
- **Home, « To deal with now »**: the machine leads each line as a badge, each cause on its own line with its duration.
- **Adding a connector**: searching for a camera maker such as Abus, Hikvision or Dahua finds the ONVIF connector.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.37.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: no change. Web pages only: `#settings/connectors/<type>/<name>` and `#services/all/<place>` open a connector's and a service's page.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
