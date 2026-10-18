# Release notes: MyServices 0.15.8

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.8** (18 October 2026): fewer requests, same freshness. The first tier of the request audit.

## For everyone

**What's new?**
- **Collection bounded by the slowest service**: every connector of every kind is read at the same time, so adding connectors no longer stretches the pass. The version of a service is asked every 6 hours instead of every pass.
- **A quieter page**: at rest the home page makes about half as many requests as before (the schedule card, the scan bar and the live tick are paced), and a change reloads the data once, then follows it for one minute instead of two and a half. Nothing is read while the browser tab is hidden.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.8` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `myservices.connector_rows(kinds)` and `fast.refresh` use a thread pool; `connectors.base.run_isolated` keeps `version_at` in the connector state (`VERSION_EVERY` = 6 h); `system._memoed` (5 min) for folder sizes and the key fingerprint; front `READ_ONLY` covers `/refresh`, `/redetect` and `assistant`; `FAST_MS` 15 s for 60 s; `ScheduleCard` 15 s at rest.
