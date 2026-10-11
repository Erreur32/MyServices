# Changelog

All notable changes to MyServices v2 (Docker). One section per published version, newest first. **This file is always written in
English.** For the latest update explained in plain words (in French), see [RELEASE-NOTES.md](RELEASE-NOTES.md).

Versioning: the first pre-releases were called `2.0.0-alpha.N`, `-beta.N` and `-rc.N`. Since the project is still in BETA,
numbering restarts **below 2.0.0** with **0.9.0** (2.0.0 is reserved for a version judged stable). The `:latest` image tag follows the
latest published tag. Images: `ghcr.io/erreur32/myservices` (amd64 and arm64).

## v0.9.0 (2026-10-11): first numbered version (BETA)

> **Testing phase: do not use in production.**

Includes everything from the pre-releases below (alpha, beta, rc.1 to rc.3) and adds:

### Changed
- Settings → Connectors: the **Agents and SSH** sub-tab now comes before **Connectors**.
- Agents: the "MyServices address, as seen from the PC" field is no longer shown at the top of the page. It only appears when
  requesting a new agent ("Install the agent on…" card), prefilled with the address of the page; the browser no longer remembers it. It
  shows again in the "Agent created" card only if the typed address is invalid.
- README rewritten short and in English (French version in `README.fr.md`), with badges and a prominent "do not use in production" notice.
- New logo and icon (`docs/logo.svg`, `docs/icon.svg`, favicon). `.claude/` is no longer tracked.

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
