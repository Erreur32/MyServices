# Release notes: MyServices 0.37.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.37.4** (4 November 2026) stops the « SECURITY information » mails that sudo sent at every pass when an SSH account has no sudo rule.

## For everyone

**Fixed**
- **No more sudo mails at every pass**: sudo mails every refused try, even when MyServices only asks without a password (`sudo -n`). A machine read over SSH with an account that has no sudo rule got one mail per pass of health, backups, ports or DNS. A refused sudo is now remembered per machine and per read, and not asked again for 24 h. Once you add the rule the page gives, « Relire » on the machine asks again at once, and the reading comes back.
- **Backups read through Proxmox**: a machine whose root crontab is read through Proxmox (`cron_via`) no longer gets a sudo for it over SSH.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.37.4` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11. An agent installed without the sudo option runs with `NoNewPrivileges`, so its sudo fails before logging anything.
- **Server**: new `msv/core/nosudo.py` (`state_dir/nosudo.json`), used by health (needrestart, Fail2ban, SMART), backups (root crontab), ports (`ss`) and the AdGuard Home connector. The commands the agents run keep the exact same text.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
