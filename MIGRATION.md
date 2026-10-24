# Migration guide

What to change, check or expect when updating MyServices from one version to the next. One section per version, newest first. When a
section says **Nothing to do**, `docker compose pull` then `docker compose up -d` is the whole update.

Keep a copy of `config/` and `data/` before any update.

## 0.20.2 → 0.21.0

**Nothing to do.** No change to the compose file, the image's volumes or variables, `config.json` or `services-meta.json`.

- **Agents**: the Windows and Linux agent scripts are unchanged (Linux agent 4). Installed agents keep running as they are.
- **Security, to know**: an admin token (API or MCP) can now manage the agents (list, create, update, revoke, purge) and every backup setting. Until 0.20.2 the agents needed a browser session. Accounts, tokens, showing a saved secret, installing `npm-api.sh` and the config import stay closed to tokens.
- **MCP, optional**: four new admin tools (`connectors_config`, `backups_config`, `agents_config`, `validate_config`) are **off** until you switch them on in Settings › API and MCP; each answers `help` with its actions. Every change they make is in the audit log as `mcp:<token name>`.
- **Behaviour that changes by itself**:
  - The side menu is tidied up: « Activity » (requests, audit log, logs), Notifications under Administration, the app's SSH key on Machines › SSH connections. Old addresses redirect: `#settings/network` → `#settings/discovery`, `#security/watch` → `#security/overview`, `#settings/ssh` → `#settings/machines/ssh`.
  - The header shows a new release found by the last check, automatic or by « Check now », even with the automatic check off; a « Notices in the header » switch (per browser) turns that off in Settings › Updates.
  - The theme is chosen in the profile only (three more dark themes: One Dark, Nord, Dracula); the account menu has a language switch instead of the light/dark one.
  - At startup the logs give the app's SSH key by its fingerprint only: the public key and the command to authorize it are in Machines › SSH connections. The app keeps its last 10,000 log lines (was 3,000).

## 0.20.1 → 0.20.2

**Nothing to do.** No change to the compose file, the image's volumes or variables, `config.json` or `services-meta.json`.

- **Agents**: the Windows and Linux agent scripts are unchanged (Linux agent 4). Installed agents keep running as they are; no update is offered, none is needed.
- **Behaviour that changes by itself**:
  - A Linux machine with an agent sending fresh reports now gets its health from the agent first; SSH takes over if the agent goes silent. An order set by hand for a machine (`health_sources` in `services-meta.json`) still wins.
  - The figures of each machine are kept 24 hours in the SQLite base (new table `metric_samples`, created on its own): the curves of the machine page fill in over the first minutes (agent) or hours (SSH only).
  - Services › New services no longer lists what a set connector already reads.
- **Optional, Wazuh**: the Wazuh connector has three new optional fields for its indexer (`indexer_url`, `indexer_username`, `indexer_password`) to read the alerts and vulnerabilities. Without them it works as before. Its guide explains the second, read-only user (backend role `readall`). Reload the page once after updating so the connector form shows the new fields.
- **Addresses**: `#settings/machines/ssh/<ip>` is still the page of one SSH connection; `#settings/machines/ssh/new` adds one; `#settings/machines/agents/<ip>` now opens the Agents list with that row lit (the agent's buttons are on its row).
