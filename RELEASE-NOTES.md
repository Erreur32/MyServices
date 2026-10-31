# Release notes: MyServices 0.33.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.33.2** (1 November 2026) gives the cards of labels and values a clearer look. It follows 0.33.1 by a few minutes: if you skipped that one, read its notes in [CHANGELOG.md](CHANGELOG.md) too, as Linux agents have an update waiting.

## For everyone

**What's new?**
- **Cards**: on the machine page, the AI and video cards and the GPU bars, the labels sit in a darker column, unbroken from top to bottom, so the values stand out.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.33.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Migration**: nothing required from 0.33.1, see [MIGRATION.md](MIGRATION.md). From 0.33.0, read the 0.33.1 section too.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
