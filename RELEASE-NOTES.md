# Release notes: MyServices 0.35.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.0** (2 November 2026) rebuilds the DNS page: everything that asks for an action is on Servers, and each name now tells where it lives and who runs its DNS.

## For everyone

**What's new?**
- **One table for each name**: on DNS, Servers, each name shows its NPM and machine, who runs its DNS, its Cloudflare state and the answer of your local DNS, with a verdict that says what to do and where. Every column sorts, and the table opens on the alerts.
- **Cloudflare card**: how your names are served, and how many ask for a look, next to the sync and instance cards.
- **Who runs the DNS**: read from each domain, with the logo of the known hosts (Cloudflare, OVH, Hostinger and others).
- **Alerts in one place**: they move from Details to Servers, and the menu dot and the home page counters open them there. Details keeps the sources, the rewrites and the machine names, on two columns.
- **Two NPM, no more confusion**: the single « NPM = address » note is gone. Each name shows its own NPM and machine.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 8.
- **DNS hosts**: asked of the DNS servers of the page, never of a public resolver, once a day per domain.
- **Two instances on one network**: shift the collection of one of them, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
