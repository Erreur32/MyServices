# Release notes: MyServices 0.38.5

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.5** (17 November 2026) keeps the Arcane connector working after Arcane 3 renamed its API routes.

## For everyone

**Fixed**
- **Arcane 3: environments and containers are back**: Arcane 3 renamed its environment routes (`/api/environments` became `/api/agents`), so the Arcane connector could show no environment at all. It now reads `/api/agents` and still works with Arcane 2 through the old routes.

> **Arcane 3 API key**: the key needs the read permissions `environments:list`, `environments:read` and `containers:list`. An existing key without them will return an empty environment list.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.5` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agents**: unchanged (Windows v11, Linux v11).
- **Server**: the Arcane connector probes `/api/agents` first, then `/api/environments` (Arcane 2); the container list and counts follow the detected base. The setup guide names the Arcane 3 read permissions.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
