# Release notes: MyServices 0.31.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.3** (30 October 2026) lets you stop caring about Security findings that do not matter to you, and fixes how a machine seen by VMware is told what access it can have.

## For everyone

**What's new?**
- **Security: ignore what does not matter.** Every finding has a « Stop reporting » button, and each area (sites, ports, SSH, certificates, Fail2ban, access) can be switched off as a whole. Ignored points sit in a folded « Ignored points » panel with a « Put back » button, and no longer count in the menu dot or the tiles. Handy for ports that are open on your local network only.
- **Security > Exposed sites** has a new design: one row per site, a bar for how many of the 5 checks pass, and one badge per check.
- **Backups > By machine**: the « Sets produced » column is now a button that opens the sets of that machine, and the machine name opens its page.
- **Fix, access advice.** A machine listed by a VMware connector (a Windows PC seen by vCenter, for instance) was taken for an ESXi host and told « No agent possible ». It now gets the right advice.
- **ESXi hosts** can have an agent. It is offered last, after the connector and SSH, with a warning: VMware does not plan for it and it may disappear after a reboot.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.3` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: new `GET/PUT /api/v1/security/ignore` (admin) and a `security_ignore` list in `services-meta.json`, empty by default.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.2, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
