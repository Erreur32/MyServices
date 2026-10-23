# Release notes: MyServices 0.19.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.19.1** (23 October 2026): Veeam says which machines each job backs up, the machine window shows it, and computers backed up by Veeam Agent are no longer missing.

## For everyone

**What's new?**
- **Veeam, on the machines**:
  - each job now gives what it backs up: every VM (or computer), the host it runs on, its size and its restore points;
  - a VM goes to the machine of the same name: its window shows « Backed up by Veeam » (job, host, repository, age, VM size, points);
  - a hypervisor (ESXi, Hyper-V) lists the « VMs backed up here », the ones with no machine of the same name flagged « not linked ».
- **Veeam wizard**: under each job, its VMs and a « machine » menu (the one found by name, another one, or « no machine »). « Change the machines » on a job already followed keeps its name and alert threshold.
- **Computers backed up by Veeam Agent** (managed by B&R): Veeam 12.0 leaves them out of its job list; MyServices now reads them from their backups, with the date of the newest restore point.
- **Fix**: « (inactive) » no longer follows the last result of a Veeam job (Veeam 12 writes its states in lower case), and a disabled job is recognised again.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file. To link the VMs to your machines, open Settings → Backups → Veeam and search the jobs again.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.19.1` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Veeam reads** (all optional, kept 30 min when a cache is available): `GET /api/v1/jobs` (VMs per job), `/api/v1/backups`, `/api/v1/backups/{id}/objects` (restore point counts), and for a backup without a job `objectRestorePoints?backupIdFilter=` (else `backupObjects/{id}/restorePoints`).
- **backups.json**: a Veeam location gives `job`, `repository` and `objects` (`name`, `host`, `size`, `points`, `machine`, `machine_by`, `runs_on`); a set location may hold `machines` (object name → machine IP, `""` = none), set by `PUT /backups/veeam`.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
