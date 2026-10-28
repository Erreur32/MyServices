# Migration guide

What to change, check or expect when updating MyServices from one version to the next. One section per version, newest first. When a
section says **Nothing to do**, `docker compose pull` then `docker compose up -d` is the whole update.

Keep a copy of `config/` and `data/` before any update.

## 0.28.0 → 0.29.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: the image starts `python3 -m msv.api.run` (it was `msv.api.server` in 0.28.0); only matters if you override the container command. Browsers keep the hashed front files for a year. Command lines run by hand are unchanged since 0.28.0 (`python3 -m msv.tools.manage ...`).

## 0.27.0 → 0.28.0

**Nothing required to update.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Command lines run by hand changed** (only if you use them): `python3 manage.py ...` is now `python3 -m msv.tools.manage ...`, `python3 setup.py ...` is `python3 -m msv.machines.setup ...`, `python3 import_install.py ...` is `python3 -m msv.tools.import_install ...`, always through `docker compose exec myservices`.
- **Old installation without Docker (`install.sh`, systemd units, `refresh-api.py`)**: no longer maintained. The files moved to `legacy/` and the units start files that no longer exist under their old names. Move to the Docker image.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour**: none. The python code moved into the `msv` package and the image starts `python3 -m msv.api.server`; scheduled tasks run as modules.

## 0.26.2 → 0.27.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: imported icons are stored in an `icons` folder inside the state folder (already a volume). The Windows UPnP (2869) and WSD (5357) ports are no longer reported as unreachable.

## 0.26.1 → 0.26.2

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: only the place of some menu items (History under Home; Requests, Audit log and Logs under Application). The addresses of every page are the same, so bookmarks keep working.

## 0.26.0 → 0.26.1

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: the Backups, Services warning and Network tiles draw their history, and the Network page gains **Download** and **Upload** tiles. They start empty and fill at each collection (`tile_samples` table, a few thousand more rows, 7 days kept). A new background thread reads the Internet link rate every 2 minutes at most: the Freebox from the connector readers' shared reading (no extra call), the UniFi gateway from the UniFi cards (one MynetworK or controller call at most every 30 s, shared with the pages). UniFi's rate needs MynetworK 0.11.1+ or a UniFi connector with a local account; without it only the Freebox is drawn.
- **Behaviour that changes by itself**: the Agents, AI and agents, Virtualization, DNS and Services pages gain tiles with a history, which start empty and fill at each collection (every 15 minutes). A new background thread sends one DNS query per minute to each DNS server of the DNS page and to Cloudflare (1.1.1.1) and Google (8.8.8.8): if your network blocks outgoing DNS to the Internet, the *External DNS latency* tile stays empty. The Internet rate is kept every minute instead of every two.
- **Optional**: the Freebox rate is read every `fast_every` seconds (300 by default); lower it for the MynetworK connector in Settings → Connectors for a finer curve. The same setting (« Read every ... min ») makes the GPU curves finer: set GpuViewR to 1 minute.

## 0.25.0 → 0.26.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Optional, `backups-meta.json`**: a copy of a backup can now carry `"every_days": 7`, the days between two runs (1 to 31) for a copy that does not run every day, such as a weekly rsync to a NAS. It is set in the form of the copy (**Rhythm**), or through the MCP tool `backups_config`. Without it a copy is expected daily, as before.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: the Machines, Services, Network and Security tiles draw their history. The Network history starts empty and fills at each collection, the Machines health and Network points are kept 7 days (`tile_samples` table, a few thousand rows), and the machines' readings (`metric_samples`) are kept 7 days instead of 24 h (about 40 000 rows for 15 machines). The menu has a new **Collection** group (Connectors, Discovery, Tasks and schedules); bookmarks to those pages keep working.

## 0.24.2 → 0.25.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Optional, `services-meta.json`**: a machine can now carry `"temp_warn_c": 75`, its own processor warning threshold in °C (50 to 110; critical is 10 °C higher). It is set on the machine's page (Options › Temperature threshold) or through the MCP `machines_config` action `patch`. Without it, the thresholds stay 85 / 95 °C.
- **MCP**: the new read tool `get_backups` follows the switch of the read tools; `machines_config patch` and `settings_config task_run` follow the switch of their tool. Nothing to switch on again.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: a machine above its temperature threshold is only flagged after ten minutes (`health.json` gains a `hot` key); container states on the Services and Machines pages follow the health reading between two inventories, so a container stopped since the last inventory may change state at the first health run after the update; a process bound to a bridge or container address becomes « internal » (up, not probed) at the next collection; a disk Beszel cannot read is no longer shown « in fault ».

## 0.24.1 → 0.24.2

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: a service whose Docker container is stopped on purpose (never started, exit 0, 137 or 143, or listed in the machine's « Containers stopped on purpose ») shows « off » instead of « down » at the next collection, and no longer sends an alert.

## 0.24.0 → 0.24.1

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Optional, `services-meta.json`**: a machine can now carry `"stopped_ok": ["container-name"]`, the containers that may stay stopped (even with an exit code other than 0, 137 or 143). It is set on the machine's page (Options › Containers stopped on purpose) or through the MCP `machines_config` save. Without it, nothing changes.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: nothing.

## 0.23.0 → 0.24.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **MCP, optional**: a sixth admin tool, `settings_config`, is **off** until you switch it on in Settings › API and MCP (the other `*_config` tools keep the switch you gave them). Its changes are in the audit log as `mcp:<token name>`.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: a machine whose only kernel notice was the Samba line `CIFS: VFS: Autodisabling the use of server inode numbers` goes back to « ok » at the next health run. Mounting the share with `noserverino` also stops the line at the source.

## 0.22.1 → 0.23.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **MCP, optional**: a fifth admin tool, `machines_config`, is **off** until you switch it on in Settings › API and MCP (the other `*_config` tools keep the switch you gave them). Its changes are in the audit log as `mcp:<token name>`.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Behaviour that changes by itself**: the health file now carries the state of the connectors read by the health task (Beszel); a Beszel that does not answer is listed as failing in the MCP `status`.

## 0.22.0 → 0.22.1

**Nothing to do.** Same app as 0.22.0, whose image was never published: from 0.21.0, read the 0.21.0 → 0.22.0 section below.

## 0.21.0 → 0.22.0

**Nothing required.** No change to the compose file, the image's volumes or variables, or `config.json`.

- **Agents**: the Windows and Linux agent scripts are unchanged (Linux agent 4). Installed agents keep running as they are.
- **Optional, `services-meta.json`**: a new category rule **« Stream »** (camera recorders, stream relays, live broadcasts) is in `services-meta.example.json`. To use it in your own file, add the rule before « Médias » and remove `frigate` from the « Domotique » rule:
  `["Stream", "frigate|shinobi|zoneminder|motioneye|agent-?dvr|ispy|viseron|kerberos|scrypted|go2rtc|mediamtx|rtsp-simple|restreamer|owncast|webcam|camera|\\bnvr\\b"]`.
  Without it, Frigate stays in Home automation in Services; the new « Video and cameras » page recognises these apps anyway.
- **Optional, connectors**:
  - **Frigate** has two new optional fields, `user` and `password`, for its signed-in port 8971 (Frigate 0.14+, a « viewer » account is enough; untick « Verify the HTTPS certificate » for its self-signed certificate). Without them, port 5000 works as before.
  - New connectors, none set by default: **Shinobi**, **go2rtc**, **MediaMTX**, **Owncast** (video), **Open WebUI** and **OpenAI-compatible API** (AI).
- **Optional, per service**: Services › a service's page › « Edit » can now set a display name, an icon, the app, the address to open and an alerts level. They are saved in `services-meta.json` under that service's key, next to what was already there.
- **Behaviour that changes by itself**:
  - Two new menu entries in Inventory, shown only when they have something to show: « AI and agents » and « Video and cameras ».
  - Health alerts use short labels (« Health good », « Health to watch », « Health critical », « Machine unreachable »); notifications, the audit log and the history show them, in both languages.
  - A machine read by a connector switched off on purpose in Settings is « connector off » in Backups, with no alert.
  - An admin can see the picture of a camera on the Video page, only after clicking its play button; it is never kept and each view is written to the audit log.

## 0.20.2 → 0.21.0

**Nothing to do.** No change to the compose file, the image's volumes or variables, `config.json` or `services-meta.json`.

- **Agents**: the Windows and Linux agent scripts are unchanged (Linux agent 4). Installed agents keep running as they are.
- **Security, to know**: an admin token (API or MCP) can now manage the agents (list, create, update, revoke, purge) and every backup setting. Until 0.20.2 the agents needed a browser session. Accounts, tokens, showing a saved secret, installing `npm-api.sh` and the config import stay closed to tokens.
- **MCP, optional**: four new admin tools (`connectors_config`, `backups_config`, `agents_config`, `validate_config`) are **off** until you switch them on in Settings › API and MCP; each answers `help` with its actions. Every change they make is in the audit log as `mcp:<token name>`.
- **Behaviour that changes by itself**:
  - The side menu is tidied up: « Activity » (requests, audit log, logs), Notifications under Administration, the app's SSH key on Machines › SSH connections. Old addresses redirect: `#settings/network` → `#settings/discovery`, `#security/watch` → `#security/overview`, `#settings/ssh` → `#settings/machines/ssh`.
  - The header shows a new release found by the last check, automatic or by « Check now », even with the automatic check off; a « Notices in the header » switch (per browser) turns that off in Settings › Updates.
  - The theme is chosen in the profile only (three more dark themes: One Dark, Nord, Dracula); the account menu has a language switch instead of the light/dark one.
  - At startup the logs give the app's SSH key by its fingerprint only: the public key and the command to authorize it are in Machines › SSH connections. The app keeps its last 10,000 log lines (was 3,000).

## 0.20.1 → 0.20.2

**Nothing to do.** No change to the compose file, the image's volumes or variables, `config.json` or `services-meta.json`.

- **Agents**: the Windows and Linux agent scripts are unchanged (Linux agent 4). Installed agents keep running as they are; no update is offered, none is needed.
- **Behaviour that changes by itself**:
  - A Linux machine with an agent sending fresh reports now gets its health from the agent first; SSH takes over if the agent goes silent. An order set by hand for a machine (`health_sources` in `services-meta.json`) still wins.
  - The figures of each machine are kept 24 hours in the SQLite base (new table `metric_samples`, created on its own): the curves of the machine page fill in over the first minutes (agent) or hours (SSH only).
  - Services › New services no longer lists what a set connector already reads.
- **Optional, Wazuh**: the Wazuh connector has three new optional fields for its indexer (`indexer_url`, `indexer_username`, `indexer_password`) to read the alerts and vulnerabilities. Without them it works as before. Its guide explains the second, read-only user (backend role `readall`). Reload the page once after updating so the connector form shows the new fields.
- **Addresses**: `#settings/machines/ssh/<ip>` is still the page of one SSH connection; `#settings/machines/ssh/new` adds one; `#settings/machines/agents/<ip>` now opens the Agents list with that row lit (the agent's buttons are on its row).
