# Release notes: MyServices 0.38.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.38.4** (6 November 2026) removes two false warnings and makes the « DNS absent » alert say where the entry is.

## For everyone

**Fixed**
- **No more « erreurs noyau récentes » after a restart**: an empty kernel line printed at boot counted as a kernel error.
- **Weekly backup copies no longer « late »**: a copy whose « via » names a weekday (« rsync lun. 05:00 ») was expected every day, so an archive made by hand on a Thursday made it « late » on Friday. Without a rhythm set, such a copy is now judged weekly, and its settings show 7 days.

**Changed**
- **« DNS absent » says which NPM holds the entry**: the hint names the NPM, its page (Proxy Hosts, Redirection Hosts…) and the entry number, so an entry kept on a second NPM is found at once.
- **Services: the follow button shows the state**: an open eye in green for a followed service, a crossed eye in orange for a hidden one; a click switches it.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.38.4` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agents**: unchanged (Windows v11, Linux v11).
- **Server**: `KERNEL_IGNORE_RE` drops a kernel line with no text; `backups.every_days_of()` gives a copy's rhythm (setting, else 7 when the « via » names a weekday, else 1), used by the copy grace and the settings page.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
