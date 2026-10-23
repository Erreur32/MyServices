# Release notes: MyServices 0.20.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.20.2** (23 October 2026): Backups in fewer places, one page per set, and no more « Invalid Date » on the page of a machine.

## For everyone

**What's new?**
- **One list of sets**: « All sets » and Settings → « Followed sets » showed the same list twice. There is now one « Sets » view, with chips for the sets in use, the flagged ones and the archived ones.
- **One page per set**: « Set » on a row opens everything about that set in one place: name, what is followed, expected schedule, maximum age (with the rhythm advised from the archives seen), copy off the machine, copies elsewhere, archive, remove. The « Archived sets » page and the « ⋯ » menu of the rows are gone.
- **By machine comes first**: its copies elsewhere are short chips (details on hover) and its sets a count, so the table no longer runs off the page.
- **To link**, a new page of Backups → Settings: the local backup folders and the cron lines that no followed set claims, shown directly instead of folded under the machines.
- **Fix**: the page of a machine showed « since Invalid Date » on the network line when MynetworK sent no real date; it now shows nothing in that case.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file or your settings. Old links to a set (`#settings/backups/<set id>`) now open its page.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.20.2` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **MynetworK connector**: `first_seen`, `last_seen` and `ports_at` of a device are kept only when they are text (some MynetworK versions send `{}`).
- **Addresses**: `#backups/all` is « Sets », `#settings/backups/unlinked` is « To link », `#settings/backups` opens « Add backups ».
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
