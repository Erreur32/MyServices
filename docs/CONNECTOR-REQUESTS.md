# How to request a new connector

A **connector** lets MyServices read a service you already run (an app, a device, a platform) and show what it knows, next to your
machines and services. MyServices does not replace your tools: it gathers what they say in one place.

> MyServices is still in development. Requests are read and ranked, but nothing is promised: a connector is written when the service
> is common enough, its API is documented and someone can test it on a real instance.

## The rules every connector follows

- **Read-only.** A connector only reads (HTTP `GET`, or a login that returns a token). It never starts, stops, changes or deletes anything on
  the service. A test in the repository forbids write calls on the most sensitive ones.
- **A dedicated, minimal access.** You create a read-only token or account on the service; MyServices stores it encrypted and never shows
  it again (the page says "configured").
- **Your network only.** A connector talks to the address you give it. Nothing is sent to a third party.
- **Tolerant.** A missing field becomes "not readable" for that value, never an error that stops the others. One broken connector does not
  block the rest.

## What a connector can be

Every connector declares one or more **families** (`kinds`): what it brings to MyServices.

| Family | What it brings | Already there (examples) |
|---|---|---|
| `status` | The state of the service itself: version, updates available, health of the app, a few key numbers | Home Assistant, Jellyfin, Frigate, Glances, CrowdSec, Healthchecks, Netdata, the *arr apps, Ollama, Backrest |
| `inventory` | Lists of machines or processes | Docker by SSH, listening processes by SSH |
| `network` | Devices and clients seen on the network, gateways, lines | MynetworK |
| `health` | CPU, memory, disks, SMART, temperature, failed services of machines | Beszel |
| `backups` | Jobs, last run, size, where the copies are | Veeam, remote folders (FTP, FTPS, Samba) |
| `dns` | Rewrites, domains, servers in sync | AdGuard Home |
| `security` | Bans, threats, scenarios | LogviewR (Fail2ban), CrowdSec |
| `containers` | Container managers: environments, containers, image updates | Dockhand, Portainer, Arcane, Dozzle |
| `virtualization` | Nodes, virtual machines, storage, backups of VMs | Proxmox VE and Backup Server, vCenter, Unraid, Pulse |
| `services` | Services published or watched, certificates, uptime | Nginx Proxy Manager, Uptime Kuma, Web-Check |
| `logs` | Log lines or log sources | Dozzle |
| `alerts` | A place to send alerts to | Discord, Telegram |

A request can ask for a new family when none fits (cameras, power and UPS, storage and NAS, media are the ones we already foresee).

## How a connector reads the service

| Access | Typical case | What you provide |
|---|---|---|
| HTTP API with a key or token | most self-hosted tools | the URL and a read-only key |
| HTTP API with a login | tools that only have a session login | the URL and a dedicated account |
| HTTP API without authentication | status pages, some local tools | the URL |
| Metrics endpoint (Prometheus format) | exporters, Netdata, many appliances | the URL of `/metrics` |
| SSH command | a service with only a command line | an SSH access that MyServices already has to the machine |
| Local share | backups on a share | the path or share and a read-only account |

Not possible, or not wanted: anything that needs a write, a paid cloud account that sends your data away, scraping a web page that has no API,
or a closed protocol without documentation.

## How to ask

1. **Look first.** Search the [issues](https://github.com/Erreur32/MyServices/issues?q=label%3Aconnector-request) and
   [`docs/IDEES-CONNECTEURS.md`](IDEES-CONNECTEURS.md) (the list of ideas, in French): your service may already be listed.
2. **Open a "Connector request" issue** (New issue, then "Connector request"). The form asks for:
   - the service, its website and the version you run;
   - the family (what it would bring) and **what exactly should be read**;
   - how the service can be read (API with a key, login, SSH, metrics) and a link to the API documentation;
   - **one anonymized sample answer of the API** (names, addresses and tokens replaced). This is the most useful thing you can give,
     because tests are written from real answers;
   - whether you can test a first version on your own instance.
3. **If it is only a vague idea**, start a thread in [Discussions](https://github.com/Erreur32/MyServices/discussions), category "Ideas".
   When it becomes precise, it turns into an issue.

**Never paste a real token, password or private address, in an issue, a discussion or a screenshot.**

## What happens next

| Step | Label | Meaning |
|---|---|---|
| Received | `connector-request` | Your request is in the list |
| More information needed | `needs-info` | Something is missing (often a sample answer or the API link) |
| Accepted | `planned` or `later` | It will be written, soon or when its turn comes |
| Waiting for a tester | `tested-by-reporter` | A first version exists and needs a real instance |
| Done | closed | It ships in a numbered version, listed in the [changelog](../CHANGELOG.md) |

A request that does not fit the rules above (writes, cloud-only, no documented API) is answered with the reason and closed.

## For those who want to write it

The technical contract, the helpers provided by the core, the test method with recorded answers and the rules are described in
[`CONNECTEURS.md`](CONNECTEURS.md) (in French). In short: one file in `connectors/`, a class with a `type`, `label`, `kinds`, `fields`,
a `test()` and a `collect()`, then an entry in `TYPES`. Pull requests are not handled for now (see the README); open an issue or a
discussion first so the work is not lost.
