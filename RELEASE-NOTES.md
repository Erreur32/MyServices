# Release notes: MyServices 0.35.5

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating.

**0.35.5** (2 November 2026) tells the update of each agent in words, and announces a new version only once its image can be pulled.

## For everyone

**What's new?**
- **Agent update in its own column**: on the Agents page, an « Update » column holds the choice **Auto** or **Manual** and where the update stands: up to date, « vN at the next report », requested, « when switched back on » for a machine that is off, or in manual a « ⬆ vN » button. The lone ⬆ icon, greyed once clicked, is gone.
- **Update not applied**: when an agent is still in its old version two reports after the update was offered, the column says « not applied » in orange, with a hint to look at `agent.log` on the machine.
- **Top button and tile**: « Update the late agents » and the « To update » tile count only the agents in manual whose machine answers. The ones in Auto update by themselves, and a machine that is off cannot.

**Fixed**
- **« New version available » too early**: the version check waited only for the GitHub release, a few minutes before the Docker image existed, so `docker compose pull` could still find nothing. It now waits for the image on ghcr.io, and asks again after 10 minutes while it is missing.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing else to do. See [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.35.5` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agent**: no change, Linux agent version 11.
- **Server**: the agents table gains `update_offered` (added at start). The version check makes two anonymous requests to ghcr.io, only when a newer version is found.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
