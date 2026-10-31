<p align="center"><b>English</b> · <a href="README.fr.md">Français</a></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
    <img src="docs/logo-light.png" alt="MyServices" width="380">
  </picture>
</p>

<p align="center">
  <b>Every service and machine on your network, on one read-only page.</b><br>
  <sub>It builds on the tools you already run, without replacing them or ever writing to them.<br>
  Where none of them covers a machine, MyServices reads it directly: over SSH, through its Windows agent, or via the app's own API.</sub>
</p>

<p align="center">
  <a href="https://github.com/Erreur32/MyServices/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/Erreur32/MyServices?label=version&color=3da9fc"></a>
  <img alt="Stage" src="https://img.shields.io/badge/stage-young%20but%20working-f59e0b">
  <img alt="Read-only" src="https://img.shields.io/badge/access-read--only-22c55e">
  <a href="https://github.com/Erreur32/MyServices/pkgs/container/myservices"><img alt="Docker image" src="https://img.shields.io/badge/image-ghcr.io%2Ferreur32%2Fmyservices-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Architectures" src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555">
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml"><img alt="Tests and Docker image" src="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml/badge.svg"></a>
</p>

<p align="center">
  <img src="docs/screenshot-machines.png" alt="MyServices, All machines page with the side menu: every machine with its sources, system, services, health, CPU, memory, disk, GPU and uptime (domain names and public address blurred)" width="900"><br>
  <sub>Machines › All machines: every machine of the network at a glance, whatever tool reads it (domain names and public address blurred).</sub>
</p>

<p align="center">
  <img src="docs/screenshot-history.png" alt="MyServices, Home › Events page: events over 24 hours (domain names and public address blurred)" width="900"><br>
  <sub>Home › Events: what fell, came back, appeared or disappeared (domain names and public address blurred).</sub>
</p>

> ## Young, but it works
>
> MyServices is a **young project (`0.x`) that already does its job**: it reads your machines and services, shows their state on one page,
> keeps a history and raises alerts. It is now open to everyone, and it **still moves fast**: screens, settings and stored data can change
> between versions.
>
> - **What is solid**: the core (collection, health, history, alerts, accounts, API and MCP) and the connectors used every day on the
>   author's own network: **Nginx Proxy Manager, AdGuard Home, Beszel, Dockhand, Dozzle, Frigate, Glances, GpuViewR, Hermes Agent, Home
>   Assistant, LogviewR, MynetworK (and, through it, UniFi and the Freebox), Uptime Kuma, Wazuh and Web-Check**.
> - **What is less tested**: the other connectors were written from each service's documentation and tried against simulated servers only,
>   so they may not match every version or setup; the same goes for the Windows agent (one PC so far). The [table of connectors](#connectors)
>   below says which is which. If one does not match your real service, please tell us.
> - **It only ever reads** your machines, so trying it carries little risk. Back up `config/` and `data/` before each update, and keep it on
>   your local network (never exposed directly to the Internet).
> - **Feedback is welcome**: [questions and ideas](https://github.com/Erreur32/MyServices/discussions), bug reports and connector requests
>   (see below). Pull requests are not handled yet.
>
> Every version is tagged and published as a Docker image. Numbers stay **below 2.0.0** until the project is declared stable (`0.33.1`, `0.33.2`…).
> Details: [CHANGELOG.md](CHANGELOG.md) (always in English) · [RELEASE-NOTES.md](RELEASE-NOTES.md) (in English).

## At a glance

MyServices brings together the services of every machine on your local network and shows their live state **on a single page**. It
queries the APIs of the tools you already use (or the machine itself, over SSH or its Windows agent), cross-checks what they report, and
tells you what needs your attention.

- **Read-only**: nothing is ever written to what it observes.
- **A single container**: collection, watcher, health checks, backups, accounts, API and web page.
- A **setup assistant**: one decision at a time, and it recommends the simplest way to read each machine.
- **Machines** read over SSH (Linux), through a PowerShell agent (Windows), through an app's API, or simply by ping.
- **About 60 connectors**: Nginx Proxy Manager, AdGuard Home, Home Assistant, Proxmox, UniFi, MynetworK, Beszel, Ollama, Frigate… (which ones are proven: see [Connectors](#connectors)).
- **Live tiles with a history**: reachability, health, processor and memory, services, backups, and the speed of your Internet link (Freebox and UniFi), over 24 hours, 3 days or 7 days.
- **A history** of every event, with what detected it and where the data came from.
- **Diagrams** drawn for you (network, machine access, backups, alerts, and more in one click).
- **Alerts and notifications** on Discord, Telegram and webhook.
- A **REST API** and an **MCP server** for your tools and AI assistants.

## Quick start (on a test machine)

```bash
mkdir -p /opt/myservices && cd /opt/myservices
curl -fsSLo docker-compose.yaml https://raw.githubusercontent.com/Erreur32/MyServices/main/deploy/compose.example.yaml
# optional: change the port (default 8090), see the note below
curl -fsSLo .env https://raw.githubusercontent.com/Erreur32/MyServices/main/deploy/env.example && nano .env      # edit MYSERVICES_PORT
docker compose up -d
```

Then open **`http://<IP>:8090/`** (the app is at the root of the site; the old `/myservices/…` addresses still work and redirect) **within 30 minutes** to create the admin account (after that delay:
`docker compose restart myservices`) and follow the **setup assistant**, which opens by itself the first time (six short steps: this machine, the network, how to read each machine, your tools, alerts; every step can be skipped and redone, from the account menu: "Review the setup assistant"), then the **Help** page of the account menu. The app's SSH key and the command to authorize it on a machine are in **Machines › SSH connections**.

> **The app listens on port `8090`.** It is a setting, not a fixed value: if 8090 is already taken on your machine, put **`MYSERVICES_PORT=8095`** (or any free port) in a `.env` file next to `docker-compose.yaml` (example: [`deploy/env.example`](deploy/env.example), downloaded by the second `curl` above), then run `docker compose up -d` and open `http://<IP>:8095/`. The container uses the host network, so editing a `ports:` mapping would do nothing.

Image: `ghcr.io/erreur32/myservices` (amd64 and arm64). `:latest` follows the latest tag, `:0.33.1` pins a version, `:main` tracks the latest commit of the `main` branch (the header then shows e.g. `v0.10.1+ · main · abc1234`).
Update: `docker compose pull && docker compose up -d` (settings and data live in the `./config` and `./data` volumes).

---

## Questions, ideas, connector requests

- **A question or an idea**: [Discussions](https://github.com/Erreur32/MyServices/discussions).
- **A bug**: open an issue with the "Bug report" form (the project is in development, please check you run the latest image first).
- **A new connector** (a service MyServices should read): see [How to request a connector](docs/CONNECTOR-REQUESTS.md), then use the
  "Connector request" issue form.

Pull requests are not handled yet (see the notice at the top).

## Learn more

<details>
<summary><b>What you see: the menu</b></summary>

One menu on the left holds every page, in four groups; the views of a page are its sub-pages, listed under it, each with its own address. What needs your attention is the « Alerts » filter of each list (Security: its Overview). An entry appears once its source is linked.

| Group | Pages |
|---|---|
| **Overview** | **Home** (dashboard: what needs your attention, then counters that open the page already filtered; then the history: events of the last 24 h to one year as dots, bars, curve or heat map, and availability; statistics) |
| **Inventory** | **Machines** (every machine, each with its own page and settings; devices seen by your tools but not followed; agents; SSH connections and the app's SSH key), **Services** (NPM hosts and local services, each with its page, read and edited in place; new services; declare a service), **Network** (UniFi, Freebox, scan, devices, diagnostic), **DNS** (AdGuard Home: servers, details), **Cloudflare** (what to improve and why, traffic, security, server and cache, DNS, domains side by side, each proxied name checked against NPM, Apache or nginx), **Virtualization**, **AI and agents** (overview, models, agents and MCP, GPU; shown once an AI service or connector exists), **Video and cameras** (overview, cameras, streams, recordings; shown once a Stream service or a video connector exists), **Diagrams** |
| **Protection** | **Security** (overview, exposed sites, SSH access, network ports, certificates, Fail2ban, Wazuh), **Backups** (by machine, sets, add backups, to link, copies elsewhere, paths searched) |
| **Collection** | **Connectors** (mine, available, found to link, already read over SSH or by an agent), **Discovery** (automatic mode, what to do, other suggestions), **Tasks and schedules** |
| **Administration** | **Notifications** (channels, alert rules, my notifications, examples, last sent), **Accounts and access** (accounts and sessions, API and MCP tokens), **Application** (updates, e-mail, export and import, requests, audit log, logs, information) |

Profile, Help and About are in the account menu, top right.

Every filter is a toggle: click to turn it off, click again to turn it back on; several can be on together.

</details>

<details>
<summary><b>How machines are read</b></summary>

A machine can be followed in three ways, which can be combined. The first source that answers is used, and the next ones fill in what it could not read (the order is set per machine).

1. **MyServices itself**, nothing else to install:
   - **SSH** (Linux): MyServices connects with its **own key** (shown in Machines › SSH connections) and reads health, Docker, listening services and web servers. The key is never sent anywhere; you authorize it on each machine with one command. A dedicated non-root account in the `docker` and `adm` groups is the safest.
   - **Agent** (Windows or Linux): a small read-only script (PowerShell as a scheduled task, or Python as a systemd timer) sends the machine's own health, disks, ports, services, hardware and Docker containers. Nothing to open on the PC.
2. **External services already on your network** (connectors): if you already run Beszel, Proxmox, Uptime Kuma, MynetworK… MyServices reads their API with a read-only key. Nothing is installed on the machine.
3. **Ping and network scan**: only tell whether a machine is up and which apps answer on it. The first scan of your local network runs on its own, then repeats at the frequency you set. In manual mode you choose which machines to follow; in automatic mode the useful ones are added for you.

> **Which one to use? A simple rule.**
> - **A Windows PC or a Linux machine**: the agent. It reads the machine every minute and sends it itself, with no SSH key on the machine.
> - **SSH**: kept for what the agent does not read (backups, Proxmox or ESXi, NPM, AdGuard), for a Mac (no macOS agent), or when the agent cannot be installed. Machines › SSH connections tells, per machine, whether SSH is still useful.
> - **A box, a gateway, an app** (Freebox, UniFi, Home Assistant...): the connector, no agent.
>
> SSH, agent and connectors can run together on the same machine. The health comes from the agent while it answers (SSH takes over if it goes silent); a connector adds what only it knows (virtual machines, network clients, GPU...), shown as one badge per tool.

<details>
<summary><b>Agent or external services? What the agent already reads</b></summary>

The Windows agent is one small script. The table lists what it reads on a PC and which external tools you would need to get the same thing. The external column shows what those tools usually cover for this list, not all their features; check their documentation.

| What is read | MyServices agent (Windows) | External tools that would replace it |
|---|---|---|
| CPU load and memory | Yes | Beszel, windows_exporter (Prometheus), Netdata |
| Disk usage, per drive | Yes | Beszel, windows_exporter, Netdata |
| Physical disk health | Yes | Beszel (SMART), windows_exporter |
| Uptime and last boot | Yes | Beszel, windows_exporter |
| Listening TCP ports and their program | Yes | Little by default; TCPView by hand |
| Automatic services stopped in error | Yes | windows_exporter, Zabbix agent |
| Critical system errors (disk, NTFS, WHEA), last 24 h | Yes | Graylog, Loki with Alloy, Wazuh |
| Failed logons (count, last 24 h) | Yes (administrator account) | Wazuh, Graylog, Windows event forwarding |
| Pending Windows updates | Yes | WSUS, Intune, PDQ Deploy, Lansweeper |
| Reboot required | Yes | Patch managers |
| Hardware: maker, model, BIOS, CPU, cores, RAM, GPU | Yes | GLPI with FusionInventory, Lansweeper, Snipe-IT |
| Network cards and IPv4 address | Yes (no MAC address) | GLPI, Lansweeper; MynetworK for the MAC and vendor |
| Running services | Yes (up to 300) | windows_exporter, Zabbix agent |
| Docker containers on the PC: name, image, ports, state | Yes | Dockhand or Portainer (Docker API exposed), Dozzle |
| Presence: on, asleep or silent | Yes (the agent reports itself) | Uptime Kuma (ping or port), MynetworK |
| Installation | One script, one scheduled task, one outgoing connection to MyServices | One service per tool, its own account or key, a port to open on the network |

For Linux machines, the Linux agent (Python 3.6+, systemd) gives the same information: pick **Linux** when installing the agent (the machine's page, **Access** tab), then paste the command in a terminal on the machine. SSH gives it too, with nothing to install, and stays needed for backups, Proxmox or ESXi, NPM and AdGuard.

</details>

<details>
<summary><b>Windows agent: install, security, updates</b></summary>

**Install.** Open the PC's page (Machines › All machines, then the PC), **Access** tab, then « Install the Windows agent ». MyServices shows a one-line command, with the token, **once**. Paste it in an **administrator** PowerShell on the PC. The installer downloads the agent from MyServices, writes its settings, creates the scheduled task *MyServices Agent* (runs as SYSTEM at startup, at logon and every 15 minutes by default; `-Minutes` changes it) and sends a first report. Only SYSTEM and Administrators can read the agent folder (`C:\ProgramData\MyServices-Agent`), because the token is in it. To remove it: run the installer with `-Uninstall`, then revoke the token in the same **Access** tab.

**What it can and cannot do.** The agent only reads the PC and **sends** its report to MyServices (nothing is opened on the PC). It runs no command received from the server, listens on no port and installs nothing else.

**Token and limits.**
- One token per machine, shown once; only its SHA-256 fingerprint is stored. A new token for the same machine revokes the old one. The token opens a single route (sending its own report): it is refused everywhere else, and API or MCP tokens are refused on that route.
- One report per minute per agent (more gets a `429`). An IP that presents 10 unknown tokens within 15 minutes is refused for the rest of the window (revoked tokens do not count).
- The PC name seen in the first report is remembered. A report under another name (PC renamed, or token copied to another PC) is refused until you click **Confirm this name** on the agent's card; the event is written to the audit log.
- Like the rest of MyServices, the page and the agent route only answer to the networks allowed by `MYSERVICES_ALLOW`. Plain HTTP is fine on a trusted LAN; behind a reverse proxy, give the agent the HTTPS address.

**Updates.** The agent card shows its version. **Update now** or the per-agent **Automatic** switch (off by default) makes the agent fetch the new script from MyServices at its next report; it checks the SHA-256 and the syntax before replacing itself. The script is not signed: MyServices is the only source of trust.

**macOS.** There is no agent for macOS: a Mac is read over SSH.

</details>

Machines found but not yet followed, SSH keys to authorize and agents not yet installed are listed under **Collection › Discovery** and counted in the bell of the header.

</details>

<details>
<a id="connectors"></a>
<summary><b>Connectors (about 60)</b></summary>

A connector lets MyServices read a tool through its API, **read-only**: give it a key or account that cannot change anything. Collection › Connectors › Mine lists them, tests each (button **Test**), and shows what the last collection read. The **Found, to link** sub-page proposes the ones it recognised on your network, with the form already filled; **Already read over SSH or by an agent** lists the tools a followed machine already gives.

| Family | Connectors |
|---|---|
| **Web and proxies** | **Nginx Proxy Manager**, **Web-Check** |
| **Apps** | **Home Assistant**, Netatmo, Tapo, Nextcloud, Jellyfin, Tautulli, Overseerr / Jellyseerr, Sonarr / Radarr / Prowlarr…, Bazarr, qBittorrent, Transmission |
| **DNS** | **AdGuard Home**, Cloudflare, Pi-hole, Technitium DNS |
| **Monitoring** | **Beszel**, **Uptime Kuma**, **Dozzle**, **Glances**, **LogviewR**, Prometheus, Healthchecks, Netdata, Pulse, Speedtest Tracker, Webmin, Umami, Rybbit |
| **Network** | **MynetworK** (UniFi and Freebox through it), UniFi Network (direct), Tailscale / Headscale, OPNsense, NetAlertX, Internet box (UPnP IGD), FRITZ!Box, SFR Box, Livebox, Vodafone Station, Sagemcom F@st, Bbox, Swisscom Internet-Box, Compal Connect Box, Telekom Speedport, Technicolor Homeware, T-Mobile Home Internet, Hitron CODA, Verizon Fios, Arris SURFboard, Liberty gateway, OpenWrt, MikroTik RouterOS, Asus (AsusWRT / Merlin), TP-Link Archer (these four routers: not tested on a real router yet) |
| **Security** | **Wazuh**, CrowdSec |
| **Virtualization and containers** | **Dockhand**, Proxmox VE, Proxmox Datacenter Manager, VMware vCenter, Portainer, Arcane, Unraid |
| **Storage and backups** | Proxmox Backup Server, Veeam Backup & Replication, Veeam for Microsoft 365, Backrest, borgmatic, UrBackup, TrueNAS, Synology DSM, remote folder (FTP, FTPS, Samba) |
| **Power** | UPS (NUT) |
| **AI** | **Hermes Agent**, **GpuViewR**, Ollama, llama.cpp, Open WebUI, OpenAI-compatible API (vLLM, LM Studio, LocalAI, KoboldCpp, LiteLLM) |
| **Video and cameras** | **Frigate**, Shinobi, go2rtc, MediaMTX, Owncast |
| **Channels** | Discord, Telegram, webhook |

> **In bold: used every day on the author's own network.** The others were written from each service's documentation and **tried against
> simulated servers only**: they should work, but they have not met a real installation yet (Proxmox, Veeam and Synology are waiting for a
> tester). If one does not match your real service, please say so in an issue.

Writing a connector: [docs/CONNECTEURS.md](docs/CONNECTEURS.md) (in French). Ideas for more: [docs/IDEES-CONNECTEURS.md](docs/IDEES-CONNECTEURS.md).

</details>

<details>
<summary><b>Backups</b></summary>

Backups › Add backups shows the **sources** as tiles (click one to open its wizard under the tiles):

- **Folders on my machines**: found over SSH in the usual places (`/home/backup` is followed automatically); you tick the ones to watch.
- **Veeam Backup & Replication**: REST API (port 9419) with a read-only account (role *Veeam Backup Viewer*); pick the jobs to follow.
- **Proxmox Backup Server**: backup groups (a VM, container or host per datastore) read with the existing connector's token (role *DatastoreAudit*).
- **Synology (Hyper Backup)**: the Hyper Backup tasks of a NAS, read with the account of the existing Synology DSM connector (read-only user); you tick the tasks to follow, and each shows the date and result of its last run (a failed, interrupted or late run raises an alert; a cloud or remote target counts as a copy outside the machine). Routes written from DSM's web API, to confirm on a real NAS.
- **Home Assistant**: its automatic backup, through the existing connector's token. Optionally, with the community **ha-mcp** add-on installed in Home Assistant (this is *not* Home Assistant's native MCP), paste its address in the connector: MyServices then also reads the real list of backups (date, size, encrypted or not, where each one is copied), the Repairs, the configuration check and the failing integrations. It only runs six fixed read calls and never installs, deletes or restores anything; also turn on ha-mcp's own read-only mode.

- **A folder on a box or NAS (FTP, FTPS, Samba)**, the simplest way, nothing to set up on the host: an account typed in the page (password kept encrypted) lets MyServices browse a shared folder and follow it, as a backup on its own or as the **copy of** another backup. Nothing is written on the box.
- **A share already mounted on the machine that runs MyServices** (Freebox, NAS): the container can read it **read-only**, with no account stored in MyServices. Mount the share on the host (for example `/mnt/nas`, from `/etc/fstab` or a systemd automount), then add one line to the volumes of your compose file:

  ```text
  # /etc/fstab of the host: read-only, with the account in a file only root can read; uid=10001 is the user of the container
  //nas.local/backups  /mnt/nas  cifs  ro,credentials=/root/.smbcredentials,uid=10001,nofail,x-systemd.automount  0  0
  ```

  ```yaml
      volumes:
        - /mnt/nas:/mnt/nas:ro,rslave   # read-only; rslave follows the mount/unmount of an automount
  ```

  Recreate the container (`docker compose up -d --force-recreate`), then declare the box as a host with `"mount": "/mnt/nas"` in `backups-meta.json`. The account of the share only needs read rights. Prefer the mount when the share is already mounted on the host; prefer the account when it is not.

For each followed backup you set the age after which an alert fires, and whether a copy on another machine is required. Cron jobs and timers that look like backups are listed on their own.

</details>

<details>
<summary><b>Alerts and notifications</b></summary>

- **Channels**: Discord, Telegram, webhook.
- **Alerts**: rules choose which events (machine down, critical health, late backup, new service…) go to which channel, with a delay so the same alert is not repeated. Presets get you started.
- **Notifications**: messages you compose: a **report** of chosen machines and sensors at fixed times, or **live events** filtered by kind, machine or text. Ready-to-use examples can be added in one click, and "Send now" sends a real message.

Failures are confirmed over several passes before an alert is sent.

</details>

<details>
<summary><b>Diagrams</b></summary>

Generated with [Archify](https://github.com/tt-a1i/archify) after each collection: the **network map**, **machine access** (every machine under SSH, agent, connector or no access), **backups** and the **alert chain**.

The **Diagrams** page also proposes ones you create with a click, built from what MyServices already knows: **network equipment and devices** (gateway, switches, Wi-Fi access points and what is plugged into each, read by MynetworK and UniFi), **services per machine**, **domains and their path** (under each NPM and each Apache) and **virtual machines and containers** (Proxmox).

</details>

<details>
<summary><b>Security and access</b></summary>

- **Read-only by design**: connectors only send GET requests (or read commands over SSH). Passwords and tokens are stored encrypted (`enc:v1`) and never sent back to the page; the private SSH key stays in `config/ssh` (mode 600) and is never shown.
- **Accounts**: local accounts (admin or read-only), password rules, session list, an audit log (filterable, CSV export).
- **Network**: the page only answers private networks and the loopback by default (`MYSERVICES_ALLOW` to change). Do not expose it to the Internet; put it behind a VPN or an authenticating proxy if you need remote access (`MYSERVICES_COOKIE_SECURE=1` behind HTTPS).
- **The container**: the app runs as user `10001` (never root). The container starts as root only to give `./config` and `./data` to that user, then drops to it with no capabilities left; read-only file system, `no-new-privileges`, no Docker socket (the host is read over SSH like the others).
- **Guard before commit and push**: `bash scripts/install-hooks.sh` refuses tokens, passwords, keys, `config.json`, `.env`, databases and unreviewed images.

</details>

<details>
<summary><b>Configuration</b></summary>

Almost everything is set in the page (Settings). Files and variables, for reference:

| | |
|---|---|
| `./config` | `config.json`, `services-meta.json`, `secret.key`, `ssh/` (the app's key, aliases, `known_hosts`) |
| `./data` | the produced page, caches, state, `myservices.db` (accounts, history, alerts) |
| `MYSERVICES_PORT` | port of the page (default `8090`) |
| `MYSERVICES_ALLOW` | networks allowed to open the page (default: private networks and loopback) |
| `MYSERVICES_HOST_USER` | SSH account of the `hote` alias (the host machine) |
| `MYSERVICES_COLLECT_AT` | schedule of the collection, `minutes hours` (default `0,15,30,45 *`); same for the watcher and health |
| `TZ` | time zone |

Schedules can also be edited live in Collection › Tasks and schedules. A full example is in [`deploy/compose.example.yaml`](deploy/compose.example.yaml).

</details>

<details>
<summary><b>API and MCP</b></summary>

A REST API (`/api/v1/…`, OpenAPI documentation at `/api/v1/docs`) and an **MCP server** (`/mcp`, `msv_mcp_` token) let your tools and AI assistants read the same data. Create tokens in Administration › Accounts and access › API and MCP tokens, with a validity you choose: **read** (the default), **runs** (read + ask for a collection) or **admin** (settings included; a duration is required and your password is asked). Each MCP tool has its own switch.

</details>

<details>
<summary><b>Develop</b></summary>

```bash
docker build -t myservices:dev .
docker run --rm --entrypoint python -v $PWD:/src:ro -w /src myservices:dev -m unittest discover -s tests
cd front && npm ci && npm test && npm run dev      # :5180
```

Versions: `python3 scripts/release.py` checks that the version, both READMEs, the changelog and the release notes agree; `release.py patch|minor|X.Y.Z` applies a new one everywhere (it commits, tags and pushes nothing).
`.claude/` is never versioned.

</details>

> Full documentation (detailed installation, every connector, API and MCP) will be written as the project matures; the **Help** page (account menu, top right) covers the first steps today.
