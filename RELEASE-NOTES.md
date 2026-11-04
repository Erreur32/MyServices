# Release notes: MyServices 0.38.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.0** (4 November 2026) stops false « down » alerts for a port an agent sees open but the collector itself can never reach (a browser's own port, a service firewalled to its own machine), and shows where each service line was read from on Home and Services.

## For everyone

**Added**
- **Machine setting, agent's ports → services**: a machine read by an agent gets a new setting (its settings → Options, « Ports de l'agent → services ») choosing whether every open port it reports becomes a followed service (`all`), only the ones the collector itself can reach (`reachable`, the default), or none. A list of program names (e.g. `brave`) can also be ignored whatever the choice.
- **Source badge, Home and Services**: the small « Lu par » badge already shown in History, next to a local service's state, now also appears on Home's « À traiter maintenant » and on the Services page, naming what read it (an agent, SSH, Docker…).

**Fixed**
- **False « down »**: a port an agent's report shows listening, but the collector itself cannot connect to (Windows Firewall, a LAN-only rule…), is now shown up, marked « filtered by the firewall », instead of alerting. Under the new default setting, such a port does not become a service at all, since the collector has never reached it itself.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change.
- **Server**: `services-meta.json` machines gain `agent_ports` (`all` / `reachable` / `none`, absent = `reachable`) and `agent_ignore` (program names); `msv/collect/myservices.py` drops or marks « filtered » the agent-port rows the collector cannot reach, per machine setting.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
