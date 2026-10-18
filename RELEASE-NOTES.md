# Release notes: MyServices 0.15.9

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.9** (18 October 2026): the page reads only what changed, and the SSH section of a machine is redone.

## For everyone

**What's new?**
- **One small request at rest**: the server publishes a manifest of its produced files, and the page reads a file again only when it moved. At rest the home page makes one small request every 15 seconds instead of a dozen revalidations per minute, with the same freshness. An older server without the manifest is read as before.
- **SSH section of a machine, redone**: one « Connection parameters » block with the SSH address (the machine's IP, or a DNS name when it is reached another way), the port, the account and « Save and test » with the result lines; the app key to authorize, with the command for the typed account, folded under it; then the connection state. The first activation opens the parameters in place.
- **Listening ports with a non-root account**: the collection tries a sudo rule first, and the window gives the one-line rule to put on the machine behind a discreet « How to set it up on the machine? » link.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.9` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `GET api/v1/manifest` (stamp of data, pulse, live, events, health and backups files); `POST machines/ssh-alias` takes `host`; `machines_admin._alias_for` finds a machine's alias through its settings.
- **Changed**: front `loadSnapshot` keeps what it read and re-reads only the files whose stamp moved (`snapshot.test.ts`); one 15 s loop in `App.tsx`; `components/SshParams.tsx` shared by the add frame and the machine window; `connectors/process.py` runs `sudo -n ss -tlnpH || ss -tlnpH`.
