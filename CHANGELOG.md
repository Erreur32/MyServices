# Changelog

All notable changes to MyServices v2 (Docker). One section per published version, newest first. **This file is always written in
English.** For the latest update explained in plain words (in French), see [RELEASE-NOTES.md](RELEASE-NOTES.md).

Versioning: the first pre-releases were called `2.0.0-alpha.N`, `-beta.N` and `-rc.N`. Since the project is still in BETA,
numbering restarts **below 2.0.0** with **0.9.0** (2.0.0 is reserved for a version judged stable). The `:latest` image tag follows the
latest published tag. Images: `ghcr.io/erreur32/myservices` (amd64 and arm64).

## Unreleased (next version, not tagged yet)

> **Testing phase: do not use in production.** Several items below were checked by tests and type-checking only, not yet by eye in a browser.

### Added
- **History page rebuilt**: four chart styles, remembered between visits: **Dots** (one dot per event at its exact time, one lane per family), **Bars** (stacked by family; step from 30 minutes on 24 h up to 3 days on one year; a click limits the list to that range), **Curve** (stacked area) and **Heat map** (weekday × hour). Vertical axis with round integer values and dashed guide lines (horizontal and vertical), same chart height for every style, a new 24 h period, search and filter chips also apply to the chart. Every entry carries badges: event type, detection method (ping, SSH, health, connector, HTTP probe…) and what read it (collection, NPM, Docker, AdGuard, a connector, health sources).
- **Home**: a card with the live date and clock plus the scheduled tasks (collect, watch, health, backups, automatic network search) with the running time or the next run and a countdown (`GET /tasks` now returns `label`, `at`, `next`); the counters are also repeated under each category paragraph (the right-hand column is kept for now); "Last 24 h" is a list, one line per event type.
- **Health page**: Cards or Table view (remembered), machines grouped by access (SSH, Agent, Beszel), a light one-line table with expandable rows ("Expand all"), a foldable "Details" sub-frame on cards, an OS icon and a filter by system and by access. The "Services read through their API" title becomes "Service via API".
- **Machines page**: one line per machine with no horizontal scrolling and an expandable detail in five sections (Identity, System, Access, Software and services, Health), each ending with its **source** (clickable badges linking to the matching setting). Cards or Table view (remembered); OS icon (distribution logo, or the family icon) and abbreviated OS name in the System column (full name in the tooltip); the Servers column shows icons (NPM, Apache, nginx, Docker) with counts in the tooltip; new filters (System, Access, Role).
- **Themed tooltips everywhere**: one component takes over every `title` attribute (hover and keyboard), dark or light with the theme, no duplicate native tooltip.
- **Filter chips** carry a colour dot, a logo or the family colour square (State, System, Source, App, Type…); new filters on Services (App) and History (Method, Read by).
- **Settings → Machines**: the icon choice shows only the icon in use (the auto-detected one when none is chosen); a click opens a panel with search and three families. **118 more icons**: 78 brand logos (systems and services, simple-icons, CC0, brand colour or a neutral grey when unreadable) and 40 object icons, plus five Windows styles (11, 10, classic, Server, monochrome). The machine card header updates as soon as an icon is picked.
- **Backups**: the default folder `/home/backup` is always searched and ticked by default when it exists; "Other locations" (absolute paths or `*` patterns, `PUT /backups/patterns`) to add more.
- **Services**: a dedicated icon column (recognised app, name or image, then Docker/Apache/nginx type).

- **Settings → SSH key** rebuilt: the public key and the authorisation command are **hidden by default** (an eye button shows them; "copy" works while hidden), badges for key type, fingerprint and known machines, a 3-step guide, and the list of machines using the key with their state.
- `scripts/release.py`: one command keeps the version consistent everywhere (`package.json`, lock file, both READMEs, CHANGELOG, release notes). `release.py` alone checks consistency; `release.py patch|minor|X.Y.Z [--dry-run]` applies a version, turns "Unreleased" into the dated section and reopens an empty one. It commits, tags and pushes nothing.

- **Unidentified services, HTTP fingerprint and port guess**: the web probe now keeps a fingerprint of each backend (Server / X-Powered-By headers, header and cookie *names* only, generator meta tag) and 34 more apps are recognised without SSH (Pi-hole, Nextcloud, Gitea, GitLab, Vaultwarden, Traefik, Transmission, Prowlarr, Node-RED, ESPHome, InfluxDB, Vault, Cockpit, OpenWrt, TrueNAS, pfSense…), plus nginx / Caddy / IIS / lighttpd / Kestrel by their `Server` header ("possible" only). A guessed app is no longer counted as unidentified and is shown with its confidence (sure / probable / possible). The favicon is not used.

- **History**: the event type and detection method badges now sit right of the time, before the dot and the service name; the "read by" badge no longer says Docker + Ports for every local service: it follows what really reads the row (Docker, ports over SSH, the agent for a Windows PC, Apache…), and "Collection" when the row has since disappeared.

### Changed
- **Health keeps "often off" PCs**: a PC flagged as often switched off with no fresh report stays in Health as a greyed card ("off (intended)", or "on, waiting for the agent" when it answers ping) with the time of its last agent report, instead of disappearing; no alert and no event. A targeted ping every minute re-reads that machine as soon as its answer changes; every agent report refreshes that machine's card.
- Adding a machine (First steps, SSH test, key authorisation) now reads only that machine's collection and health right away instead of starting a full collection pass (several machines still start a full pass).
- **Windows agent v5**: retries the report for about 6 minutes after a boot (network not ready yet), scheduled task with a 30 s start delay, an extra trigger at logon, and a restart by Windows on failure. Re-install it on the PC to benefit.
- **Unidentified services**: a disabled, paused, switched-off-machine or unreachable-backend row shows its reason instead of "not identified"; when an enabled row's backend stops answering, the **last known identification** is kept and marked "last known".

### Fixed
- The OS name abbreviation handles accented editions ("Édition Familiale" → "Home").

## v0.9.3 (2026-10-11)

> **Testing phase: do not use in production.**

### Changed
- `setup.py --check` ends the connector tests with a summary ("connectors: N/M read") and reports connectors that failed or were stale at the last collection pass (read from `data.json`).
- `setup.py --check`: the SMART sudoers advice no longer breaks when a login banner (fastfetch in `~/.bashrc`) precedes the command output.

### Added
- The header shows the app version next to the title (e.g. `v0.9.2`; `dev` for a local build); `/me` returns it.

## v0.9.2 (2026-10-11)

> **Testing phase: do not use in production.** The new connectors have only been tried against fake servers.

### Added
- **MynetworK connector** (`mynetwork`, kind `network`): reads the LAN inventory (IP, MAC, hostname, vendor, online/offline, ping, open
  ports) and optional UniFi clients and devices through MynetworK's read-only REST API token (`mwk_api_…`, GET only). Routes that MynetworK
  does not expose (UniFi not linked) are skipped, not errors.
- **LogviewR connector** (`logviewr`, kind `security`): fail2ban jails, bans over 24 h, active threats, metrics and log sources through
  LogviewR's MCP endpoint (`POST /mcp`) with a read-only token. Only read tools are ever called; no free text from logs is kept.
- **Dockhand connector** (`dockhand`, kind `containers`): environments, container counters and pending image updates through Dockhand's
  REST API (`dh_…` token, or none when authentication is off).
- **Proxmox VE connector** (`proxmox`, kind `virtualization`): nodes, VMs, LXC containers, storage usage and last vzdump backup through an API token
  (`PVEAPIToken`, role PVEAuditor, read-only). **Proxmox Backup Server connector** (`proxmox-backup`): datastores, usage and age of the last backup
  (`PBSAPIToken`). Self-signed certificates are the default case ("Verify certificate" is off by default).
- Settings → Connectors → Agents and SSH: the four groups (With an agent, Without an agent, Linux read over SSH, No access) fold with a chevron, like the "Agent created" card; empty groups start folded and move to the bottom.
- Agents and SSH: "Revoked agents" becomes a foldable group (folded by default) of cards (who, when, last report), each with a "New agent" button (Windows PC) and a "Delete" button (with confirmation) that removes the revoked agent from the list for good (`DELETE /agents/{id}/purge`, revoked agents only).
- Agents and SSH: more space between the groups.
- Agents and SSH: each agent card (Gamer32…) folds with a chevron, keeping its header (machine, IP, state); it starts folded when the agent is fine (active) and open when something needs attention (silent, waiting for its first report).
- Settings → Connectors: the open sub-tab (Agents and SSH, Connectors, Activation) is remembered across page reloads (it defaults to Agents and SSH).
- Settings → Connectors: a connector that was read shows only the green check (no "OK" text); stale or failed shows its icon and message.
- Fix: connectors of kind `status` (Home Assistant) showed "pas encore lu" (not read yet) in Settings → Connectors although they were read: their state was added to `data.json` after the `connectors` list was copied. They are now read first.
- Icons for MynetworK, LogviewR, Dockhand, Veeam and Web-Check (Proxmox Backup Server reuses the Proxmox one), also selectable as machine icons.
- All of them are proposed when their Docker image, page or port is recognised, and tested against fake servers (`tests/test_connectors_reseau.py`).
- **Where the data shows**: the **Fail2ban tab** now exists and appears as soon as a LogviewR connector is linked (jails, bans in 24 h, active threats,
  latest bans); the **Health tab** gets a "Virtualization and containers" section (Proxmox, Proxmox Backup Server, Dockhand); the **Machines tab**
  shows MAC and vendor under each IP and lists devices seen by MynetworK but not followed. `data.json` gains `network`, `security`, `containers`
  and `virtualization`.

## v0.9.1 (2026-10-11)

> **Testing phase: do not use in production.**

### Changed
- README rewritten short and in English (French version in `README.fr.md`), with badges and a prominent "do not use in production" notice.
- New logo and icon (`docs/logo.svg`, `docs/icon.svg`, favicon). The outdated classic-install documentation was removed.
- `.claude/` is no longer tracked by git.

## v0.9.0 (2026-10-11): first numbered version (BETA)

> **Testing phase: do not use in production.**

Includes everything from the pre-releases below (alpha, beta, rc.1 to rc.3) and adds:

### Changed
- Settings → Connectors: the **Agents and SSH** sub-tab now comes before **Connectors**.
- Agents: the "MyServices address, as seen from the PC" field is no longer shown at the top of the page. It only appears when
  requesting a new agent ("Install the agent on…" card), prefilled with the address of the page; the browser no longer remembers it. It
  shows again in the "Agent created" card only if the typed address is invalid.

## v2.0.0-rc.3 (2026-10-11)

### Added
- **Nginx Proxy Manager connector in three modes**: direct API, API over SSH, or the `npm-api.sh` script. Fields adapted to each mode,
  required fields marked, path check with hints.
- **`npm-api.sh` v3.6.9 installed from MyServices**: SHA-256 fingerprint verified, `npm-api.conf` set to 600, password passed on standard
  input (never as an argument), script run over SSH on the chosen machine.
- Form header with the connector icon; only one form open at a time.

## v2.0.0-rc.2 (2026-10-11)

### Changed
- Docker image: `:latest` follows the latest pushed tag, pre-releases included. Checked for amd64 and arm64.
- README: BETA notice (badge, box on what is still being tested), `-beta.N` then `-rc.N` versioning rule.

## v2.0.0-rc.1 (2026-10-11)

### Added
- **Windows agent** (PowerShell, read-only), versions 2 to 4: system (Windows, build, uptime), listening TCP ports with their process,
  hardware (model, BIOS, CPU, memory, graphics, IPv4 network, domain, last update), shown in the Machines tab and in services. The first
  report, or a reinstall in another version, also triggers a collection.
- **Agents**: clicking a Windows PC prepares the agent and asks for confirmation before creating the token; the command to copy follows
  the "MyServices address" field (token kept in page memory); the "Agent created" card confirms the first report and the detected
  system; the page refreshes itself (5 s while waiting for a report, otherwise 10 s, paused when the browser tab is hidden).
- **Backups**: Veeam wizard (test, job discovery, tracking, encrypted password) and automatic Home Assistant backups.
- **Machines settings**: "Redetect" button (proposed differences, checkboxes, confirmation before writing), machine icon choice
  (applications, systems, objects; Auto by default), "Stop following" on each row of the Machines tab.
- **API v1**: typed read routes built on the common model (`GET machines`, `services`, `health`, `backups`), open to `read` tokens.
- **Merging of health sources** (SSH, agent, Beszel) by a priority settable per machine; common data model (`models.py`), connector
  cache (`ctx.cached`), "untested version" alert.
- **Single-machine refresh**: per-machine inventory cache, `health.py --only <ip>`, `POST machines/settings/<ip>/refresh`, called after
  a setting change, a successful access test or when a machine is added.
- **Home Assistant health**: updates split into core, modules and other devices.
- **Network discovery**: port 5000 identified by its page (Frigate…), name guessed without DNS (NetBIOS, HTTPS certificate), apps
  recognised by their ports (Proxmox VE 8006, Backup Server 8007, Ollama 11434, LM Studio 1234, Veeam 9419/9392/9401, llama.cpp,
  Home Assistant 8123/4357).
- Settings → Connectors as **sub-tabs** (Connectors, Agents and SSH, Activation); Activation as a table; Linux machines read over SSH
  are grouped with their state and a link to their settings, next to the Windows agents.
- CI: test coverage sent to SonarCloud (Python via `coverage`, front via `vitest`); Dependabot without automatic major bumps (Node stays
  on 22 LTS).

### Changed
- Machines: full `authorized_keys` path depending on the chosen account; rejected SSH key: the card tells which account and gives the
  command; a successful access test starts a collection; "Settings → SSH key" is a real link; connection state sits in the Access card,
  first; collapsed "Machine options" menu with active options shown outside.
- Login and files: the redirect destination is read back as a site address (under `/myservices/` only).
- Network discovery: certificate name read with TLS 1.2 minimum.

### Fixed
- Health: an agent report with malformed updates no longer crashes the page (PowerShell 5.1 turns a re-read array into `{value, Count}`).
- Agents: no more error when an agent's machine is not (yet) in the list; only Windows PCs get an agent.
- Network discovery: no more "port 5000" label without a recognised app.
- API 422 errors no longer echo the submitted value.

## v2.0.0-beta.1 (2026-10-10)

### Added
- First "beta" release (real GitHub release, image `2.0.0-beta.1` for amd64 and arm64).
- Machines: "Virtual machine" ticks itself when detection finds one (once per machine).

## v2.0.0-alpha.4 (2026-10-10)

### Added
- Weekly Dependabot (pip, npm, Docker, Actions, grouped); Code scanning enabled.
- Machines: the SSH access text moves into the "Add a machine" card.

### Changed
- SonarCloud: sources without duplicates, tests removed from sources.

## v2.0.0-alpha.3 (2026-10-10)

### Added
- **MyServices agent (Windows, no SSH)**: `msv_agent_` token bound to a machine, report-receiving route, merged into health;
  `agent.ps1` and `install.ps1` served by MyServices; Settings → Agents; health started on the first report.
- **Health over SSH**: CPU temperature (`k10temp`, `coretemp`, `cpu_thermal`, thresholds 85 / 95 °C), "VM" badge without sensors, CPU,
  memory and swap usage (read from `/proc`), bars in the detail card, CPU and Memory columns in Machines, memory alert at 90 / 97 %.
- **Profile** for every account: password, open sessions, sign out other devices, configurable session length (admin).
- **Audit log** with filters by type and by account, CSV export.
- **Network discovery**: networks of your choice (several /24), discreet mode (no TTL or MAC), ignored devices with "Resume".
- **Machines**: "Followed machine" switch (off: no ping, SSH, health or alert), SSH access as an Active / Inactive switch, icon of the
  detected system or hosted application (Proxmox, Home Assistant…), SSH access guide for Windows (OpenSSH, key, account) and Linux
  (key authorization command), "Unfinished" badge, gateway / NPM / VM ticked from detection.
- **Backups**: backup folder discovery over SSH and tracking from the page.
- **Home**: "Machines" counter group (SSH OK, to set up, off, unreachable) and warnings.
- **Tasks and schedules**: "Machine health" switch with an explanation when a task is off.
- **Connectors**: "+ Add" as mini cards, access and activation in two parts, "Read over SSH" card.

### Changed
- Settings reorganised in four groups (Monitoring, Access and security…); "Network search" became "Discovery"; "System" became
  "Backup and info"; the Sources section is gone (the display switch lives in the connector card).
- Missing Docker is no longer a failure ("no Docker on this machine"); port 139 alone no longer says "Windows".
- Demo screenshot removed from the repository.

### Fixed
- A login banner (fastfetch in `~/.bashrc`) no longer skews the reading of a Linux machine over SSH.
- Favicon: path under `/myservices/v2/` (the old path was doubled).

## v2.0.0-alpha.2 (2026-10-10)

### Added
- **Getting started** ("Premiers pas"): first-start wizard with network search, machine choice, SSH offered, Home Assistant through its
  REST API (token announced from the list), "Skip" button on each step, automatic scan, "Suggested connectors", icons of recognised
  applications, host machine detected with its Docker services.
- "Known app" table: recognises services and proposes connectors.
- Network scan: probable system (Windows, Linux, macOS, iPhone, network gear) from SSH banner, ports, TTL and MAC.
- UniFi: to be read later through the MynetworK API, SSH optional.

### Changed
- Home Assistant: a 5xx error names the path involved and points to the logs.

## v2.0.0-alpha.1 (2026-10-10)

### Added
- **MyServices v2**: Docker version (a single container: collection, watcher, health, backups), connectors, new front end
  (`/myservices/v2/`), "Getting started" card, scan bar. The old v1 page is removed from this branch.
- CI: a pre-release (`-alpha`, `-beta`, `-rc`) never published `latest` (rule changed in rc.2).

### Fixed
- Front-end Dependabot alerts (vitest 4, postcss-selector-parser 7).
