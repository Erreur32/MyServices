# Release notes: MyServices 0.33.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.0** (31 October 2026) adds four router connectors, shown with the Internet boxes. **None of them was tested on a real router**: they follow the documentation or client libraries of each maker, so they may need a fix on your model. Please tell us how they behave.

## For everyone

**What's new?**
- **OpenWrt**: model, firmware, state and address of the Internet connection, through ubus. The guide explains how to create a read-only account.
- **MikroTik RouterOS**: the same, through the REST API. It needs RouterOS 7.1 or later.
- **Asus router** (AsusWRT and Merlin): the router accepts one login at a time, so MyServices reads it every 15 minutes by default. Newer models with another login are not covered.
- **TP-Link Archer**: only the encrypted LuCI firmwares. Each reading closes your open web session on the router, so it also reads every 15 minutes by default. Other generations are refused with a message.

All four only read, and each card says it was not tested on a real router. A refused password is not tried again until you change the settings, so MyServices does not keep knocking at your router.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Connectors**: `openwrt`, `mikrotik`, `asus-router` and `tplink-router`, all optional, in the Network category. Only a hash of a refused password is kept, in memory.
- **Migration**: nothing required from 0.32.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
