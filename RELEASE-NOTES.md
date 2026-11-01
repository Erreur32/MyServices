# Release notes: MyServices 0.33.5

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.5** (1 November 2026) makes the home page talk to you: words that follow the situation, and a list of changes that only keeps real problems.

## For everyone

**What's new?**
- **Home title and sentence**: the words follow how many alerts there are and how serious, and change every hour. When all is calm you get a fact of your network, a geek line or a quote. Data stand out in bold.
- **What changed since yesterday**: only what is still a problem. What came back is left out, and « New » only shows what has never been seen. History keeps everything.
- **Logos and links**: names in that frame show the logo of their service and open its card.
- **Connectors**: a card's warning is now in a larger tooltip on its state, and the footer always shows its address.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.5` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Migration**: nothing required from 0.33.4, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
