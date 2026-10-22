# Release notes: MyServices 0.18.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.18.4** (22 October 2026): security update: the image moves from Node.js 20 (end of life) to Node.js 22.23.4, fixed for CVE-2026-111497.

## For everyone

**What's new?**
- **Security**: the image now runs Node.js **22.23.4** instead of 20.19.2. Node 20 (the version Debian trixie ships) has an out-of-bounds write in its Brotli decoder (CVE-2026-111497, possible remote code execution) and, being end of life, will not be fixed. Node only draws the infrastructure map (Archify); nothing else changes.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.18.4` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: the Debian `nodejs` package is no longer installed; the runtime stage copies `/usr/local/bin/node` from the `node:22-trixie-slim` build stage (same trixie base and glibc). npm is not shipped (Archify needs none).
