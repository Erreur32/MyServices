# Release notes: MyServices 0.35.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.1** (2 November 2026) watches the web traffic of your Nginx Proxy Manager and the Fail2ban of every machine, and makes the home page and the tables easier to read.

## For everyone

**What's new?**
- **Web traffic** (Security, Web traffic): the requests of each Nginx Proxy Manager over 24 h against its usual hour, the load beside it (a load from backup copies is told apart from an attack), each site with its favicon, its diffuse scraping share and its 5xx, and the busiest addresses of the last hour. Read by the Linux agent (version 11) or over SSH.
- **Two new alerts**: « Web traffic peak » (3 times the usual hour, at least 1,000 requests) and « Diffuse scraping » (a site fed for more than 40 % by many addresses that stay under the Fail2ban limits).
- **Fail2ban of every machine** on the Fail2ban page, without LogviewR, and the alert « Jail going up » for a machine.
- **Sortable tables everywhere**: a faint double arrow shows a column that sorts.
- **Home page**: a health line is never cut, its hint follows the cause, a backup is no longer called « one serious point », and the calm sentence has more geek quotes.
- **Kernel notices**: a disk blocked by a big copy reads « 3 process(es) stuck on the disk at 11:08 (a copy, a backup?) », without the kernel's fixed lines. Any other kernel error keeps its own words.

**Fixed**: backups read by an agent are fresh before each run, no « late » copy before its time, no false « DNS absent ».

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do; check your saved alert rules if you want the new alerts sent. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: Linux agent version 11, updated by itself when automatic update is on. Reading the NPM logs needs `docker ps` and `docker inspect` for the reading account; only totals and the 10 busiest addresses leave the machine.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
