# Release notes: MyServices 0.25.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.25.0** (26 October 2026) removes several false alerts seen on a real server, shows container states as they are, lets each machine set its own temperature threshold, and gives the MCP tools what they lacked to read and set a server without its pages.

## For everyone

**What's new?**
- **Temperature, your way**: each machine can set the processor temperature from which it is « to watch » (machine card › Options › **Temperature threshold**; critical is 10 °C higher; 85 °C when empty). And a machine is only flagged when it **stays** hot for more than ten minutes: a build, a game loading or a backup no longer makes it blink between OK and warning.
- **Container states are current**: a container stopped, started or left « Created » showed its old state for up to two hours on the Services and Machines pages. The health check already looks at every container at each pass; its reading now refreshes the states, without waiting for the next inventory. A service whose container never started is filed with the « stopped on purpose » ones, grey, not red.
- **A process listening on an internal address is not « down »**: a web server bound to a Docker network address (an Apache behind Anubis, for instance) cannot be reached through the machine's IP. It was probed anyway and shown as a failure. It now reads « internal », up, with the address it listens on.
- **SMART**: a disk the Beszel agent cannot read is no longer announced « in fault ».
- **Menu dots**: clicking a dot now shows exactly what its tooltip counts (health alerts for Machines, services down or warning for Services), and a connector in trouble gets a dot on « Connectors ».
- **Dracula and Ayu Mirage**: filled buttons take a readable accent colour; the browser tab's icon follows the logo you chose.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change, see [MIGRATION.md](MIGRATION.md).

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.25.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **MCP**: new read tool `get_backups`; `status` says the version, the server time and the state of every task; `get_health` carries SMART per disk, Docker (stopped on purpose, issues), temperature and updates with their source, and takes a `query`; `list_services` shows the container state and whether it is stopped on purpose; `machines_config` gains `patch` (change some fields of a machine, keep the others; `temp_warn_c` among them) and `settings_config` gains `task_run`.
- **Health**: `temp_warn_c` per machine (`services-meta.json`, 50 to 110 °C), `TEMP_SUSTAIN_S` = 600 s, `hot_since` kept in `health.json`; the temperature reading carries `level`, `warn_c`, `crit_c`, `hot_s`. `collect_docker` returns `states`, written into the Docker inventory cache (`inventory_cache.update_states`); a container that appeared or disappeared marks the machine « stale ».
- **Services**: listening ports keep their listen address (`process.bind`, `process.internal_bind`); a process bound elsewhere than every interface, the machine's IP or loopback is `internal` with `listen_addr`.
- **Migration**: nothing required from 0.24.2, see [MIGRATION.md](MIGRATION.md).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
