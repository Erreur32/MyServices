# Migration guide

What to change, check or expect when updating MyServices from one version to the next. One section per version, newest first. When a
section says **Nothing to do**, `docker compose pull` then `docker compose up -d` is the whole update.

Keep a copy of `config/` and `data/` before any update.

## 0.20.1 → 0.20.2

**Nothing to do.** No change to the compose file, the image's volumes or variables, `config.json` or `services-meta.json`.

- **Agents**: the Windows and Linux agent scripts are unchanged (Linux agent 4). Installed agents keep running as they are; no update is offered, none is needed.
- **Behaviour that changes by itself**:
  - A Linux machine with an agent sending fresh reports now gets its health from the agent first; SSH takes over if the agent goes silent. An order set by hand for a machine (`health_sources` in `services-meta.json`) still wins.
  - The figures of each machine are kept 24 hours in the SQLite base (new table `metric_samples`, created on its own): the curves of the machine page fill in over the first minutes (agent) or hours (SSH only).
  - Services › New services no longer lists what a set connector already reads.
- **Optional, Wazuh**: the Wazuh connector has three new optional fields for its indexer (`indexer_url`, `indexer_username`, `indexer_password`) to read the alerts and vulnerabilities. Without them it works as before. Its guide explains the second, read-only user (backend role `readall`). Reload the page once after updating so the connector form shows the new fields.
- **Addresses**: `#settings/machines/ssh/<ip>` is still the page of one SSH connection; `#settings/machines/ssh/new` adds one; `#settings/machines/agents/<ip>` now opens the Agents list with that row lit (the agent's buttons are on its row).
