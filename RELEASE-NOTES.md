# Release notes: MyServices 0.31.10

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.10** (31 October 2026) adds **Cloudflare**, a read-only connector with its own pages, and tidies what you use every day: **Services** keeps a service's sheet inside its card, **Availability** is redrawn, and the **setup assistant** ends on one clear next step.

## For everyone

**What's new?**
- **Cloudflare**: an optional read-only connector. Its pages show what to improve and why, the traffic over 24 hours, 7 and 30 days, security events, server and cache, DNS, your domains side by side, and each proxied name checked against NPM, Apache or nginx.
- **Read now**: a button reads one connector, tests one service or reads the health of one machine, without waiting for a whole pass.

**What's changed?**
- **Services**: an outage shows in 2 to 3 minutes instead of 20 to 35. A light pulse tries the port of every web service each minute; you can set it or turn it off in « Live checks ». SSH, mail, SMB, 5xx errors and public sites are still seen by the collection, every 15 minutes.
- **Services**: one service, one place. Its sheet opens inside its card, under the table, and its pencil edits it there. Old links open the same service in the list.
- **Availability**: machines, services, domains and Uptime Kuma are named as you name them, the filters stay in sight and the cells line up. The page opens on the machines, then keeps your filters in your browser.
- **Machines**: a visible filter, on by default, hides the machines powered off or no longer followed. The « Off » tile brings them back.
- **Assistant**: the last step is a short message with one main button, « Add a machine », which offers the agent first, and a link to connect your tools. Reopened once finished, it starts at the first step and keeps what was validated.
- **Machines › SSH connections**: a badge tells which machines must keep SSH, and why.
- **Machine alert limits**: the fields show the values in force, so their arrows no longer start from 0.
- **Agents**: a new agent reports every 5 minutes instead of 15. An agent already installed keeps its rhythm until its install command is run again.
- **Video and cameras**: the overview and the Frigate page sit on three columns.
- **Fields**: every field has its own background in each theme, and what you type stays readable.
- **Connectors**: the connector button of a page opens that connector for editing.
- **Services**: « Ignored domains » shows its list in the title and starts folded.

**What's fixed?**
- **Assistant**: « Finish » always ends it and brings the summary into view.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.10` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: the Cloudflare figures join `data.json`. The pages `#services/item` and `#services/edit` are gone and redirect to `#services/all/<key>`.
- **Service pulse**: a new `ports.json` beside `pulse.json`, and a new `ports_every` setting (60 s by default, 0 = off).
- **Cloudflare**: read once an hour, about 11 calls per domain, no new right beyond read access. Paths and user agents are stored, client IPs never are.
- **Agents**: same agent scripts (Linux agent 4, Windows agent 9); only the timer of a new install changes.
- **Migration**: nothing required from 0.31.9, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
