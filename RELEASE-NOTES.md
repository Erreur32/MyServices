# Release notes: MyServices 0.16.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.16.0** (18 October 2026): the server tells the page what changed. Nothing is read at rest, and the state of a pass shows up at once.

## For everyone

**What's new?**
- **Live page, zero requests at rest**: the page keeps one connection open and the server sends an event when a file was produced, when a pass starts, progresses or ends, and when a task ran. The home page, the progress bar, the schedule card and the discovery panels react to these events instead of asking again and again. If the connection drops (a proxy, a sleep), the browser reconnects by itself and the page falls back on a slow read in the meantime.
- Also in this version line: the manifest-guided refresh (0.15.9) and the parallel connector reads (0.15.8).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file. Behind a reverse proxy, server-sent events need response buffering off for `/api/v1/stream` (the response already asks for it with `X-Accel-Buffering: no`).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.16.0` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `GET api/v1/stream` (server-sent events: the current state first, then `manifest`, `status`, `tasks`, heartbeat every 25 s, `Content-Encoding: identity` so the gzip middleware leaves it alone); `live_events.py` (subscribers, watcher thread comparing the three sources every second while a stream is open); front `lib/stream.ts` shared by `App`, `ScanBar`, `ScheduleCard` and `DiscoveryCard`, with safety reads of 1 to 2 minutes while disconnected.
