# Release notes: MyServices 0.34.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.34.0** (1 November 2026) lets the Linux agent read most of what needed SSH, so a machine can be followed without opening SSH to it.

## For everyone

**What's new?**
- **Less SSH**: the Linux agent can now read backup folders, Nginx Proxy Manager, the local DNS (AdGuard Home, Pi-hole, dnsmasq, Unbound, BIND), Proxmox VE, KVM, Incus, LXD, adguardhome-sync and borgmatic.
- **Boxes in the install command**: tick what the agent may read, the command is written for you.
- **Your secrets stay put**: the server never sends a command or a path to the agent. Passwords and passphrases stay on the machine.
- **Agents page**: it now says when an agent lacks a right, and the sudo box is ticked by default.
- **Settings, Requests**: SSH reads are counted, per machine and per kind of read, including those of scheduled tasks.
- **Agents outside your network**: a machine with a live agent on a public address no longer needs a special setting.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). The new reads are optional: each needs the agent installed again with its option. Nothing stops working if you wait, SSH stays in use. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.34.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: Linux agent version 7. Options `MSV_DNS`, `MSV_BACKUPS`, `MSV_BACKUP_DIRS`, `MSV_BORGMATIC`, `MSV_NPM`, `MSV_SUDO`.
- **Not tested on every setup**: Pi-hole, dnsmasq, Unbound, BIND, KVM, Incus, LXD and borgmatic were tested on sample outputs only. Try one machine first.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
