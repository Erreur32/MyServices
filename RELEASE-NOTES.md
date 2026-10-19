# Release notes: MyServices 0.18.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.18.0** (19 October 2026): the screens tidied up in five steps (watch / inventory / configure): home page in three blocks, Settings regrouped, a page per machine, the Backups, Security, Services and Network tabs in « state » mode, fewer options; plus the DNS tab in state mode (works without AdGuard) and services declared by hand.

## For everyone

**What's new?**
- **Five steps of a tidy-up of the screens**, each page sorted under one word: Watch, Inventory or Configure.
  - **Home page in three blocks**: « To deal with now » (every alert with a button to the right place), « What changed since yesterday », « Missing » (what would unlock a page). History is a sub-tab of the home page.
  - **Tab bar and Settings**: seven tabs to watch (Home, Machines, Services, Network, DNS, Backups, Security), an « Inventory » menu (Infra, Virtualization, Diagrams), a gear for Settings; Settings in four groups and ten sections; Audit log, Logs, Help and About are pages apart.
  - **A page per machine** (`#machines/<ip>`): detail, availability over 30 days, open ports, virtual machines, and its settings in the page for administrators.
  - **Backups, Security, Services and Network in « state » mode**: a title line naming the sources, a few figures, a « To watch » frame (worst first, a detail unfolding in the row, foldable), then the former lists folded under « See all » or kept under the sub-menu. Settings › Backups in three blocks: the followed sets in one editable list, the sources as tiles, the rules folded.
  - **Fewer options**: the integrated health is always on, one switch for the services outside Docker, the header notice follows the automatic update check, no more « read first by » or « hosts NPM » choices; the schedules and rare settings sit behind « Edit the schedules » and « Advanced ».
- **DNS tab, always there**: without AdGuard the server asks the resolvers of the container for every NPM domain and every machine name; with AdGuard the synchronisation and the instance cards stay.
- **« + Service »**: declare a service the detection does not see (name, machine or IP, port, http / https / tcp), try it, follow it; edit or remove it from its detail.
- Machines: a health badge always says why.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file. The `PUT /api/system/health` route and the `update_header` setting are gone (the health is always on, the header notice follows the automatic check).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.18.0` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `services_admin.py` and `/api/services/manual` (declared services), the DNS control on the container's resolvers (`resolvers()`, `machine_names_check()` in `myservices.py`), `lib/missing.ts`, `lib/machinePage.ts`, `lib/backupsState.ts`, `lib/servicesState.ts`, `lib/securityWatch.ts`, `lib/dnsState.ts`, `components/StatTile.tsx`, `components/WatchPanel.tsx`, `components/ManualService.tsx`, `tabs/MachinePage.tsx`; `PATCH /api/backups/settings/<id>` takes `archived`, `schedule`, `path`.
- **Removed**: `PUT /api/system/health`, the `update_header` setting, `health_sources` in the machine page, `components/StatsColumn.tsx`, `components/AttentionGroups.tsx`, the `history` top tab (`#history` maps to the home page).
