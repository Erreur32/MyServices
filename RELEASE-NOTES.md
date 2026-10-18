# Release notes: MyServices 0.15.4

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.4** (18 October 2026): MynetworK and the UniFi controller are asked less often.

## For everyone

**What's new?**
- **Fewer requests to MynetworK**: with the Network tab open, the UniFi cards were read every 10 seconds and each reading makes MynetworK query the UniFi controller, which could end in “MynetworK: unreachable (timed out)” and slow the controller down. They are now read every 30 seconds, the live traffic every 20 seconds, and after a failed reading the source is left alone for 2 minutes.
- **Turning a connector back on**: if its source does not answer at that moment, the page now offers “Turn on anyway (without a test)” instead of leaving the switch off.
- **Warnings that stay**: a connector warning no longer waits up to 15 minutes to disappear once the source answers again; the next light reading (every 5 minutes) clears it.
- **Failure messages**: the message after an action that failed now opens in a window over the page, wherever you are on it, and stays as a red line once closed.
- **Beszel in Settings, Connectors**: the card no longer says “not read yet” after every collection; it shows the state of the last light reading.
- **MynetworK no longer fails when UniFi is slow**: its three UniFi routes are read at the same time with a longer delay, and if UniFi still does not answer the inventory is kept and the page says “UniFi unavailable” instead of showing MynetworK as unreachable.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.4` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Changed**: `unifi_cards.TTL` 8 → 30 s and `TTL_FAILED` 120 s; `network_stats` live traffic 8 → 20 s; the page polls at 30 s and 20 s.
