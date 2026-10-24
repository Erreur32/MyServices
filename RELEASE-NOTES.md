# Release notes: MyServices 0.22.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.22.0** (24 October 2026): two new pages, « AI and agents » and « Video and cameras », six new connectors, and the service page edited in place.

## For everyone

**What's new?**
- **AI and agents** (Inventory menu, shown when you have an AI service): your engines and their models, the agents and their platforms, the MCP servers, who talks to whom, and each GPU (memory, compute, temperature, power). A service no connector reads is drawn dotted, with « Add a connector » already filled with its address.
- **Video and cameras** (Inventory menu, shown when you have a camera recorder, a stream relay or a live broadcast): the cameras filming or silent, recording and detecting, the events of the last 24 hours, the streams and who reads them, and the space taken by the recordings. An admin can see the picture of a camera **only by clicking its play button**: nothing from a camera loads by itself, the picture is never kept, and each view is written to the audit log.
- **New connectors**: Shinobi, go2rtc, MediaMTX and Owncast for video; Open WebUI and « OpenAI-compatible API » (vLLM, LM Studio, LocalAI, KoboldCpp, LiteLLM) for AI. Ollama, llama.cpp, Hermes, GpuViewR and Frigate read more than before.
- **Frigate with an account**: the connector can now sign in to the protected port 8971 (a « viewer » account is enough); port 5000 still works without one.
- **A new « Stream » category** in Services for everything that films or streams; Frigate moves there from Home automation (see the migration guide to use it in your own settings).
- **The service page, edited in place**: « Edit » turns each value into its field on the same page, says where each value comes from (detected, automatic, set by hand) and lets you set a display name, an icon, the app, the address to open and an alerts level.
- **Health alerts in short words**: « Health good », « Health to watch », « Health critical », « Machine unreachable », in both languages.
- **Fix**: in Backups, a machine read by a connector you switched off on purpose is « connector off », no longer an alert.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change; the « Stream » category is optional, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.22.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **New route**: `GET /api/v1/stream/snapshot?connector=&name=&camera=` (admin only): the picture of a camera seen at the last collection, JPEG or PNG only, `Cache-Control: no-store`, written to the audit log.
- **Connectors**: each video connector adds a common `stream` block to its result (cameras, streams, storage, events, live), each AI connector an `ai` block. Camera and source addresses (rtsp, often with a password) are never kept. Frigate's session token stays in memory only.
- **Request counters**: path segments of 20 characters or more are masked (`/*`), so a key carried in a path (Shinobi) never reaches them.
- **`services-meta.json`**: per-service keys `name`, `icon`, `app`, `open_url`, `alerts` (all optional); new « Stream » rule in the example file.
- **Migration**: nothing required from 0.21.0, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
