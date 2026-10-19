# Release notes: MyServices 0.18.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.18.0** (19 October 2026): the home page rebuilt around three blocks, History as a sub-tab of the home page.

## For everyone

**What's new?**
- **Home page in three blocks**, first step of a larger tidy-up of the screens (watch / inventory / configure):
  - **To deal with now**: every alert, red first, each with a button that opens the right tab already filtered on what the line talks about (« See the machine », « See the set »…). Eight lines, then « See all ».
  - **What changed since yesterday**: the events of the last 24 hours, line by line (the hour chart stays in History).
  - **Missing** (administrators): the sources that would unlock a page or a follow-up: machines online without agent or SSH, Backups / Network / DNS pages hidden for lack of a source, no notification channel. Each line leads to the setting that fixes it. Nothing mandatory.
- The header line says how many machines, services and backup sets are followed.
- **History** is now a sub-tab of the home page (« Overview / History »); the `#history` link still works.
- Gone from the home page: the counters column on the right (the counts are in each tab), the grouping of alerts by category and the « rows to show » setting. The « machines without usable SSH access » orange alert is now a « Missing » line.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.18.0` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `lib/missing.ts` (the « Missing » rules), `components/Missing.tsx`; every `Attention` line carries `action` (button label) and `sel` (tab filter) or `href`.
- **Removed**: `components/StatsColumn.tsx`, `components/AttentionGroups.tsx`, `groupAttention()` and `limitGroups()`; the `history` top tab (`OLD_TABS` maps `#history` to the home page).
