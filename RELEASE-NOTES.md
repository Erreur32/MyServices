# Release notes: MyServices 0.15.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.0** (18 October 2026): a new Security page, a redone home page, import and export of the configuration, and shorter default schedules.

## For everyone

**What's new?**
- **Security page, redone and public**: an overview that lists what needs a look, worst first, with where it comes from and what to do, then one sub-tab per category: Fail2ban, exposed sites, SSH access, network ports and certificates. The Fail2ban tab has statistics (bans per hour and per day, per jail, the addresses banned most or back again) and shows **which domains were attacked**, read from the web logs LogviewR follows.
- **Home page, redone**: the counters column is wider and gains Network, Connectors and agents, Virtualisation, and Updates and certificates. The "last 24 hours" card has a chart and one aligned row per kind of event. The paragraphs that repeated the counters are gone.
- **Import and export of the configuration** (Settings, Backup and info): export everything or only some parts (settings, machines, backups, remembered decisions, accounts and history, encryption key, SSH keys) as a standard ZIP. An import is previewed first, then applied part by part, with your password. Replaced files are kept next to the new ones, and importing the key alone is refused because it would lock your passwords out.
- **E-mail in one field**: point MyServices at the mail relay of the host (postfix and the like), test before saving, with copyable commands when it fails. The profile has a test button.
- **Tasks and schedules** page redone. New default schedules: collection every 15 minutes, health every 2 hours, backups checked 4 times a day (schedules you saved are kept).
- **Network**: the menu is at the top and the counters show on the first page; the Diagnostic lets you mark a finding as normal, and flags machines running at 100 Mb/s or less.
- **Freebox and other boxes** are no longer reported as "without SSH": they have their own state, "Network equipment".
- **A click on a card header** opens or closes the card (except on a link or a button in it); explanations now share one look with an icon.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.0` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **New**: `config_transfer.py` (routes `GET /system/config-parts`, `POST /system/export`, `POST /system/import/preview`, `POST /system/import`), `connectors/logviewr.py` `ban_stats` and `add_domains` (7 days of ban history, aggregates only; `log_search` for the domains), `POST /network/diagnostics/accepted`, `lib/securityFindings.ts`, `lib/foldHeader.ts`.
- **Changed**: default schedules in `server.py` and `install.sh`; `POST /system/mail/test` accepts the values to try before saving; the machine state `box`; the Security tab is no longer development-only.
- **Needs**: LogviewR with the ban history for the Fail2ban statistics, and its web log sources for the domains.
