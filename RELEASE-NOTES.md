# Release notes: MyServices 0.18.1

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.18.1** (19 October 2026): MyServices follows the new limits of the MynetworK API (calls per minute and per token) without losing the detail of the machines, and a development build shows what each connector asks, route by route.

## For everyone

**What's new?**
- **MynetworK, limits per API token** (MynetworK 0.11.3 limits a token to 300 calls per minute, and to 30 per minute on the detail of an address and on the live traffic): MyServices now reads the detail sheets of the followed machines thirty per pass with a minute between two passes, so a network of more than thirty machines no longer hits the limit; when MynetworK still answers « too many requests » the reading waits for the delay it gives and keeps what was already read, and the log says so (Settings › Logs).
- **MynetworK, lighter reading**: the Freebox hosts are read in their compact form (older versions of MynetworK ignore the option).
- **For developers, on a development image only**: a folded « Requests (debugging) » panel under each connector card (Settings › Connectors) and under Network › Diagnostic counts every call of the connectors per route (per minute, per hour, total, durations, last code, 429 answers with their delay, last error) and the readings served by the caches, and points out a route near a known limit. Nothing of it exists on a released image.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.18.1` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `connectors/reqstats.py` (counters per connector and route, in memory), `RateLimited` in `connectors/base.py` (a 429 with its Retry-After, logged), `Context.bound()` (the calls counted under « type/name »), `GET /api/v1/connectors/requests` (admin, development builds only, 404 otherwise), `components/RequestStats.tsx`.
- **Changed**: `fast.py` reads the detail sheets `DETAILS_PER_PASS` (30) per pass with `PASS_GAP` (60 s) between passes and a `details_wait` after a 429; `connectors/mynetwork.py` asks `/api/lan/devices?compact=1`.
