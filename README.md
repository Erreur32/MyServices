<p align="center"><b>English</b> · <a href="README.fr.md">Français</a></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
    <img src="docs/logo-light.png" alt="MyServices" width="380">
  </picture>
</p>

<p align="center">
  <b>The state of your services and machines, in one place, read-only.</b><br>
  <sub>It builds on the tools you already run. It never replaces them and never writes to them.</sub>
</p>

<p align="center">
  <a href="https://github.com/Erreur32/MyServices/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/Erreur32/MyServices?label=version&color=3da9fc"></a>
  <img alt="Stage" src="https://img.shields.io/badge/stage-live%20%C2%B7%20early-f59e0b">
  <img alt="Read-only" src="https://img.shields.io/badge/access-read--only-22c55e">
  <a href="https://github.com/Erreur32/MyServices/pkgs/container/myservices"><img alt="Docker image" src="https://img.shields.io/badge/image-ghcr.io%2Ferreur32%2Fmyservices-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Architectures" src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555">
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml"><img alt="Tests and Docker image" src="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml/badge.svg"></a>
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml"><img alt="Safety guard" src="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml/badge.svg"></a>
</p>

> ## 🚧 Live, but still young
>
> MyServices is **published and usable**, but it is an **early-stage** project (`0.x`). Screens, settings and stored data can still change from
> one version to the next, and several parts have so far only been tried on a single PC or against fake servers (Windows agent, Veeam,
> Proxmox, Prometheus, Healthchecks, Netdata, Jellyfin, Home Assistant backups). **It only reads your machines**, so trying it is low-risk,
> but give it time before relying on it for something critical: keep a copy of `config/` and `data/` before every update, and keep it on
> your local network (never straight on the Internet).
>
> Version numbers stay **below 2.0.0** until it is declared stable (`0.10.4`, `0.10.5`…).
> Details: [CHANGELOG.md](CHANGELOG.md) (always in English) · [RELEASE-NOTES.md](RELEASE-NOTES.md) (in French).

## At a glance

MyServices gathers the services of all your machines and of your local network and shows their live state **on one page**. It reads the
API of the tools you already use (or the machine itself over SSH), cross-checks the answers and tells you what needs attention.

- 🔒 **Read-only**: nothing is ever written to what it observes.
- 📦 **One container**: collection, watcher, health, backups, accounts, API and web page.
- 🖥️ **Machines** read over SSH (Linux), by a PowerShell agent (Windows), through an API, or by ping.
- 🔌 **29 connectors**: Nginx Proxy Manager, AdGuard Home, Home Assistant, Proxmox, Veeam, UniFi, MynetworK, Beszel…
- 🕘 **History** of every event, with what detected it and what read it.
- 🗺️ **Diagrams** generated for you (network, machine access, backups, alerts, and more on a click).
- 🔔 **Alerts and notifications** on Discord, Telegram and webhook.
- 🤖 A **REST API** and an **MCP server** for your tools and AI assistants.

## Quick start (on a test machine)

```bash
mkdir -p /opt/myservices && cd /opt/myservices
curl -fsSLo docker-compose.yaml https://raw.githubusercontent.com/Erreur32/MyServices/main/deploy/compose.example.yaml
# optional: change the port (default 8090), see the note below
curl -fsSLo .env https://raw.githubusercontent.com/Erreur32/MyServices/main/deploy/env.example && nano .env      # edit MYSERVICES_PORT
docker compose up -d
docker compose logs myservices        # the app's public key and the command to authorize it on the host
```

Then open **`http://<IP>:8090/`** (the app is at the root of the site; the old `/myservices/…` addresses still work and redirect) **within 30 minutes** to create the admin account (after that delay:
`docker compose restart myservices`) and follow the **"Premiers pas"** (getting started) card, then the **Help** page in Settings.

> **The app listens on port `8090`.** It is a setting, not a fixed value: if 8090 is already taken on your machine, put **`MYSERVICES_PORT=8095`** (or any free port) in a `.env` file next to `docker-compose.yaml` (example: [`deploy/env.example`](deploy/env.example), downloaded by the second `curl` above), then run `docker compose up -d` and open `http://<IP>:8095/`. The container uses the host network, so editing a `ports:` mapping would do nothing.

Image: `ghcr.io/erreur32/myservices` (amd64 and arm64). `:latest` follows the latest tag, `:0.10.4` pins a version, `:main` tracks the latest commit of the `main` branch (the header then shows e.g. `v0.10.1+ · main · abc1234`).
Update: `docker compose pull && docker compose up -d` (settings and data live in the `./config` and `./data` volumes).

---

## Learn more

<details>
<summary><b>🔭 What you see: the tabs</b></summary>

| Tab | What it shows |
|---|---|
| **Home** | What needs your attention (12 rows by default), a paragraph per tab, and counters on the right that open the tab already filtered |
| **History** | Events of the last 24 h to one year, as dots, bars, curve or heat map; each says what detected it and what read it |
| **Machines** | Every machine with its state, system, access (SSH, agent, API), roles and details; a PC often switched off keeps a greyed card |
| **Services** | NPM hosts and local services (Docker, Apache, ports), status, what to check, filters |
| **Health** | CPU, memory, disks, SMART, temperature, failed services, per machine |
| **Fail2ban** | Bans and jails, once a LogviewR connector is linked |
| **DNS** | AdGuard Home: synchronisation, rewrites, domains to check |
| **Backups** | Which backup sets exist, how old the latest copy is, where the copies live |
| **Diagrams** | Generated diagrams, plus ones you create with a click |
| **Settings** | Machines, connectors, discovery, notifications, backups, accounts, SSH key, schedules, API and MCP, help |

Every filter is a toggle: click to turn it off, click again to turn it back on; several can be on together.

</details>

<details>
<summary><b>🖥️ How machines are read</b></summary>

There are three ways to follow a machine, and they can be combined. The first source that answers is trusted and the next ones complete it (the order is set per machine).

1. **MyServices itself**, nothing else to install:
   - **SSH** (Linux): MyServices connects with its **own key** (shown in Settings -> SSH key) and reads health, Docker, listening services and web servers. The key is never sent anywhere; you authorize it on each machine with one command. A dedicated non-root account in the `docker` and `adm` groups is the safest.
   - **Agent** (Windows): a small read-only PowerShell script, installed as a scheduled task, sends the PC's own health, disks, ports, services, hardware and Docker containers. Nothing to open on the PC.
2. **External services already on your network** (connectors): if you already run Beszel, Proxmox, Uptime Kuma, MynetworK… MyServices reads their API with a read-only key. Nothing is installed on the machine.
3. **Ping and network scan**: only tell whether a machine is on and which apps it answers on. A discreet scan of your local network is run once by hand, then repeats on its own. You choose which machines to follow; it never adds one alone.

<details>
<summary><b>🆚 Agent or external services? What the agent already reads</b></summary>

The Windows agent is one small script. The table lists what it reads on a PC and which external tools you would need to get the same thing. The external column shows what those tools usually cover for this list, not all their features; check their documentation.

| What is read | MyServices agent (Windows) | External tools that would replace it |
|---|---|---|
| CPU load and memory | ✅ | Beszel, windows_exporter (Prometheus), Netdata |
| Disk usage, per drive | ✅ | Beszel, windows_exporter, Netdata |
| Physical disk health | ✅ | Beszel (SMART), windows_exporter |
| Uptime and last boot | ✅ | Beszel, windows_exporter |
| Listening TCP ports and their program | ✅ | Little by default; TCPView by hand |
| Automatic services stopped in error | ✅ | windows_exporter, Zabbix agent |
| Critical system errors (disk, NTFS, WHEA), last 24 h | ✅ | Graylog, Loki with Alloy, Wazuh |
| Failed logons (count, last 24 h) | ✅ (administrator account) | Wazuh, Graylog, Windows event forwarding |
| Pending Windows updates | ✅ | WSUS, Intune, PDQ Deploy, Lansweeper |
| Reboot required | ✅ | Patch managers |
| Hardware: maker, model, BIOS, CPU, cores, RAM, GPU | ✅ | GLPI with FusionInventory, Lansweeper, Snipe-IT |
| Network cards and IPv4 address | ✅ (no MAC address) | GLPI, Lansweeper; MynetworK for the MAC and vendor |
| Running services | ✅ (up to 300) | windows_exporter, Zabbix agent |
| Docker containers on the PC: name, image, ports, state | ✅ | Dockhand or Portainer (Docker API exposed), Dozzle |
| Presence: on, asleep or silent | ✅ (the agent reports itself) | Uptime Kuma (ping or port), MynetworK |
| Installation | One script, one scheduled task, one outgoing connection to MyServices | One service per tool, its own account or key, a port to open on the network |

For Linux machines, the same information comes from SSH, with nothing to install on the machine.

</details>

Machines found but not yet followed, SSH keys to authorize and agents not yet installed are listed under **Settings -> Discovery** and counted in the bell of the header.

</details>

<details>
<summary><b>🔌 Connectors (29)</b></summary>

A connector lets MyServices read a tool through its API, **read-only**: give it a key or account that cannot change anything. Settings -> Connectors lists them, tests each (button **Test**), and shows what the last collection read. A **"Detected services not configured"** table at the top proposes the ones it recognised on your network, with the form already filled.

| Family | Connectors |
|---|---|
| **Web and proxies** | Nginx Proxy Manager, Web-Check |
| **DNS** | AdGuard Home, Pi-hole, Technitium DNS |
| **Monitoring** | Beszel, Uptime Kuma, Dozzle, Prometheus, Healthchecks, Netdata, LogviewR |
| **Home and media** | Home Assistant, Jellyfin, Sonarr / Radarr / Prowlarr…, Frigate |
| **Network** | MynetworK, UniFi Network, Tailscale / Headscale, OPNsense |
| **Security** | CrowdSec |
| **Virtualization and containers** | Proxmox VE, Dockhand, Portainer |
| **Storage and backups** | Proxmox Backup Server, Veeam Backup & Replication, TrueNAS, Synology DSM |
| **Power** | UPS (NUT) |
| **Channels** | Discord, Telegram, webhook |

> The newest ones were written from each service's documentation and **tried against fake servers only**. MynetworK is the one used on a real network so far. Please report what does not match your real services.

Writing a connector: [docs/CONNECTEURS.md](docs/CONNECTEURS.md) (in French). Ideas for more: [docs/IDEES-CONNECTEURS.md](docs/IDEES-CONNECTEURS.md).

</details>

<details>
<summary><b>💾 Backups</b></summary>

Settings -> Backups shows a table of **sources** (click one to unfold its fields):

- **Folders on my machines**: found over SSH in the usual places (`/home/backup` is followed automatically); you tick the ones to watch.
- **Veeam Backup & Replication**: REST API (port 9419) with a read-only account (role *Veeam Backup Viewer*); pick the jobs to follow.
- **Proxmox Backup Server**: backup groups (a VM, container or host per datastore) read with the existing connector's token (role *DatastoreAudit*).
- **Home Assistant**: its automatic backup, through the existing connector's token.

For each followed backup you set the age after which an alert fires, and whether a copy on another machine is required. Cron jobs and timers that look like backups are listed on their own.

</details>

<details>
<summary><b>🔔 Alerts and notifications</b></summary>

- **Channels**: Discord, Telegram, webhook.
- **Alerts**: rules choose which events (machine down, critical health, late backup, new service…) go to which channel, with a delay so the same alert is not repeated. Presets get you started.
- **Notifications**: messages you compose: a **report** of chosen machines and sensors at fixed times, or **live events** filtered by kind, machine or text. Ready-to-use examples can be added in one click, and "Send now" sends a real message.

Failures are confirmed over several passes before an alert is sent.

</details>

<details>
<summary><b>🗺️ Diagrams</b></summary>

Generated with [Archify](https://github.com/tt-a1i/archify) after each collection: the **network map**, **machine access** (every machine under SSH, agent, connector or no access), **backups** and the **alert chain**.

The **Diagrams** tab also proposes ones you create with a click, built from what MyServices already knows: **network equipment and devices** (gateway, switches, Wi-Fi access points and what is plugged into each, read by MynetworK and UniFi), **services per machine**, **domains and their path** (under each NPM and each Apache) and **virtual machines and containers** (Proxmox).

</details>

<details>
<summary><b>🔐 Security and access</b></summary>

- **Read-only by design**: connectors only send GET requests (or read commands over SSH). Passwords and tokens are stored encrypted (`enc:v1`) and never sent back to the page; the private SSH key stays in `config/ssh` (mode 600) and is never shown.
- **Accounts**: local accounts (admin or read-only), password rules, session list, an audit log (filterable, CSV export).
- **Network**: the page only answers private networks and the loopback by default (`MYSERVICES_ALLOW` to change). Do not expose it to the Internet; put it behind a VPN or an authenticating proxy if you need remote access (`MYSERVICES_COOKIE_SECURE=1` behind HTTPS).
- **The container**: runs as user `10001` (never root), read-only file system, no capabilities, `no-new-privileges`, no Docker socket (the host is read over SSH like the others).
- **Guard before commit and push**: `bash scripts/install-hooks.sh` refuses tokens, passwords, keys, `config.json`, `.env`, databases and unreviewed images.

</details>

<details>
<summary><b>⚙️ Configuration</b></summary>

Almost everything is set in the page (Settings). Files and variables, for reference:

| | |
|---|---|
| `./config` | `config.json`, `services-meta.json`, `secret.key`, `ssh/` (the app's key, aliases, `known_hosts`) |
| `./data` | the produced page, caches, state, `myservices.db` (accounts, history, alerts) |
| `MYSERVICES_PORT` | port of the page (default `8090`) |
| `MYSERVICES_ALLOW` | networks allowed to open the page (default: private networks and loopback) |
| `MYSERVICES_HOST_USER` | SSH account of the `hote` alias (the host machine) |
| `MYSERVICES_COLLECT_AT` | schedule of the collection, `minutes hours` (default `10,40 *`); same for the watcher and health |
| `TZ` | time zone |

Schedules can also be edited live in Settings -> Tasks and schedules. A full example is in [`deploy/compose.example.yaml`](deploy/compose.example.yaml).

</details>

<details>
<summary><b>🤖 API and MCP</b></summary>

A REST API (`/api/v1/…`, OpenAPI documentation at `/api/v1/docs`) and an **MCP server** (`/mcp`, `msv_mcp_` token) let your tools and AI assistants read the same data. Create tokens in Settings -> API and MCP, with a validity you choose: **read** (the default), **runs** (read + ask for a collection) or **admin** (settings included; a duration is required and your password is asked). Each MCP tool has its own switch.

</details>

<details>
<summary><b>🧪 Develop</b></summary>

```bash
docker build -t myservices:dev .
docker run --rm --entrypoint python -v $PWD:/src:ro -w /src myservices:dev -m unittest discover -s tests
cd front && npm ci && npm test && npm run dev      # :5180
```

Versions: `python3 scripts/release.py` checks that the version, both READMEs, the changelog and the release notes agree; `release.py patch|minor|X.Y.Z` applies a new one everywhere (it commits, tags and pushes nothing).
`.claude/` is never versioned.

</details>

> Full documentation (detailed installation, every connector, API and MCP) will be written as the project matures; the **Help** page in Settings covers the first steps today.
