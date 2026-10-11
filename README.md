<p align="center"><b>English</b> · <a href="README.fr.md">Français</a></p>

<p align="center">
  <img src="docs/logo.svg" alt="MyServices" width="360">
</p>

<p align="center">
  <b>The state of your services and machines, in one place, read-only.</b>
</p>

<p align="center">
  <a href="https://github.com/Erreur32/MyServices/releases/latest"><img alt="Version" src="https://img.shields.io/github/v/release/Erreur32/MyServices?label=version&color=3da9fc"></a>
  <img alt="Testing phase" src="https://img.shields.io/badge/statut-BETA%20%C2%B7%20testing%20phase-orange">
  <img alt="Not for production" src="https://img.shields.io/badge/production-NO-ef4444">
  <a href="https://github.com/Erreur32/MyServices/pkgs/container/myservices"><img alt="Docker image" src="https://img.shields.io/badge/image-ghcr.io%2Ferreur32%2Fmyservices-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Architectures" src="https://img.shields.io/badge/arch-amd64%20%7C%20arm64-555">
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml"><img alt="Tests and Docker image" src="https://github.com/Erreur32/MyServices/actions/workflows/docker-publish.yml/badge.svg"></a>
  <a href="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml"><img alt="Safety guard" src="https://github.com/Erreur32/MyServices/actions/workflows/safety.yml/badge.svg"></a>
  <img alt="Read-only" src="https://img.shields.io/badge/access-read--only-22c55e">
</p>

> ## ⚠️ Still in testing: do not use in production
>
> MyServices v2 (Docker) is a **BETA**. Screens, settings and data may still change from one version to the next, and several parts have
> only been tried on a single PC or against fake servers (Windows agent, Veeam, Home Assistant backups, NPM connector). **Do not install
> it on a production server**: try it on a test machine or a network you can afford to break, and keep a copy of `config/` and `data/`
> before every update. It only reads your machines, but that is no reason to rely on it until it is declared stable.
>
> Version numbers stay **below 2.0.0** until then (`0.10.0`, `0.10.1`…); 2.0.0 will be the first version announced as stable.
> Details: [CHANGELOG.md](CHANGELOG.md) (always in English) · [RELEASE-NOTES.md](RELEASE-NOTES.md) (in French).

## At a glance

MyServices gathers the services of all your machines and of your local network and shows their live state. It **builds on the tools you
already run** (Nginx Proxy Manager, AdGuard Home, Beszel, Uptime Kuma, Home Assistant, Veeam…) without replacing them: it reads their
API, or the machine over SSH, cross-checks the information and presents it on one page.

- **Read-only**: nothing is ever written to what it observes.
- **A single container**: collection, watcher, health, backups, accounts, API and web page.
- **Tabs**: Home, History, Machines, Services, Health, Fail2ban, DNS, Backups, Diagrams, Settings.
- **Machines are read** over SSH (Linux), by a PowerShell agent (Windows), through an API, or by ping; a PC that is often switched off keeps a greyed card instead of disappearing.
- **History** as dots at the exact time, bars, curve or heat map; every entry says what detected it and what read it.
- **Diagrams** generated with [Archify](https://github.com/tt-a1i/archify): network map, who reads what, machine access, alert chain, backups.
- **Alerts and notifications** on Discord, Telegram and webhook: alert rules, plus your own reports (chosen machines and sensors at fixed times) and filtered live events, with ready-to-use examples.
- **Discoveries** that tell you what runs by itself and what needs a click; `/home/backup` is followed automatically.
- A **REST API** and an **MCP server** for your tools and AI assistants.

## Try it (on a test machine)

```bash
mkdir -p /opt/myservices && cd /opt/myservices
curl -fsSLo compose.yaml https://raw.githubusercontent.com/Erreur32/MyServices/docker/deploy/compose.example.yaml
docker compose up -d
docker compose logs myservices        # the app's public key and the command to authorize it on the host
```

Then open `http://<IP>:8090/myservices/v2/` **within 30 minutes** to create the admin account (after that delay:
`docker compose restart myservices`) and follow the "Premiers pas" (getting started) card. Image: `ghcr.io/erreur32/myservices`
(amd64 and arm64); `:latest` follows the latest tag, `:0.10.0` pins a version, `:docker` tracks the branch head.

Update: `docker compose pull && docker compose up -d` (settings and data live in the `./config` and `./data` volumes).

## Develop

```bash
docker build -t myservices:dev .
docker run --rm --entrypoint python -v $PWD:/src:ro -w /src myservices:dev -m unittest discover -s tests
cd front && npm ci && npm test && npm run dev      # :5180
```

Versions: `python3 scripts/release.py` checks that the version, both READMEs, the changelog and the release notes agree;
`release.py patch|minor|X.Y.Z` applies a new one everywhere (it commits, tags and pushes nothing).

Guard before commit and push: `bash scripts/install-hooks.sh` (refuses tokens, passwords, keys, `config.json`, `.env`, databases,
unreviewed images). `.claude/` is never versioned. Writing a connector: [docs/CONNECTEURS.md](docs/CONNECTEURS.md) (in French).

> Full documentation (detailed installation, machines, connectors, API and MCP, security) will be written once the version is stable;
> the old documentation for the classic install was out of date and has been removed.
