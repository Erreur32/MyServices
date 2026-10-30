# Release notes: MyServices 0.31.8

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.31.8** (30 October 2026) makes the warnings tell the truth: nothing asks for SSH on a machine its agent already reads, and the **home page** gives the exact trouble and opens on it.

## For everyone

**What's fixed?**
- **Machines: the agent comes first.** An open SSH port no longer asks for anything: the « Unfinished » notice, the « SSH access to set up » badge and the reminder of the network search are gone. A machine read by its agent gets no warning about a refused key, a wrong port or an unreadable Docker. These checks stay for a machine that depends on SSH.
- **Home: health warnings.** A warning names the machine and its exact trouble with its value (« disk / 91 % full »), two causes at most. Its button opens the machine page on the frame that explains it, and that frame flashes.
- **Home: services.** A service in trouble gives its exact reason and opens the list on its card, with the « To check » frame in view and flashing. Up to three NPM entries in warning get a line each; more stay grouped so the page stays short.
- **Wording.** The button « Machine settings » is now « Settings », and a machine out of reach is no longer said to be out of reach « in SSH ».

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.31.8` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **API and storage**: no change to the data. The discovery list no longer carries `key_refused` for a machine read by its agent. Two new page addresses: `#machines/<ip>/watch/<notice>` and `#services/all/<key>`. No new dependency.
- **Agents**: unchanged (Linux agent 4, Windows agent 9). Installed agents keep running as they are.
- **Migration**: nothing required from 0.31.7, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
