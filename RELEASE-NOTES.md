# Release notes: MyServices 0.31.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.1** (30 October 2026) adds fifteen Internet box connectors and a Network > Internet box page, fixes the access advice of the setup assistant, and tidies several pages.

## For everyone

**What's new?**
- **Internet boxes.** A new Network > Internet box page shows the line, its rates with 24-hour curves and the system of your box. It reads the Freebox through MynetworK, and fifteen new read-only connectors cover FRITZ!Box, SFR Box, Livebox, Bbox, Vodafone Station, Sagemcom F@st, Swisscom, Telekom Speedport, Compal Connect Box, Technicolor, T-Mobile Home Internet, Hitron, Verizon Fios and Arris, plus any box with UPnP turned on. They were written from public client libraries and checked against saved answers only, not on real boxes yet.
- **Fix.** The access advice of the setup assistant (step 4) no longer fails with an error.
- **Warnings start folded** on every page, one click opens them. The home « To deal with now » frame and the revoked agents start folded too.
- **Machines, card view.** Cards are grouped by hypervisor node, with the node first and its VMs after it. The State, Alerts and Type filters sit beside the search box.
- **Agents.** A « + Agent » button lists the known machines without an agent, the best candidates first, and creates the agent in one click.
- **Ignored domains.** Services > All services has a new panel: a domain or a pattern like `*.lan.mysite.com` is never flagged « public? ». Its probes, certificate and DNS checks go on.
- **Connectors and Virtualization.** Connector cards have a coloured header and footer, and a node shows swap, system disk and I/O wait as gauges.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: new `GET` and `PUT /api/v1/services/public-ignore`; the list is kept as `public_ignore` in `services-meta.json`. No other change.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
