# Release notes: MyServices 0.17.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.17.0** (19 October 2026): one reader per connector, sortable meters, Connectors and Machines pages tidied.

## For everyone

**What's new?**
- **One reader per connector**: the server now reads each connector at its own pace and shares the result with the collection, the health check and the live view. A service is called once per period, not by three tasks in a row; a slow controller can be read every 10 minutes while Beszel is read every minute. Set the period in the connector's card (« Read every », minutes); the default is « Connector readings » in Settings → System (0 = off, every task reads by itself as before).
- **Machines table**: the CPU, Memory, Disk and GPU columns sort; the percentages are smaller than the data; no more dot on the machine icon.
- **Connectors page**: your connectors sit inside their own frame, two columns on wide screens; « Already read over SSH » is folded under the title.
- **Seen by your tools, not followed here** now lives in Settings → Machines, where machines are added.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.17.0` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `readers.py` (server loop, due connectors read in parallel into `connectors.json`); `connectors/base.py` `period()`, `status_of()`, `merge_state()`; connector field `every`; `components/UnlinkedDevices.tsx`.
- **Changed**: `myservices.py`, `health.py` and `fast.py` reuse the shared reading (direct read kept as a fallback); `fast_every` is the default reader period.
