# Release notes: MyServices 0.35.7

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.7** (2 November 2026) edits the Tapo camera accounts one row per camera, gives a picture to cameras the discovery cannot name, and removes false DNS and Cloudflare warnings.

## For everyone

**What's new?**
- **Tapo camera accounts, one row per camera**: the « Camera accounts » field is now a list. Each row holds the camera's IP (picked among the devices found, or typed), its login and its password, with a 🗑 to remove it and « Add a camera ». Saved accounts stay hidden until shown with your password.

**Fixed**
- **Tapo cameras without a picture**: some C310 answer the discovery without their model and were listed as « other », so their camera account was never used. A device given a camera account is now a camera, and its picture is asked with that account.
- **DNS, « its name resolves to 127.0.1.1 »**: a DNS server running on the machine itself (AdGuard Home, Pi-hole) answers its own name from `/etc/hosts`. That local address is no longer taken for a wrong record.
- **Cloudflare, access list with the real address**: a NPM host with an access list that takes back the visitor's address (`CF-Connecting-IP`) is no longer said to « resolve outside the LAN » or to « see Cloudflare's addresses ».
- **Agents, « New command »**: it now starts from the address the agent already sends through (an IP and port for a machine outside the network), not from the address of your page. A new token also keeps the boxes and the address of the agent it replaces.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.7` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the agents table gains `reached_url` (added at start). The Tapo `camera_accounts` field keeps its saved form.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
