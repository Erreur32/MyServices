# Release notes: MyServices 0.15.6

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.6****0.15.6** (18 October 2026): backups declared on another install now find their machines again.

## For everyone

**What's new?**
- **Backups after a move to Docker**: a machine declared with an SSH name this installation does not know (“Could not resolve hostname”, “Host key verification failed”, wrong port) is now reached through the access of the followed machine with the same address, port included. A machine noted “local” is no longer looked for inside the container (“source: folder absent”). Nothing to edit by hand in the SSH config.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.6` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `backups.resolve_ssh` (with `ssh_aliases` and `machine_aliases`) resolves each declared machine's access from its address at each collection; a host with an API or a mount is left as declared.
