# Release notes: MyServices 0.14.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.14.0** (18 October 2026): the Network tab is public, with UniFi device cards, a network scan summary and a Diagnostic page that spots slow links.

## For everyone

**What's new?**
- **Network tab, now public**, with a sub-menu: Overview, Equipment and devices (with a search bar and filters), and Diagnostic.
- **UniFi cards**: your switches, gateway and access points drawn like the real thing (ports, link speed, PoE, live traffic lights). Drag them to reorder, resize them with the mouse, fold the frame. They are read through MynetworK 0.11.1 or later.
- **Network scan summary**: counters, addresses that are offline with their last reading, worst latencies and the data volume per client. Foldable.
- **Diagnostic**: ports that negotiated below what they can do, a device or the internet link down, firmware updates, overloaded or hot devices, weak Wi-Fi, an address used by two devices, high latencies. The network cards of your machines (read over SSH or by the Windows agent) are shown next to the switch port, and a machine running at 100 Mb/s or less is flagged, which is rare for a computer. The columns can be sorted. Ports that are fine can be shown on request.
- **"This is normal"**: on a finding that is expected (a smart-home hub that only does 100 Mb/s, for example), an admin can click the check mark and it stops being reported. The finding can be shown again or brought back at any time.
- **Live feedback while it works**: a searching orb in the header and a livelier progress bar while a collection or a network search runs.
- **Fix**: Settings, Updates now shows the right "latest published" version even when a tag has no release.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.14.0` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **New**: `unifi_cards.py`, `network_stats.py`, `network_diagnostics.py`; routes `GET /api/v1/unifi/cards`, `GET /api/v1/network/stats`, `GET /api/v1/network/diagnostics` and `POST /api/v1/network/diagnostics/accepted` (admin); `MynetworK.card_devices()`; the vendored MIT `unifi-device-card` (`front/src/vendor/`) and the `thinking-orbs` package.
- **Changed**: `hostinfo.py` and `health.py` report the network cards (`info.nics`, `agent.hardware.nics`); `about.py` falls back to the GitHub tags for the latest version; the header orb and progress bar.
- **Needs**: MynetworK 0.11.1+ for the cards, 0.11.2+ for traffic per client and scan counters.
