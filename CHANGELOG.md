# Changelog

All notable changes to MyServices v2 (Docker). One section per published version, newest first. **This file is always written in
English.** For the latest update explained in plain words (in French), see [RELEASE-NOTES.md](RELEASE-NOTES.md).

Versioning: the first pre-releases were called `2.0.0-alpha.N`, `-beta.N` and `-rc.N`. Since the project is still in BETA,
numbering restarts **below 2.0.0** with **0.9.0** (2.0.0 is reserved for a version judged stable). The `:latest` image tag follows the
latest published tag. Images: `ghcr.io/erreur32/myservices` (amd64 and arm64).

## Unreleased (next version, not tagged yet)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Beszel connector: « Verify HTTPS certificate » setting (on by default), to reach a hub behind a self-signed certificate.
- Connectors: « Save without collection » button, to set up a service that is down or not ready yet: settings kept, no test,
  collection off.

### Changed

- Connectors: the collection is never switched on with untested settings. Saving tests the saved settings first: when the test
  fails, they are kept but the collection stays off, with the reason. Switching the collection on runs the same test and is refused
  when it fails.
- Beszel connector: the account field asks for the e-mail (the hub signs in by e-mail only); a user name gets a clear message.
- Forms: the red « * » (required field) stays on the same line as its label.

## v0.11.10 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Freebox through MynetworK: « Active devices » no longer reads « 1/127 » behind another router (the Freebox keeps every device it
  ever saw): it shows the active ones and the rest as history. The fan speed is shown, and the internal disk when it is not active.
- MynetworK 0.10.68+ (read as soon as it answers, nothing changes before): the UniFi system summary
  (`/api/plugins/unifi/system`) gives the gateway its LAN address (it is matched to its machine by that address), its temperature,
  memory size and firmware update, and the versions of UniFi OS and of the UniFi Network application with its update waiting
  (« System » of the gateway; both updates in its updates list and arrow). Only the fields named are kept. The Freebox card shows
  the firmware update it offers (`latest_firmware`, `update_available`).
- Freebox as a machine: a followed machine whose name contains « Freebox » (no SSH) takes the Freebox read by MynetworK, which gives
  no address for it: its health (line up, temperatures), model, line and firmware, and the firmware update it offers. The
  « Freebox Player » is never matched.

### Fixed

- MynetworK: an optional route answering 503 (UniFi not plugged in: `UNIFI_UNAVAILABLE`) is read as « no UniFi » like 403 and 404,
  instead of failing the whole MynetworK reading (scanner and Freebox included).

## v0.11.9 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Settings → Updates (Application group): the version installed and the latest published on GitHub with its notes, « Check
  now », an automatic check (the scheduler asks at most every 6 h, one anonymous request; `update_check`) and the notice in the
  header (`update_header`). The header shows a « vX.Y.Z available » pill that opens this page; its cross hides it for that
  version only.

### Changed

- Machines and Health in card view: compact cards, one more column on wide screens. Each card shows who it is (icon, name, IP,
  state), the system and uptime, a strip of figures (services, CPU, memory, fullest disk) and, for machines, the servers and what to
  watch; a coloured left edge marks a machine to look at. Health cards list the first three problems, the rest under « Details ».

- Home Assistant: the add-ons installed are listed with their icon and version (an update waiting in orange), on its card and in
  the unfolded detail of its machine. Read from the update entities, so no admin right is needed; the icons are read by the server
  with the token (`GET /api/v1/ha/<instance>/addon-icon/<slug>`) and kept a week in the cache.
  Folded, the list shows its first seven icons and « +N » for the others.
- Machines, card view: « Details » unfolds a card on the same full detail as the table (identity, system, access, software, health),
  the card then taking the whole row; both details start with « See its services » (the Services tab filtered on the machine). The
  card of the Home Assistant machine shows its add-on icons and « +N » on its servers line (instead of a lone « - »).
- Machines: the updates waiting have their own « Updates » part in the detail (card or table), the list folded by default: the apt packages with their new
  version on Linux, the Windows updates for a PC with the agent, up to 30 named (the count stays exact beyond). A folded card
  shows an orange arrow with their number (and the reboot sign), names on hover.
- Machines, card view: opening a card closes the one open before.
- Machines and Health tables: CPU, memory and disk are meters of the same width in every row (value, then a thin bar; the memory
  size and the fullest disk next to the value). The services column shows the count and, when some are down, a red count whose
  tooltip lists them with their problem (instead of « · 1 down »).
- Machines table, health column: a machine without health says why, « off » (switched off on purpose), « offline » (no ping) or
  « not followed » (no SSH, agent, Beszel or Home Assistant), or « waiting for its reading » when it has a health source but the
  Health task has not read it yet, instead of « not applicable ».
- Machines seen by one of the tools (MynetworK, UniFi, Beszel, Proxmox…) without SSH: state « via MynetworK » (the tool named)
  instead of « online, no SSH ». A UniFi device relayed by MynetworK (the gateway too, matched as the machine set as gateway)
  gives its health (OK, busy at 90 % CPU or memory, down when not connected), its CPU and memory meters, its uptime, and its model
  and firmware on the card and in « System »; its update waiting is shown when MynetworK passes it on.
- Home: the schedule box lines up (task, time, countdown in columns, soonest first, « in 2 h 58 » past an hour), styled like the
  counters above it; its title opens Tasks and schedules.
- Home Assistant machine: its system is read from Home Assistant (installation method, Core, Supervisor and Operating System
  versions) and shown in « System » and on its card, where it was empty.
- Machines, table view: the « Expand all » button is gone.
- Virtualization: each node is its own section with its gauges (CPU, RAM) on a fixed grid, its storage gauges in aligned columns
  and its own guests under it (a host without nodes, or ESXi datastores, get one section); the totals moved to the title line,
  and a running guest shows its CPU as a gauge like its memory.

### Fixed

- Home Assistant: a HACS card whose update entity starts with « home_assistant_ » (plant…) was taken for Home Assistant itself.
- Health: the machines that are off follow the search like the others (accents and case ignored) and the « System » and « Access »
  filters, instead of disappearing as soon as any filter was on.
- Health: with « Hide the machines without trouble » on and every machine fine, the page said nothing (the table or cards looked
  broken); it now says so, with a « Show them » button.

## v0.11.8 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Dev image header: the release in prod, the git branch and commit it was built from (with the commits since the last tag and
  uncommitted changes) and the planned version. `scripts/git-rev.sh` gives the git state, `scripts/dev.sh --build` passes it.

### Security

- SonarCloud and CodeQL review of the blocker and critical findings. Fixed: the SSH account of a machine found on the network is
  checked with a full match (`$` let a final newline through into the SSH config), the Proxmox VM id of a crontab read through the
  guest agent must be digits and its alias may not start with « - », the UrBackup login marks its MD5 as protocol-only
  (`usedforsecurity=False`). Reviewed and marked `NOSONAR` with the reason: file writes whose path comes from the config or the
  environment (never from a request), the self-signed certificate option chosen per connector, the container listening on all
  interfaces, a same-site redirect, a JSON answer seen as HTML, a slice seen as an index.
- Front: buttons get an explicit `type`, the alert days are sorted as numbers.
- SonarCloud: each analysis now carries the project version, so the Quality Gate judges the code changed since the last release
  instead of the whole project counted as new; the Windows agent (PowerShell) and the old static page are left out of coverage.
  Command-line tools (import, map) marked for the paths their operator types; `scripts/dev.sh` uses `[[`.
- SonarCloud coverage: the React screens (tabs, components) are left out of coverage on purpose, the logic (Python, `front/src/lib`)
  stays measured; new tests for the import command end to end, the Proxmox crontab guards and the commit guard placeholders. Plain
  http to the apps of the LAN is declared once, for the connectors and install tools (rule S5332), instead of 104 findings.

## v0.11.7 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- « Forget » and « Recall » everywhere something is suggested: apps to link and other suggestions in Discovery (forgotten ones
  leave every list for a folded « Forgotten » frame at the bottom, with « Recall »), detected services in Connectors (« Forget »
  next to « Activate », a « Forgotten » line with « Recall »; one choice shared with Discovery), and the machines found on the
  network (« Forget » / « Recall » instead of an eye icon and « Resume »). Replaces « Don't remind me again ».
- Discovery → machines found: « Skip » on a machine whose access is not set becomes « Forget », kept on the server (no longer in
  the browser only): the frame goes away for good, its « SSH key to authorise » reminder too, and « Recall » in « machines already
  added » brings it back. The orange « accesses skipped » banner is gone.
- Discovery → « What runs by itself »: one aligned row per item (icon, what it is, mode, last and next time, button).
- Apps found in Docker over SSH carry their container state (`docker ps -a` lists stopped ones too): a running container wins over
  a stopped one for the same app on a machine, a stopped one is no longer suggested (Discovery shows it folded under « Stopped
  containers »), and the detected services in Connectors have a « State » column (running first, stopped dimmed).
- « What runs by itself » merged into Settings → Tasks and schedules: each task now says what it also finds (collection: services
  and ports, new services, apps to link; network search: network machines; backups: backup cron jobs), and only the searches no
  schedule covers stay in a frame of their own, « By hand or once » (redetect the machines, /home/backup once, other backup
  folders), one clean row each.
- The network search settings left Discovery for good: frequency, networks to search and discreet mode are all on the
  « Network search » row of Settings → Tasks and schedules. Discovery keeps a « Search settings » button to it.
- Discovery: « Apps to link » is a folding frame (open by default).
- Discovery → machines found: the scan summary fits in two lines, the scan and what changed since the one before, then the tags.

### Fixed

- Settings followed a link to another of its sections only when opened: a link from one section to another (Discovery to Tasks
  and schedules) did nothing. It follows the address now.
- Discovery: « Forget » (and « Recall ») now shows at once, without reloading the page. A reload asked while another one was under
  way was dropped, so the page kept the old answer.

## v0.11.6 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Connectors: « Already read over SSH » moved just under « Detected services not set up », folded by default.
- Settings → Discovery redone as one page read from top to bottom, without sub-tabs nor colored frames inside colored frames:
  a header (state in one line, automatic mode switch, network search with its last and next run and « Search now »), « To do »
  when there is something, the machines found on the network (folded), the apps to link as tiles in alphabetical order, other
  suggestions, what runs by itself (folded), and the search settings (frequency, networks, discreet mode) in one frame.
- Settings → Backups: after « Search my machines », each machine is folded, its summary giving the folders found, those already
  followed and those ticked.
- Settings → Backups: each followed backup is folded by default; its title keeps the alert threshold, the « off-machine copy
  required » switch and « Remove », so the common changes need no unfolding.
- Settings → Tasks and schedules redone: one row per task with its icon and what it does, the schedule checked while typing and
  written in plain words (« every hour, at :10, :40 »), a « Next run » column (time and countdown), and « Run now » instead of
  « Run » / « Run again ». The network search is listed too, its frequency editable here (the same setting as Discovery) and
  runnable. The header tells whether the scheduler is alive (like a crontab: last turn under 90 s), how many tasks are active
  and how many failed. The health switch now says « on » or « off ».
- Tasks: the last run of each task is kept in `tasks-last.json` (state folder), so a restart of the container no longer shows
  every task as « not run yet ».

### Fixed

- The server module was loaded twice (once as the started script, once by `import server` in the API): the scheduler ran in one
  copy and the pages read the other, so the tasks page never saw the scheduled runs, and a run started from the page did not share
  the scheduler lock. One module now, under both names. When the scheduler is really stopped, the tasks page says so in a red
  note with what to do (restart the container, then look at the logs).

- Settings → Machines → SSH & Agents: machine icons now use the machine's role and chosen icon, like the Machines tab (the UniFi
  gateway had no logo there).

## v0.11.5 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Connectors for AI services: Hermes Agent (version, gateway and its platforms, no key), Ollama (version, installed and loaded
  models, GPU memory) and llama.cpp (build, model, context, slots); recognized on the machines, with their icons.
- Connector picker: a search field.
- AdGuard Home is a full connector: added from the Connectors page, read by its API (account of its web interface) or over SSH
  (AdGuardHome.yaml), the DNS server address taken from the interface address. The AdGuards a machine already declares are listed
  under « Already read over SSH », with their state and version: nothing to add for them. Hypervisors read over SSH (Proxmox
  by pvesh, ESXi, KVM, Incus, VirtualBox) are listed there too, and the picker says « already read over SSH » on their card.
- Dozzle tagged « Docker · logs ».
- « Detected services not set up » no longer proposes what is already covered: a service read over SSH (Proxmox by pvesh: its
  connector would read the same), a connector whose address is a name served by NPM, and the other Dozzle servers once one is set
  (one Dozzle shows the logs of every host).

### Changed

- « My connectors » sorted alphabetically, like the picker.
- The machine's own SSH (OpenSSH) is no longer proposed in « New services on the machines »: it is followed with the machine.
- Icons drawn only in black (Hermes Agent, Rybbit, Umami, VictoriaMetrics, Wallabag) turn white on the dark theme.

### Fixed

- AdGuard Home read over SSH shows its version (label of its container image).
- Dozzle card shows how many containers got a « logs » link.

### Fixed

- App version on more connector cards: when the API gives none, the version of the container behind the connector address
  (image label, found over SSH) is shown (Web-Check, Dozzle…). Dozzle also reads its version from its own page.
- Dockhand card shows its version, taken from the changelog bundled with each Dockhand build (`/api/changelog`, first entry):
  Dockhand has no version route.
- Dozzle connector card had no state: Dozzle is now checked at each collection (reachable, version).
- A connector not read yet shows when the next collection runs (« next collection at 09:10 (in 4 min) »), or that it is running.

## v0.11.4 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- MynetworK card shows the app version (read from `/api/health`, given since MynetworK 0.10.67).
- LogviewR version was always marked « not tested » (orange): its tested prefix « 0. » never matched. Prefixes ending with a
  dot now match like the others.

## v0.11.3 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Connectors: the « add » picker is sorted alphabetically, with one filter chip per category (Monitoring, Media, Network / DNS,
  Backups…) and its count.
- Home page: « New services on the machines ». Containers and processes that appeared in the last 7 days are proposed:
  Follow (nothing changes, no longer proposed) or Don't follow (paused: no probe, no alert). A paused service shows why in its
  detail in Services, with a « Resume following » button.

### Fixed

- Changes show at once: after any change the page reads its data again, then every 5 seconds for 2 minutes 30 so the collection
  it starts shows up when it ends. The connector list also reads again when a collection ends. No more F5.
- Deleting a connector while its form was open left « Add a connector » greyed out.

## v0.11.2 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Health tab shows only the machines that need a look, under a one-line summary (« 2 machine(s) to look at: nas (disk /data
  91 % full), … » or « 12 machine(s), all healthy »). One click shows the healthy ones too (choice kept in the browser); a search
  or a filter always shows everything it finds.

## v0.11.1 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Connectors: editing a connector could send an old token back. Browsers filled the token field with a remembered value;
  secret fields now refuse browser and password manager autofill.
- Connector cards show the app version for every connector that reports one (most status connectors found it but never
  showed it). LogviewR no longer shows « 1.0.0 », the fixed version of its MCP server, and NUT no longer shows the UPS model
  as a version (now a « Model » line).

### Changed

- Editing a connector happens inside its card: no inner blue frame, no second logo and title.

## v0.11.0 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Network tab**, shown only when a network source answers: summary tiles; Internet access and gateways (Freebox card and a
  UniFi card: gateway, version, uptime, equipment online, Wi-Fi and wired clients, updates, built from MynetworK alone or from
  the UniFi connector); network equipment; clients per access point or switch; devices of the network. Same search and filters
  as the other tabs (type, state, followed, access point or switch, vendor, source). Freebox and UniFi cards move there from Health.
- Status connectors: Pulse, Arcane, Glances, GpuViewR (its read-only API, `gvk_` token; its favicon as logo), Speedtest Tracker,
  NetAlertX, Wazuh, Umami, Rybbit, Tautulli, Webmin (version only), qBittorrent, Transmission, Bazarr, Overseerr / Jellyseerr;
  Whisparr in the *arr connector.
- Backups shown as status cards: Backrest, borgmatic (over SSH), UrBackup, Veeam Backup for Microsoft 365; Synology Hyper Backup;
  TrueNAS replications and cloud sync. The Windows agent (version 7) reads Veeam Agent and Windows Server Backup.
- Virtualization: Unraid and Proxmox Datacenter Manager connectors; KVM / libvirt, Incus / LXD and VirtualBox read over SSH when
  found on a machine; Hyper-V read by the Windows agent; TrueNAS SCALE VMs and apps; Synology Virtual Machine Manager.
- Known apps: agents (Dozzle, Beszel, Arcane, Hawser, Portainer, Pulse, GpuViewR, Wazuh, Zabbix, Checkmk, Komodo…) have no page
  and never propose a connector; the service sheet says which hub they report to. The Dozzle agent shares the Dozzle image and is
  told apart by its container port. Processes read over SSH are recognized by name. About forty more apps and their icons.
- History: an "Event" filter; fail2ban threats, connectors back within an hour and devices found by the scan are hidden by default
  (kept in the browser, one click shows them); the list groups the threats of a day per jail and the outages of a connector.

### Changed

- Home Assistant card in Health redone: state and core update at the top, gauges of the host machine (System Monitor), entities,
  unavailable entities and automations on, folded lists of low batteries, unavailable entities and updates.
- Saving or switching on a connector runs the collection at once; the page says "being read again" instead of keeping the error
  of the old settings until the next run (a saved token looked refused for up to 30 minutes).
- App categories all exist in the default list (`IA / LLM` and `Sauvegardes` did not).

## v0.10.25 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- UniFi Network connector, two ways in: an API key on a UniFi OS console (UCG, UDM, UX, Cloud Key, UniFi OS Server), or a
  read-only local account on the self-hosted controller (Docker, port 8443), which has no API key. It reports devices online or
  not, devices with a firmware update and the client count. A detected UniFi container proposes the local account mode.
- UniFi clients and devices read by this connector feed the matching layer (IP, MAC), without MynetworK; a machine seen by both
  keeps a single UniFi badge.
- "Freebox (via MynetworK)" card in Health: the MynetworK connector also reads the Freebox it relays (active LAN hosts; line
  state, rates, temperature and uptime once MynetworK serves `/api/connection/summary`). No card when MynetworK has no Freebox.

## v0.10.24 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Icons for the Healthchecks, CrowdSec, Technitium DNS and NUT (UPS) connectors (Settings -> Connectors, Health cards), also
  offered for machines, with Nextcloud.

## v0.10.23 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Alert "Nextcloud to look at": once when a point appears (Nextcloud or app update, public links without password, free space
  under 10 GiB, debug mode), not when its figures change; the first reading is the reference. New example rule "Nextcloud
  (updates, public links, space)".

### Changed

- Health no longer shows the Proxmox, ESXi, vCenter and Proxmox Backup cards: they are in the Virtualization tab. Health keeps
  Dockhand and the services read through their API.

## v0.10.22 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Security tab, replacing the Fail2ban tab (the old #fail2ban link opens it), read only, no exposure score: summary tiles (bans
  over 24 h, active threats, public sites to harden, machines with SSH root or password login, devices with a sensitive port);
  Fail2ban with LogviewR's active threats in detail (one IP across jails, or a campaign from one AS: IPs, jails, bans); sites
  exposed to the Internet (active NPM hosts without an access list) with what is missing (HTTPS not forced, no HSTS, Block
  exploits off, certificate soon expired, weak security headers); certificates (moved here from History -> Availability); SSH
  access of each machine (PermitRootLogin, PasswordAuthentication, refused logins over 24 h); sensitive ports seen by MynetworK.
- Alert "new threat" (LogviewR), once per cluster, the first reading taken as the reference; in the security example rules.
  LogviewR's threats are kept with safe fields only (IPs, jails, numbers, AS number; no whois text).

### Fixed

- sshd values read with "(défaut)" appended ("prohibit-password (défaut)", the safe default) were shown as risky.

## v0.10.21 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- LogviewR: connecting with a token failed with "f2b_get_active_threats : unreadable answer". That tool answers with an
  "UNTRUSTED DATA" notice, then the JSON in a second block; the connector read only the first. It now takes the first block
  that parses as JSON.
- Auto mode: a machine removed by hand in Settings -> Machines came back at the next network search unless the auto mode had
  added it. Removing a machine now also puts it in the ignored list of Settings -> Discovery (one click brings it back).

### Changed

- Settings -> Machines hides the machines whose "Followed machine" switch is off, like the Machines tab; a "Not followed (N)"
  button shows them.

## v0.10.20 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Virtualization tab: Dockhand cards were shown under "Proxmox backups and containers" (and the tab appeared with Dockhand
  alone), meaningless on a setup with a vCenter and no Proxmox. Dockhand manages Docker only: its cards stay in Health. The tab
  shows only with a hypervisor (Proxmox, ESXi, vCenter) or a Proxmox Backup Server; a VM's own Docker containers stay in its row.

## v0.10.19 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Appearance (theme, header logo, language, page width) moved from Settings -> Application to the user profile, so read-only
  accounts can set it too; the old #settings/look link opens the profile. Wider profile page: password and sessions on the
  left, appearance on the right on large screens.

## v0.10.18 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Check (Settings -> Machines) warned "docker inaccessible ... usermod -aG docker" on VMware ESXi and on hosts without Docker,
  while the collection showed them fine. When SSH works but docker ps fails, the check now asks the host: ESXi is said as such
  (no Docker is normal, its VMs are read by vim-cmd), a host without Docker is fine, and only a refused docker gets the group
  advice. The machine card shows "no Docker" in grey instead of a green tick.
- SSH errors name their cause: connection refused (SSH server off, with where to turn it on for ESXi), host unreachable, too
  many keys tried, no common algorithm, connection closed by the host.

## v0.10.17 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- nextcloud connector, read only, through the monitoring route of the serverinfo app shipped with Nextcloud, with the token of
  that app (`occ config:app:set serverinfo token --value <token>`, sent as NC-Token): no account is given to MyServices. Status
  card in Health: version and the newer one, active users over 24 h, files, free space, database, PHP, apps and their updates,
  public links. To look at: Nextcloud or app updates, public links without password, free space under 10 GiB, debug mode. A
  Nextcloud container found on a machine proposes the connector. Tested against a fake server only.

## v0.10.16 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- VMware ESXi refused the app's SSH key even at the right place: ESXi 8 runs sshd in FIPS mode and refuses ed25519 keys. The app
  now also has an ECDSA P-256 key (created once at start-up), offered after the ed25519 one by every SSH alias it writes (older
  aliases updated at start-up, others untouched). The command to authorize the key for root puts the ECDSA key in
  /etc/ssh/keys-root/authorized_keys on ESXi; Settings -> SSH key shows it too.

## v0.10.15 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- History tab, Availability view (switch Events / Availability, choice kept): uptime of each service (backend answers),
  followed machine (ping) and Uptime Kuma monitor, sampled at each collection; 24 h, 7, 30 or 90 days, one coloured cell per
  hour or per day, mean response time, worst first, filters by type, uptime band and machine, average per type. Below, the
  certificates read by Web-Check and Uptime Kuma, closest to expiry first. Things off on purpose (disabled, paused, machine
  off, Kuma maintenance) are not counted as downtime; a service whose machine is down is counted once, on the machine.
- availability.py and GET /api/v1/availability?days=N: samples kept 14 days, a daily roll-up kept a year, older rows purged at
  each collection.

### Changed

- Machines table: the badges of the tools that see a machine are no longer in the folded Machine column (there can be many);
  they stay in the unfolded detail ("Seen by").

### Fixed

- The command to authorize the app's key for root now works on VMware ESXi: ESXi ignores ~/.ssh/authorized_keys and reads
  /etc/ssh/keys-root/authorized_keys. The single command detects ESXi, writes there without touching the file's mode (what keeps
  it across reboots) and saves it at once with auto-backup.sh; elsewhere it writes /root/.ssh as before.

## v0.10.14 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Virtualization tab (shown when a hypervisor or Dockhand is there): each host with its CPU, memory and storages, and a table of
  its VMs and containers: state, resources, uptime, the followed machine they are, the age of their followed vzdump backup and
  their Docker containers (SSH count, Dockhand environment and pending image updates). Proxmox Backup Server and Dockhand cards
  below.
- Proxmox VE read by SSH (pvesh, read only) at each collection, without an API token; a host already read by the proxmox
  connector is left to it.
- VMware ESXi read by SSH (vim-cmd and esxcli, read only): host CPU and memory, datastores, each VM with its guest OS and the IP
  and hostname given by VMware Tools. Its health skips the Linux checks. The SSH guide gives the command for root's key on ESXi.
- vcenter connector (REST API, Read-only account; vCenter 7 U2+ and the older /rest API of 6.7 / 7.0): hosts, VMs per host,
  guest identity, datastores. The session is closed after each reading. An ESXi already listed by a vCenter is not read twice.
- Backups: Proxmox VE dumps (vzdump without Proxmox Backup Server) followed per VM or container, in Settings -> Backups. The
  dump folders of the backup storages are found by SSH; .log and .notes files are left aside; a dump on a network storage
  counts as off the machine; copies made by rsync to a NAS are declared or found with "Find the copies".
- Machines tab: a Follow button on each device seen by MynetworK and not followed; the detail shows its open ports, first and
  last sighting and ping.
- Alerts: "new device on the network" (MynetworK, keyed by MAC, the first reading taken as the reference), "VM or container
  stopped" / started again and "storage nearly full" (90 %), confirmed on two runs. Added to the inventory and offline
  example rules of new installs.
- Icons: VMware ESXi, vCenter, Free, Freebox, Western Digital, a NAS icon (instead of a plain drive), Plex redrawn.

### Fixed

- Settings -> Machines: a role tag added or removed showed again the old tags after closing the card or changing tab, until the
  next collection or a page reload. The server now publishes the name and tags at once and the page re-reads them.

## v0.10.13 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Auto mode (on by default), one switch in Settings -> Discovery and at the end of the first steps: after each network search,
  machines worth following (SSH, recognised app or useful service) are added by themselves, then collected; SSH turns on by
  itself when the key works. A machine added this way and removed by hand is never added again. Manual mode adds nothing.
  Turning it on also turns the automatic network search and the /home/backup follow-up back on.

### Changed

- SSH access shown as in the first version of the page, on one line: SSH logo, account, IP and port pills (port filled when not
  22). Machines tab column (alias in the unfolded detail), machine card and its SSH frame in Settings -> Machines.
- Machines tab, unfolded detail: each section (identity, system, access, software, health) has its own colour band, tint and
  tinted label column.
- Services and Health, unfolded detail: the same coloured sections as Machines (shared component), the health source in the
  title band.
- Machines, Services and Health: an unfolded row or card gets a full blue frame.
- Settings menu: a category frame glows blue on hover instead of losing its border; the grey card border no longer
  vanishes on hover for frames without a hover colour of their own.
- Machines tab, Servers column: two icons at most, then a "+N" pill; all of them in the unfolded detail.
- Settings -> Machines: a refused save shows its reason next to the field instead of only at the bottom of the card.

### Fixed

- A machine left without any role tag made the collection fail.

## v0.10.12 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Grey border on uncoloured cards on every page (Home, Machines, Services, Health, DNS, History, Fail2ban, Profile), set once
  for the whole app; cards with a coloured status stripe keep their colour.

## v0.10.11 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Task scripts run by hand switch to the app account**: `myservices.py`, `health.py`, `watcher.py` and `backups.py` started with `docker compose exec` (as root since 0.10.6) now drop to the account 10001 like `setup.py` and `manage.py`, so they use the app's SSH configuration and leave no root-owned file in `/data`.
- **Grey border on cards without a colour of their own**, as in Settings, now also on the Diagrams and Backups pages (one shared rule, `GREY_CARDS`).

## v0.10.10 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed
- **SSH switch turned on by itself when the key works**: a machine whose switch was never set, with an access for its address in the SSH configuration and a successful key login during the collection, gets its SSH access saved by itself (log line "SSH activé tout seul…"). Turning the switch off is now kept as an explicit choice (`ssh: false`): the machine is then no longer read over SSH at all (before, the collection kept reading it with the alias found in the SSH configuration), and it is never turned on again by itself.
- **SSH & Agents put a machine read over SSH under "No access: to set"** when its switch was off but the collection still read it (badge "SSH OK"). Groups now follow what the collection really does; the machine page explains that the switch will turn on at the next run, with "Turn on now".

## v0.10.9 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Settings → Connectors**: the form being filled (new connector or edit) has a blue frame, and so does the card being edited; the cards of the "Add a connector" list get a grey border and a darker background for contrast, and the cards of the connectors already set get the same grey border.
- **Settings → Machines**: same look: each machine card has a grey border, and a blue frame while it is open; the forms to add machines have the blue frame of the connector form. The frames inside a machine (SSH access, identity, option groups) and the cards of SSH & Agents get the same grey border; the card being opened is framed in blue.
- **Settings → Machines → SSH & Agents**: empty categories are no longer shown.
- **Settings, every page**: each card or frame without a colour of its own (neutral border) now has the same grey border, for contrast; coloured ones (ok, warning, error, blue) are unchanged, and the hover colour still applies.

## v0.10.8 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed
- **"Authorize the key" command** (Getting started, Discovery, Settings -> Machines, adding a machine): it now targets the real folder of the chosen account (`/root/.ssh` or `/home/<account>/.ssh`), creates `.ssh` when missing, adds the key only once, and gives `.ssh` back to the account with modes 700 / 600. It can be run as root for another account: before, a key written by root was left owned by root, and sshd refused it.
- **Settings → Machines → SSH & Agents**: a machine already read by a connector's API (Home Assistant…) is no longer listed under "No access: to set" with an SSH warning; it has its own group, "Read by their API, without SSH". Every card now shows the same access badge as the Machines tab (SSH OK, Agent active, API, SSH refused, online without SSH…).
- **Settings → Connectors, "Detected services not configured"**: now a folded frame, marked optional (blue, not orange), like the suggestions of the Discovery page: open it when you want to link those apps.

## v0.10.7 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Settings → Logs** (Application group, before Help): what the container prints (the same text as `docker compose logs myservices`): the server and the output of each task, since the container started, last 3000 lines. Filter by origin (server, collection, watch, health, backups), errors and warnings only, text search; follows new lines every 5 s (pause on scroll), download as `.txt`. Route `GET /api/v1/system/logs?after=N` (admin). `applog.py` keeps the lines in memory; nothing is written to disk.
- **Eye on secret fields** (passwords, tokens of connectors, also when opened from a machine; NPM script and Veeam passwords): shows what is typed. For a value already saved (never sent to the page), the eye asks the account password, then fetches it: `POST /api/v1/connectors/settings/{type}/{name}/reveal` (admin session, password checked with the same failure limit as sign-in, recorded as "secret affiché" in the audit log).

### Fixed
- **Network search found 0 device on some hosts**: where unprivileged ping is turned off (`net.ipv4.ping_group_range` = `1 0`, the kernel default kept by some NAS and distributions), ping was refused to the app and every address looked down, with no message. The app now keeps `NET_RAW` alone (and nothing else) when the compose gives it: add `NET_RAW` to `cap_add` (done in `deploy/compose.example.yaml`). Without it, the search now says why instead of showing 0 device.

## v0.10.6 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **No more exited `init` container**: the image now has an entrypoint (`deploy/entrypoint.sh`). Started as root (`user: "0:0"` in the example compose), it gives `/config` and `/data` to the account 10001, locks `/config` (700 / 600), then runs the app as 10001 through `setpriv`, with no capability left. The example compose drops the `init` (busybox) service and adds only `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID` for that start. `setup.py` and `manage.py` run through `docker compose exec` switch to 10001 the same way, so what they write stays readable by the app. **To update an existing install**: remove the `init` service and its `depends_on`, add `user: "0:0"` and the `cap_add` line from `deploy/compose.example.yaml`, then `docker compose up -d --remove-orphans`. An unchanged compose keeps working (the image still defaults to 10001).
- **Example compose rewritten** (`deploy/compose.example.yaml`): English only, one service, shorter comments, the test-phase warning on top, and the `MYSERVICES_NETSCAN_EVERY` setting listed.

## v0.10.5 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Discovery page (Settings → Discovery)**: what is needed is now kept apart from what is optional. "To do" only lists what MyServices needs to see everything (a refused SSH key, an agent never installed, a late collection); connectors to link, hosts found but not followed and backup folders never searched become "Suggestions (optional)", shown as compact rows; automatic items are folded at the bottom. A one-line summary sits at the top, and family tabs show the to-do count in orange or the suggestion count in blue. The API returns a `suggest` count next to `todo`.
- **Header bell**: opens a panel listing what is still to do, each with its button, then the number of optional suggestions and a link to the Discovery page. Its badge only counts what is needed; the bell turns grey when only suggestions are left.
- **First network scan is automatic**: it starts within a minute of startup, then every `netscan_every` hours (0 still turns it off). A try without a result (no local network found) waits for the interval instead of retrying every minute.
- No em dash left in the interface or the code; empty values show "-".

### Fixed
- **"Run the search" on the network discovery did nothing** when the Discovery page was already open: it now launches the scan (the same route as the scan card), then scrolls to that card, highlights it and shows the scan running.

## v0.10.4 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Backups, "copied elsewhere"**: a followed folder can now be given its copies from the page (Settings → Backups → each set → "Add a copy": machine, then folder typed or picked from the search). MyServices compares each copy with the source at every run, as it already did for hand-written sets. "Find the copies" looks on every machine read by SSH, **network shares (NAS in CIFS / NFS) included**, for the last five archives of each followed folder and proposes where they are copied, in one click ("Link"); nothing is linked on its own. A copy on a network share counts as off-machine even when it is seen from the machine that makes the backup. A copy on another machine turns "off-machine copy required" on; removing the last one turns it off.
- **Backups, custom alert threshold**: besides 2 / 8 / 15 / 31 days, an "other…" pill takes any value from 0.1 to 365 days (Enter or leaving the field saves it).
- **Settings → Backups**: each followed set and each machine of the folder search has a darker title strip with the machine's system or app icon; the folder is no longer repeated under a name that already says it.
- **Backups, observed rhythm**: when archives arrive about every N days and the alert threshold is shorter, the set shows "observed rhythm ~N d: switch to X d" (one click).
- **One dev launcher (`scripts/dev.sh`, or `npm run dev:all`)**: starts the backend container if needed, waits for it, then the front with hot reload; Ctrl+C stops both (`--keep` leaves the backend, `--build` rebuilds the image first, `--stop` stops it). Local settings in `.dev.env` (ignored by git).

### Added
- **Matching layer (`matching.py`)**: each collection ties a machine to what the other tools say about it: MynetworK and UniFi (by IP, then MAC when the IP changed), Beszel, Proxmox VE nodes and guests, Proxmox Backup and Dockhand environments (by address, or by short name when exactly one machine has it, flagged as weaker). Each machine of `data.json` gets `links` (MAC, vendor, other names, one entry per tool with how it was matched, the Proxmox guest or node); `unlinked` lists what the tools see but MyServices does not follow. Beszel is read from the connectors' last result: no extra call. 12 tests.
- **Machines tab**: one badge per tool that sees the machine, under its name and in its detail ("Seen by", dashed when matched by name only), its other names and its Proxmox VM / node. The "Seen by MynetworK, not followed here" box becomes "Seen by your tools, not followed here", grouped by tool (MynetworK, Proxmox, Dockhand, Beszel).

## v0.10.3 (2026-10-11)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Getting started is now a standalone full-size page (`/#setup`)**: no tabs or dashboard header, only the steps, a bigger type size and a "Dashboard" link. The home page shows a single "Getting started n/6, Continue" banner instead of the whole card; a fresh install lands on the setup page once per session; "Review the first steps" opens it again.
- **Getting started**: the badges of the network scan summary all share the same dark look.

## v0.10.2 (2026-10-11)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **The app is now at the root of the site: `http://<IP>:8090/`** instead of `http://<IP>:8090/myservices/v2/`. The page, the API (`/api/v1/`, docs at `/api/v1/docs`), the MCP server (`/mcp`), the agent scripts (`/agent/`), the sign-in page, the produced files (`/data.json`, health, backups, events) and the diagrams all sit at the root; the session cookie is set for `/`. The old addresses keep working, so nothing already deployed breaks: **pages and files under `/myservices/…` (including `/myservices/v2/`) redirect to the same address at the root, while API, MCP and agent paths under `/myservices/…` are answered in place** (the path is rewritten before the access checks, so agents already installed on Windows PCs, API tokens and MCP clients keep working untouched and the access rules are the same). The redirect always keeps a single leading slash and refuses backslashes, so `/myservices//evil.com` can never send a visitor to another site (tested). Sign in once again after updating (the cookie path changed). The compiled front is served from `web/v2/` in the image; the Vite dev server now proxies the container's routes at the root.
- **Getting started**: the "Follow my backups" card is titled "My backups" (it fitted on two lines).

### Changed
- **Getting started, after the proposed connectors**: a **folded frame "All available connectors"** (with the count, and a note on how to open and close it) lists every tool MyServices can read with its logo; one click opens its form. It says why it is there (a tool can run on another machine than this one, so nothing recognised here does not mean nothing to link) and that **nothing is mandatory now: it can all be done later in Settings -> Connectors**. The former "Next" button row became a **"What next?" block of four cards** (link my tools, get notified, follow my backups, read the help), each with a line on what it brings, under a reminder that none of it is mandatory.
- **The version shown by an image built from a branch is now meaningful.** The header used to read `docker · 660b74c` for a branch image (the `:docker` tag the example compose pulled), which looked like a wrong version. It now reads **`v0.10.1+ · main · 660b74c`** (the last release written in that build's changelog, `+` = built from the branch after it); an image of a release tag still reads `v0.10.1`, and a local development build is unchanged (`dev`, git state, planned version). `GET /me` and the About page expose `released`. The example compose now pulls **`:latest`** (the last release) instead of the branch image, and the READMEs and compose point to the `main` branch (the `docker` branch is no longer updated); `:main` is the branch image.
- **One "Skip" button everywhere** (Getting started steps, network search, machine cards): a shared bordered pill with an icon, with a lighter variant when it sits on an already dark or tinted area so it stays readable.
- **Less alarming progress text during a collection**: step 6 of 8 no longer reads "2nd try of the failed probes" (which sounded like something was broken). It is a normal confirmation pass that always runs (slow or failed probes are asked again, less in parallel, to avoid false alerts) and now says so; step 5 says "1st pass". The "Skip" buttons of the Getting started steps are bordered pills with an icon, and "Resume" is a pill too.
- **Getting started, "Host machine detected"**: the machine, the number of services found, the apps and Docker (logo and name, no more "present on the host" text) all sit on one line.
- **Sign-in and first admin account page**: an **eye button** on each password field shows or hides what you typed. When the second password differs from the first, the **second field gets a red frame** with the message "The two passwords are not the same" and the matching rule turns red (nothing red while it is still empty). The disabled "Create the admin account" button is now clearly unavailable (flat grey, dashed edge, "not allowed" cursor) with a line saying when it becomes active, and the enabled button is a clear blue with a light shadow.

### Changed
- **"Getting started" card redone** (look and logic): a header strip with a rocket icon, a **progress bar and counter** (steps done out of 6), and a vertical timeline where each step has a round state marker (done, to do now, running, later) and an orange or blue tinted card for the active one. The texts are brought up to date: the "all good" message no longer promises steps "coming with application detection", the hard-coded list of 7 readable apps is replaced by the real count and the first connectors read from the connector list (with a link to all of them), a "See everything in Settings -> Connectors" link sits under the proposed connectors, and a new **"Next" row** links to linking tools, alerts, backups and the Help page.
- **Example compose: the port is easy to change.** `MYSERVICES_PORT` now reads `${MYSERVICES_PORT:-8090}`, so a port already taken on the host is fixed with a one-line `.env` file (`MYSERVICES_PORT=8095`, example in `deploy/env.example`) instead of editing the compose file; a comment at the top of the compose explains that the container uses the host network, so a `ports:` mapping would not work. The quick start now saves the file as **`docker-compose.yaml`** (the name most people expect, and the only one the old `docker-compose` v1 tool finds) and downloads the example `.env` in a second `curl`. Both READMEs now state in bold that the app listens on port **8090** and that it can be changed. The option is also visible in the compose itself: a `>>> PORT` comment right above the `MYSERVICES_PORT` line says which number to change.
- **README: open `http://<IP>:8090/`** (the root redirects to the sign-in page, then to the app) instead of the long `/myservices/v2/` address.

## v0.10.1 (2026-10-11)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **One card style across the app** (Settings and the other tabs): every card title that opens a card, alone or on a row with its buttons, is now a header strip across the card (same look as the new table cards, card grids and DNS cards), instead of a title with a blue bar; cards that need attention (detected services not configured, alerts off, authorise the key) tint the strip and the frame orange, finished ones green. Cards get a light shadow.
- **Every card title now has an icon** (Theme, Language, Accounts, Session duration, Add an account, My password, Authorise the key, Machines, Channels, Rules, My notifications, Latest sends, Audit log, Tokens, MCP tools, Updates, Changelog, Network search…), so the header strips read the same everywhere.
- **Backups tab, "To check" card redone**: coloured header strip with the count in a bubble (red if something is critical, orange, or green), then a table (state, backup set, what is wrong) and the read time in a footer. The table card is now a shared component (`TableCard`) also used by the DNS tab.
- **Health tab**: SSH, agent, Beszel and API machines are now **one single table** with a light separator row per category (name and count); card view keeps a thin titled divider per category. The table is the default view (your stored choice still wins).
- **Health tab, services and infrastructure in one card grid**: virtualisation (Proxmox), backups (Proxmox Backup), containers (Dockhand) and the services read through their API (Home Assistant, Frigate, Prometheus…) share one section and one card shape (coloured header strip with logo, name, kind, state and version). The Dockhand card now lists its environments in an aligned table (running / total, what to report) with the image updates under a fold.
- **DNS tab, synchronisation and AdGuard server cards redone**: a coloured header strip (icon, name, address, state badge) and label/value rows aligned in two columns between thin lines.
- **DNS tab lists redone as aligned tables**: each list (present on one instance only, rewrites to NPM without an active NPM host, invalid rewrites, direct rewrites, NPM domains to check) is a card with a coloured header (red, orange, grey or green, with the count in a round bubble) and a table with fixed columns and headers (domain, answer, why / only on / what to check) instead of free-flowing lines; the "NPM domains to check" card shows each issue as a badge and a green "all resolve the same" line when there is nothing to fix.
- **Backups tab**: the stat tiles (sets up to date, late, critical, without off-machine copy, undeclared copy, volume, machines) now sit on one single row (scrolls sideways on a narrow screen).
- **Diagrams tab shows the creation progress**: while a diagram is being built a banner says "Creating · for N s" with how long the last build took, the page re-reads every 2 s until the diagram appears, and the last build time and the next collection are shown otherwise. Fixes the **HTTP 500 when creating (or rebuilding) a diagram** (`threading` was not imported in `api.py`); a request made while a build is running now queues one more pass instead of being lost.
- **README rewritten**: logo built on the app's own 3x3 favicon grid (same squares and colours, kept as is), in a dark and a light variant picked by the reader's theme, shipped as **SVG and PNG** (`docs/logo-light|dark.svg|png`, plus `docs/icon.png`; the READMEs use the PNGs), a short "At a glance" and quick start, then **collapsible sections** for the big blocks (tabs, how machines are read, the 29 connectors, backups, alerts, diagrams, security, configuration, API and MCP, develop). English and French.
- **Wording follows the real stage of the project**: MyServices is *live but early-stage* (`0.x`), no longer presented as "testing phase, do not use in production". README badges and banner, release notes, the About page and the Help page now say so; the safety advice stays (keep a copy of `config/` and `data/`, keep it on your local network).

## v0.10.0 (2026-10-11)

### Changed
- **Home**: the attention card ("N points need your attention") shows **12 rows by default** with a row selector (12, 25, 50, All) remembered in the browser; the attention card and the "To do to complete the discovery" frame can both be **folded** (click its header; the badge keeps the count, the choice is remembered).
- **"Machine access" diagram redone**: besides the access methods (SSH, agent, **connector**, no access), every machine is now drawn under its method, inside a frame, with its health level, account and port (extra ways to read it are added to the detail, e.g. "+ agent, Beszel"). Up to 12 machines per method are drawn; the rest is listed in a card below. Checked with Archify 3.0.1 (no crossings) up to 35 machines.
- **Diagrams to create with a click** (Diagrams tab, "Diagrams to create"): four new diagrams built on demand from what MyServices already knows, each with a "Create this diagram" button (greyed with "nothing to show yet" when the data is missing): **network equipment and devices** (gateway, switches and Wi-Fi access points with the devices plugged into each, read by MynetworK and UniFi), **services per machine**, **domains and their path** (grouped under each NPM, with the machine and service targeted, and under each machine's Apache vhosts) and **virtual machines and containers** (Proxmox). Created ones join the list and can be removed; the choice is kept in `diagrams_extra`. New `PUT /diagrams/{id}`.
- **"Machine access" and the new diagrams share one layout** (groups on a row, their items inside a frame below, extras in a card), checked with Archify 3.0.1 with no crossings. **The "Who reads what (connectors)" diagram is removed**: it only showed connector types, not machines or what they read, so it added nothing next to Settings -> Connectors and the other diagrams; its old files are deleted at the next build.
- **Counts in card titles are round bubbles** everywhere (machines, connectors, followed backups, channels, rules, notifications, sessions, audit log, tokens…), tinted when it matters (orange for things to do). **Settings -> Machines**: collapsed machine cards all have the same height and width (two equal columns whatever the content) (long names and many badges are clipped, not wrapped), so the two columns line up row by row until you open one.
- **Filters work as toggles on every page**: a filter that was on stays as a pill after you turn it off (struck through, "+"); one click turns it off, another turns it back on, and several filters can be on together (several values of one filter combine with OR, different filters with AND). The filter panel is now a **grid of fixed-width columns, one per category, showing every pill** (no more "+2 others" hiding some roles). The **"Filters" button is always the rightmost item of the filter line** on every page, and on the Machines page "Show disabled" now lives inside the filters (Display row, counted on the button). The "Filters" button has a blue border and text, and a count badge. **Services opens on "State: OK" by default**, one click removes it; a filter coming from elsewhere (home counter, machine) is kept as is.
- **Home counters open the tab already filtered**: a click on a counter in the right-hand column (e.g. NPM "to fix", Health "critical", Machines "to set up") opens the right tab with only what that counter counts (Services, Machines, Health); the title still opens the tab unfiltered. The filter is applied once and cleared when you change tab by hand. Backups counters open the tab filtered by state (the tab lists machines while the counters count backup sets, so the numbers can differ; "no copy" just opens the tab). AdGuard counters scroll to the matching block (domains to check, orphan rewrites, unreachable servers) and outline it in blue for a moment.
- **Home notification frame redone**: the "to do to complete the discovery" frame is now a notification card with a bell and a **count badge**, then one row per item (system logo, **App** found on **Machine**, why) with its button and "Stop reminding me". The attention card shows its count in a coloured badge too.
- **Home page body redone** (the right-hand counters and schedule column are untouched): the counters are no longer repeated inside each card, so they only live on the right. Each section is a card with a header strip (icon tile, title, an "Open" link-pill whose arrow moves on hover), the attention card has a coloured status strip with dot-marked rows, and sentences get a soft bullet.

> **Testing phase: do not use in production.**

## v0.9.9 (2026-10-11)

### Added
- **4 more connectors** (kind "status", read-only, written from each service's documentation, **tried against fake servers only**): **Prometheus** (targets down, firing alerts), **Healthchecks** (failed and late jobs, read-only API key), **Netdata** (critical and warning alarms) and **Jellyfin** (playbacks, devices, pending restart or update). Detected containers propose them; logos for Prometheus, Netdata and Jellyfin.

### Changed
- **Settings -> Connectors**: the "Activation" sub-tab is gone. Each connector card has its own **Collection** switch (right of the version line); the Connectors tab only shows connectors.
- **Removed the "display" switches** (NPM, AdGuard, Apache) and the `sources` setting with its `GET /sources` / `PUT /sources/{name}` routes: what is detected or connected is always read and shown. An old `sources` key in `config.json` is ignored. To stop reading a connector, switch its Collection off.
- **Settings -> Machines has two sub-tabs**: "Machines" and **"SSH & Agents"** (how each machine is read); "SSH Agent Actif" (was "Read by SSH or by the agent") now sits at the bottom of the "Machines" sub-tab, folded by default, moved out of Connectors because it is about machines. Old `#settings/agents/<ip>` links open it.
- **"Detected services not configured" table** at the top of Settings -> Connectors: recognised apps that have a connector but no access set yet (Home Assistant, NPM, AdGuard, Frigate…), with their machine and an orange "To activate" state. Click the service: an **overlay** opens with the connector form already filled (address found). Apps already connected are not listed, and the card disappears when nothing is left. `data.json` gets `detected_apps` (same shape as `proposals`, plus `linked`).
- **Card titles stand out everywhere** (larger, extra bold, thin accent bar on the left, icon in the link colour; the blue mark of the active menu entry and sub-tab is thinner too) and **Settings -> Tasks and schedules is aligned like a table**: task, editable schedule (field, Save and reset buttons at the same height) and the run button in fixed columns.
- **Proxmox Backup Server joins the Backups tab**: Settings -> Backups -> "Proxmox Backup Server" lists the backup groups (a VM, container or host per datastore) read with the existing `proxmox-backup` connector's token (no account re-entered), you tick the ones to follow and set the alert age, like Veeam jobs. Datastore usage appears as disks. Read-only, written from the API documentation and **tried against a fake server only**.
- **Veeam wizard reuses the connector**: when a Veeam connector exists (set in Connectors, whatever its name), the wizard shows its account and only asks for it again on "Change the account".
- **Settings -> Backups: a "Backup sources" table** (folders on my machines, Veeam, Proxmox Backup Server, Home Assistant) with a state per source (green when followed, orange when to set up). Click a source and its fields unfold under it, one at a time; the list of followed backups stays above.
- **Settings -> Backups, "Followed backups" redone as cards** like the sources: logo or icon of the origin (folder, Veeam, Proxmox Backup, Home Assistant), name and path, an origin badge, then the alert age, the off-machine copy switch and "Remove" on a second line.
- **Settings -> Notifications reorganised**: "Alerts" and "Notifications" are sub-tabs like the other pages; channels, rules and notifications are cards with an icon, name and details on the left, state badges, then their buttons aligned on the right (same order on every row).
- **Language buttons show a flag** (French, British), drawn as SVG so they also show on Windows.
- **Settings -> Machines**: the last sub-tab you opened is remembered (a link to a machine still opens the right one), and the machine cards sit in **two independent columns** (all borders are now 1 px, with a thin 2 px accent on the left of the detail blocks; an unfolded machine or agent card gets the blue frame): opening a card no longer stretches or shifts the card next to it. SSH key page: "Machines using this key" is now an aligned table (machine with icon and address, account, port, state).
- **New "Help" page** in Settings (Application group, above "About"): where to start in six steps with direct links, how MyServices reads the network (SSH, agent, connector, network search), good habits, and what to do when something does not work.
- **History opens on the last 24 h, as bars**; the period and chart style you pick last are remembered in the browser.
- **Fewer duplicate calls from the page**: the discoveries list is fetched once and shared by the bell, the home reminder, the Settings menu and the Discovery page (one call every 30 s instead of four); Settings → Discovery and Tasks re-read every 10 s only while a scan or task runs, every 60 s otherwise; Agents every 30 s (5 s while waiting for a first report); nothing is re-read while the browser tab is hidden, and the tab re-reads when you come back.
- **Responses are gzip-compressed** (above 1 KB): `data.json` is about 200 KB.
- **Unchanged files cost no body**: produced files (`data.json`, health, backups, events) are revalidated with their ETag and answer `304 Not Modified` when nothing changed; the page no longer adds a random `?t=` to them nor bypasses the browser cache.

> **Testing phase: do not use in production.**

## v0.9.8 (2026-10-11)

### Changed
- **Favicon and logo: the 3x3 grid is kept** (decided). The 4x4 test favicon and `logo-grid-4x4.svg` are removed.

### Changed
- **Discovery pages: coloured frames wherever an action is to do**: a card with something to do gets an orange frame, tint and left bar, and so does its foldable list; a family sub-tab with something to do is orange; the Settings menu entry "Discovery" is orange with the count.

### Changed
- **"View and choose the machines found" is folded by default** (it only opens when you follow its link, not on every page load).

### Fixed
- **Selection buttons showed "Add the selection (10)" with nothing ticked on screen**: the count included machines already added, ignored or hidden in a folded frame. Only ticked machines that are visible now count (and are added); the "other devices" frame must be open for its boxes to count.

### Fixed
- **Found machines list shown twice** in Settings → Discovery when the "machines found" reminder was switched off: the list is now only in its discovery card, and in a card of its own only when there is no such discovery.

### Changed
- **Found machines: the selection buttons sit under the list, inside its frame** (not in the card footer mixed with "Stop reminding me"). When the frame is folded, its header shows how many are ticked. The card's own "Choose" button is gone (the frame opens by itself).

### Changed
- **Main buttons are now solid** (accent fill, white text) so they are not mistaken for the foldable frames, which keep their accent border and tint. The few buttons that copied the frame look ("Review first steps", "Redo a scan", the agent update button) use the neutral button style.

### Changed
- **"Machines already added" frame is folded by default.**

### Changed
- **Settings → Discovery: the found machines live inside their discovery card** ("N machine(s) found, not followed yet"): a folded frame "View and choose the machines found" opens from the card (and from its "Choose" button), and the selection buttons ("Add the selection (n)", "Deselect all") sit in the card's footer next to its other buttons, only while something is ticked, even when the frame is folded. When there is no such discovery, the list stays in its own card.

### Changed
- **Found machines: selection buttons only when needed**: "Add the selection (n)" and "Deselect all" appear in a bar only while something is ticked (also when the frames are folded); "Select all" moved next to the "To look at" heading and hides once all are ticked.

### Changed
- **"Access passed, to set later" notice moved to the top** of "Machines found on the network", right under the search buttons.

### Changed
- **Foldable frames in the network step** ("machines already added", "other devices"): accent-coloured border and background, a chevron that turns when open, a larger header, so it is clear they open.

### Added
- **Ignored devices are listed in "other devices"** (Settings → Discovery → "Machines found on the network"), under their own "Ignored by hand" heading with a dashed row, an "ignored" badge and a "Take back" button. The sub-headings of that frame (web pages only, ping only, ignored) are now clear bars with an icon, a coloured edge and a count.

### Fixed
- **Found machines list no longer jumps when a box is ticked**: the name field and the "what happens after adding" hint now sit on their own line under the row (ticked rows get a light frame) instead of squeezing the row.

### Changed
- **Active secondary buttons are readable everywhere** (dark and light themes): text in the main colour, a visible border and a light background instead of faint grey; disabled ones stay faded. One shared style (`quiet`) covers all pages, plus the first-steps and network buttons and the connector test report's close button.

### Changed
- **Discovery cards**: the action button ("Search now"…) uses the active accent colour and "Stop reminding me" a visible bordered style, instead of the faint grey.

### Changed
- **Settings → Discovery in three sub-tabs** (Network and machines, Services and apps, Backups), each with its own cards (title, mode, what it does, last / next time, buttons) and a count of what is to do; the sub-tab opens on the first family with something to do. The network settings (found machines, search, networks, ignored devices) sit in the first sub-tab.
- **"Machines added: access to set" only lists machines whose access is still to set**; the ones that are fine move to "already added".

### Added
- **"Stop reminding me" on a discovery to do** (machines found, network search never run, backup search, apps to connect): it stops counting in the bell and on the home page but stays listed in Settings → Discovery with a "Show the reminder again" button (`discoveries_muted`, `PUT /discoveries/muted`). A refused SSH key or a missing agent cannot be muted.

### Fixed
- **The Discovery buttons still did nothing when arriving from another page**: the scroll ran before the page had loaded its data.

### Changed
- **Discovery titles**: the machine's system logo, then "**App** found on **Machine** (ip)" with only the app and the machine in bold (`app` and `machine` fields added to `GET /discoveries`).

### Fixed
- **Settings → Discovery: the "Choose" / "Search" buttons did nothing** (they linked to the page already open). "Machines found on the network" is now a card on that page (tick, name, add or ignore) and the buttons scroll to it or to the search card.

> **Testing phase: do not use in production.**

## v0.9.7 (2026-10-11)

### Added
- **Home counters (right column)**: each group shows the real app logo (Nginx Proxy Manager, Docker, AdGuard Home) or a theme icon (Machines, Health, Backups) instead of an emoji.
- **DNS tab header**: AdGuard Home logo and title above the cards, and an "AdGuard" badge on each card (the tab may later host other DNS sources: UniFi, ISP box…).
- **Settings → Connectors lists what is read over SSH or by the agent** (AdGuard, Docker, processes) in a read-only block "Read over SSH or by the agent", with the same read-count badges and a link to the machine settings. AdGuard read over SSH had no card there.
- **Each connector card shows what its last collection read** (badges such as `entities : 4593`), not only after pressing "Test".
- **Settings → Discovery redesigned**: "Important actions" first (everything still to do, with its button), then the other discoveries grouped by family (Network and machines, Services and apps, Backups); the network search, its frequency and the manual actions share one card, networks / discreet mode / ignored devices sit beside it.
- **Discovery items**: "never run" and "next" are now coloured badges (orange / blue).

> **Testing phase: do not use in production.**

## v0.9.6 (2026-10-11)

> **Testing phase: do not use in production.**

### Added
- **"Test" button on every connector card**, without opening the form: it reads with the saved settings and shows a green or red frame with the version and a badge per kind of information read (entities, hosts, containers…), proving the connector really reads something. The form's test shows the same report. The card button now only says "Edit".

### Fixed
- **Settings → Machines cards have the same height** in a row, and many badges wrap onto several lines instead of stretching the card.
- **A machine read through a connector's API (Home Assistant, Proxmox…) was still shown as "online, without SSH"**, and nothing from the connector reached the Machines page. Now a machine whose connector URL (or announced address) points at it shows state **API**, its detail lists the connector with its version, and a failing connector is flagged in "To watch".
- **Home Assistant now brings sensors for its host machine** (System Monitor integration and Supervisor sensors): processor, memory, disk, temperature. They feed the Health tab as a source named "Home Assistant" (group "API"), so the machine gets CPU / memory / disk columns and alerts like any other. The connector also counts unavailable entities and low batteries.

### Changed
- **Folded agent card** (Settings -> Connectors -> Agents and SSH): the header now shows a green icon when automatic update is on, an "out of date · vN" badge (or "update requested") when the agent is older than the served script, and a check mark when it is up to date, so you see it without unfolding.
- **Machines: agent state and summary.** A PC read by its agent now shows "Agent active" in the State column instead of "online, without SSH" (it is also filtered and sorted as such). The "To watch" column always shows every pill (they wrap, nothing is hidden), and each machine's detail starts with a foldable "To watch" summary: one line per subject with its icon, colour and full sentence, open when something is serious. The alert delay in Settings -> Notifications -> Alerts is now a row of buttons.
- **Machines tab: "To watch" column instead of "Stop following".** The per-row "Stop following" button is gone (the switch "Machine followed" stays in Settings -> Machines only). A new sortable **To watch** column shows one icon pill per subject, **red** (serious: unreachable, full disk, failed units, SMART, services down), **orange** (to look at: SSH key refused, updates, reboot required, Docker unhealthy, connector failing) or **blue** (to know: online without SSH or agent), most serious first, with the detail in the tooltip; a green check when there is nothing. The same list of health problems is now shared with the Health tab (`machineWatch.ts`).
- **Icon buttons instead of drop-down lists** where an icon makes sense: the token kind (MCP / API), the token validity (30 days, 90 days, 1 year, no end), the Home Assistant connector choice in Backups, and "Health read first by" (Automatic / SSH / Agent) in a machine's settings. Drop-down lists with many values or no meaningful icon (SSH alias, durations) are kept.
- **Agent and SSH cards**: the system logo (Windows 11, Debian, Ubuntu…) shows next to each machine; the "Automatic yes/no" switch and the "Update now" button are aligned, the state is a small pill.
- **Agent card** (Settings -> Connectors -> Agents and SSH): the details that were squeezed into one long line (last report, system, agent version, frequency, token) are now a small list that wraps on several lines; the system name is shortened ("Windows 11 Pro") and an outdated version is flagged.

## v0.9.5 (2026-10-11)

> **Testing phase: do not use in production.**

### Added
- **Agent updates from the page** (Settings -> Connectors -> Agents and SSH), modelled on GpuViewR: each agent card shows its version ("v5 -> v6 available"), an **Automatic** icon switch and an **Update now** button. The agent still pulls: at its next report the server tells it to fetch the new script (only when automatic update is on or an update was requested); the agent checks the script's SHA-256 and syntax, then replaces its own file. `PATCH /agents/{id}`, `POST /agents/{id}/update`. Nothing is pushed to the PC; Linux and macOS agents are not written (SSH stays the way to read them).
- **Windows agent v6: Docker and services.** The PowerShell agent now also reports the PC's Docker containers (when `docker.exe` is installed and reachable by the SYSTEM account) and its running Windows services. Containers appear like those read over SSH (ports, Services tab); services are matched against known apps (Plex, AdGuard Home, Jellyfin, Sonarr, Radarr, Syncthing, Grafana, Prometheus, Veeam, Portainer, Uptime Kuma, Frigate, CrowdSec…) and shown in the machine detail ("Apps"). Re-install the agent to benefit.
- **To-do notifications for detections that need a manual step.** Whenever MyServices recognises an app it cannot read without your input (an AdGuard Home service on a Windows PC, a Frigate container, a Pi-hole…), a notification says so ("AdGuard Home found on PC"), with a "Configure" button that opens the connector already filled in. Same for machines found by the network search but not followed, SSH keys to authorise (or a wrong port) and agents created but never installed. They are listed on the home page and in Settings -> Discovery, and a bell with a counter appears in the header (admins).
- **AdGuard Home is connected automatically**: when a machine read over SSH runs an AdGuard Home container, the AdGuard connector is switched on by itself after the next collection (once per machine; clearing the field in Settings -> Machines keeps it cleared), and the DNS tab appears. Previously only "Re-detect" did it.
- **12 new connectors** (kind "status", shown in Health -> "Service via API" with key figures and what needs attention), all read-only and written from each service's documentation, **tried against fake servers only**: **Frigate** (cameras, detectors, storage, events), **Sonarr / Radarr / Lidarr / Prowlarr** (`arr`: health warnings, queue, missing), **OPNsense** (gateways, firmware updates, reboot), **CrowdSec** (active decisions), **Pi-hole v6**, **Technitium DNS**, **TrueNAS** (pools, alerts), **Synology DSM** (volumes, disks, temperature), **UniFi Network** (devices, clients), **Tailscale / Headscale** (machines online, client updates), **NUT** (UPS: mains, battery, runtime, load) and **Portainer** (environments, containers). Secrets travel in headers or POST bodies, never in the address. Detected containers propose the matching connector (Frigate, *arr, Pi-hole, Portainer, UniFi, CrowdSec, Technitium, Headscale, NUT); a choice whose values have a logo (application, Tailscale or Headscale) is shown as icon buttons. Ideas for more: `docs/IDEES-CONNECTEURS.md`.
- Settings -> Connectors: the "Add a connector" button is a coloured button again (it looked greyed out) and the introduction text is shorter and clearer (the two bullet points were removed).

### Fixed
- **Settings -> Machines blank page** ("Rendered more hooks than during the previous render"): a React hook had been placed after an early `return` in the machines page. Fixed, and a unit test (`hooksOrder.test.ts`) now fails if any component calls a hook after an early return.
- **Warnings coming back after a fix**: after fixing the SSH port or authorising the key, the "wrong port" / "key refused" cards stayed (and came back "in a loop") until the next collection pass finished, because they read the last pass. A successful test now clears them at once; the next pass confirms.
- **Authorize-the-key card**: "Test" showed "unknown machine" because the card sent the connector name instead of the machine address; it now uses the IP everywhere, and one command per SSH account when several machines fail with different accounts (it no longer falls back to "root" when the machine was not found by name).
- **Wrong SSH port is no longer reported as a missing key**: a "Connection refused" is shown as such, the check counts it as a failure (it used to say the key was accepted), and when the network search saw sshd on another port than the alias uses (e.g. 22232 instead of 22), the machine card offers "Use port 22232". New SSH accesses prepared from a machine card use the port seen by the network search.
- **Settings -> Machines**: switching "Machine followed" back on left the machine card greyed ("not followed") until the page was reloaded; the card now follows the switch at once.
- **Backups: false alarms on folders followed from the page.** A set followed from Settings -> Backups (or automatically for `/home/backup`) used to be critical with "no up-to-date copy outside the machine" because no copy elsewhere had been declared, and critical on age because the threshold was always 2 days even for weekly backups. Now: a set from the page does not require an off-machine copy (`expect_offsite: false`; a switch per set in Settings -> Backups turns the requirement on), the Backups tab counts them as "copy elsewhere not declared" instead of "without copy", and the age threshold is suggested from the age seen at discovery (2, 8, 15 or 31 days, with a 25 % margin) and editable per set (`PATCH /backups/settings/{id}`). Hand-written sets keep requiring an off-machine copy.

## v0.9.4 (2026-10-11)

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

- **Diagrams (Archify)**: three new generated diagrams next to the network map and the backups map: **Who reads what** (MyServices and one block per connector type, by SSH or API, dashed when down), **Machine access** (read over SSH, by the agent, or no access, with account and port in cards) and **Alert and notification chain** (collection -> history -> alerts / notifications -> Discord, Telegram, webhook). A diagram whose specification did not change is not regenerated. Each page gets a slim footer: back to MyServices, the other diagrams, and "Generated with Archify" (linked to the project).
- **Notifications** backend (`notifications.py`): custom messages next to alerts, on the same channels. *Reports* at fixed times and weekdays (chosen machines and sensors: CPU, memory, fullest disk, all disks, temperature, load, uptime, updates, reboot, failed units, Docker, SMART, refused SSH logins, ping) and *events* in live (kinds, machine, text, resolved events, delay between two sends; empty filter = everything). Six working examples (added disabled), "Send now" sends a real message. API: `/notifications`.
- **Discoveries overview** (`GET /discoveries`, Settings -> Discovery, and a reminder on the home page): which discoveries run by themselves, which need one manual start and which stay manual (network search, machine re-detection, backup folders, cron lines, connectors to link), with the last and next run.
- **Backups**: `/home/backup` is now followed automatically the first time a machine is read over SSH (`backups_auto`, once per machine; removing the set does not bring it back).
- **Settings -> About**: installed version, latest published version read from GitHub by the server (one anonymous request, kept 6 h; `update_check: false` turns it off), and the changelog with one version per button.

- **Diagrams tab and user menu**: a "Diagrams" tab lists every diagram with a short description, an inline preview, "Open" and "Regenerate now"; the account menu lists the available diagrams too ("All diagrams" plus one link each).
- **Settings -> Notifications** (was "Alerts"): two categories, **Alerts** (as before) and **Notifications** (new): reports and live events with a form built from buttons (report or events by icon, machines, sensors, times, weekdays, event kinds, delay, channels with their logos), six ready-to-use examples, "Send now", and the latest sends. The alerts status frame can be hidden (the choice is remembered; a one-line status stays).
- **Icon choices instead of drop-down lists** for new screens (`IconChoice`): channel type (Discord, Telegram, webhook logos), notification type and account role. **Accounts**: avatars, role as two buttons (no menu), counters, session length presets, and a duplicated "Session length" card removed. **Audit log**: period, action type and account as buttons with counts and colour dots, summary tiles.
- **Header**: the grid logo before the title (see Logo); on a development image ("dev") the git state it was built from (`--build-arg GIT_REV`) and the planned version (latest published + 1 when an "Unreleased" section exists) are shown next to it.

- **Logo**: the favicon is the original service **grid** again, now used everywhere (README logo and icon included); Settings -> Appearance -> "Header logo" switches the header icon between the favicon as is and the same grid without its dark square.

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
