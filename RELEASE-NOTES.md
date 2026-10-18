# Release notes: MyServices 0.15.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.1** (18 October 2026): the home page's attention card is sorted by category and severity.

## For everyone

**What's new?**
- **Home page, attention card**: the points that need a look are now sorted into categories (machines, services, health, DNS, backups, connectors). The categories with red points come first, and inside each one the red lines come before the orange ones. Each category shows its red and orange counts, and a click on its header folds it (the choice is kept in your browser).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.1` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `lib/summary.ts` (`Attention.category`, `groupAttention`, `limitGroups`) and the new `components/AttentionGroups.tsx`; no server change.
