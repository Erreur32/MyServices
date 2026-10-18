# Release notes: MyServices 0.15.7

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.7** (18 October 2026): adding a machine is redone in four clear steps, with the SSH access tested before the add.

## For everyone

**What's new?**
- **Add a machine, step by step**: Settings → Machines → « Add a machine » now walks through four steps, one open at a time: the target and its detection; what was found (with the web services to follow); the access, as a three-button choice between SSH, an agent or none, with the account, the port, the key to authorize and a « Test the connection » button before anything is saved; then the identity and the options as one flat list of switches, the detected ones already on. One button adds the machine. Cancelling writes nothing, the SSH access prepared for the test included. The assistant uses the same frame.
- **Custom SSH access**: in a machine's SSH section, an account and a port for a server outside the local network or on a non-standard port.
- **Machine window**: the Agent and Connectors sections open by themselves when something is active there, and stay closed when empty.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.7` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `POST machines/ssh-alias/test` (check of the alias of a machine not declared yet) and `DELETE machines/ssh-alias/{ip}` (removes an alias written by the page, never a hand-written one nor one used by a declared machine). Front: `components/AddMachine.tsx` replaces the old `Detect` and `Proposal` of the Machines settings.
