# Release notes: MyServices 0.15.5

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.5** (18 October 2026): the machine window shows the UniFi switch port, GPUs are read without GpuViewR, and connector cards stay up to date.

## For everyone

**What's new?**
- **Where is it plugged?** For a wired machine seen by UniFi, the machine window now shows the front panel of its switch with the port framed.
- **GPU load without GpuViewR**: NVIDIA and AMD graphics cards are read with `nvidia-smi` and `rocm-smi` over SSH or by the Linux agent (load, temperature, memory, power). Update your Linux agents in Settings, Agents to get it.
- **Services down, explained**: the “N service(s) down” warning of a machine lists which services and why, in the health column tooltip and in the machine window.
- **Connector cards up to date**: a “Test” from the page is kept and shown on the card at once, and the Beszel card shows its version and the number of systems after a scan.
- **After an import**: a banner says the collection, the watch and the health are still reading the imported data, then that everything is up to date.
- **Backups**: a missing copy folder now says which path to create and on which machine.
- **Agent uninstall**: no more leftover `myservices-agent.service` in `systemctl --failed`.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.5` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `health.collect_gpu` and `GPU_CMD` (also in `LINUX_AGENT_COMMANDS`); `mark_port` option in the vendored `unifi-device-card` (see its `VENDOR.md`); the answer of a connector test is kept in `connectors-tests.json` (state directory) and merged into the connector states; the light reading of Beszel keeps `total` and `version` in `live.json`.
