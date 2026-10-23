# Release notes: MyServices 0.20.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.20.2** (23 October 2026): Wazuh in MyServices, the last 24 hours of each machine, the agent first, and a clearer machine page.

## For everyone

**What's new?**
- **Wazuh**: the Wazuh connector now gives the state of its agents, and, with the address of the Wazuh indexer and a read-only user of it, the security alerts of the last 24 hours and the vulnerabilities of each machine. A new page, **Security › Wazuh**, sums it up: figures, the alerts per hour, the serious rules, and one row per machine (compliance and vulnerabilities as bars, worst first). Each machine page gets a Wazuh card, the Statistics page a Wazuh group, and the side menu a count next to Wazuh (disconnected agents and serious alerts). Nothing is shown when no Wazuh is set or when it does not answer.
- **The last 24 hours of each machine**: small curves under the processor, memory, fullest disk and temperature of the machine page, in the colour of their state. A new Temperature tile, the time of the last reading in the Health tile, and an uptime that reads « 4 h 20 min » instead of « 0 h ».
- **The agent first**: on a Linux machine with an agent, the health now comes from the agent (every minute, no SSH connection opened); SSH takes over if the agent goes silent. The first-steps assistant now advises the agent, with a « Which one to choose? » box. Machines › SSH connections tells for each machine whether SSH is still useful (backups, Proxmox or ESXi, NPM, AdGuard) or optional.
- **Easier settings**: on Machines › Agents, each row has the agent's buttons. An SSH connection is set on a page of its own, with a back button and a « + SSH connection » to add one. One settings icon everywhere.
- **The machine page, reworked**: figures on top, a wall of cards in two columns, one list of open ports (from MyServices, MynetworK and Wazuh, with the program behind each port), the reading sources told apart by their logo.
- **History › Events**: figures of the chosen period on top (events, outages, serious ones, returns to normal, the most affected machine).
- **Backups, simpler**: one « Sets » view, one page per set, « By machine » first, and a « To link » page for the backup folders and cron lines no set claims.
- **Fixes**: « Invalid Date » on the page of a machine; Fail2ban said « sudo rule missing » when it was only stopped; New services listed the ports of a tool already set as a connector; the Wazuh connector now says where its API is when given the dashboard's address.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file or your settings. For the Wazuh alerts and vulnerabilities, add the indexer to the Wazuh connector (its guide explains the second, read-only user).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.20.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **New routes**: `GET /api/v1/machines/{ip}/metrics` (24 h of figures of a machine); `GET /api/v1/machines/settings` gives `ssh_uses`.
- **Storage**: the figures of the machines are kept 24 hours in the SQLite base (`metric_samples`, one point every 4 minutes at most). Each host of `health/stats.json` carries its `read_at`.
- **Health sources**: a fresh agent report goes first; an order set by hand for a machine (`health_sources`) still wins.
- **Wazuh connector**: optional `indexer_url`, `indexer_username`, `indexer_password`; reads counts only (`wazuh-alerts-*`, `wazuh-states-vulnerabilities-*`), SCA and syscollector cached an hour, vulnerabilities half an hour; serious alerts from level 13.
- **Development**: Vite waits for a file to be fully written before reading it again.
- **Migration**: nothing to change from 0.20.1, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
