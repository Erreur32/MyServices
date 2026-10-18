# Release notes: MyServices 0.15.2

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.15.2** (18 October 2026): server messages in English, UniFi cards without MynetworK, and the Security page finishing touches.

## For everyone

**What's new?**
- **English server messages**: the fixed error messages, the connector messages and the event labels written by the server are translated when the page is in English. A message that carries a value (a name, a code) is still in French for now.
- **UniFi cards without MynetworK**: if a UniFi connector is set up with a local account (for example a controller running in Docker), the cards of the Network tab are read straight from the controller. MynetworK stays the first source. An API key (UniFi OS console) cannot give the ports, so it is not used for the cards. This was only tested with a fake controller so far.
- **Security overview and Fail2ban tab**: the threat cards name the domains the addresses went after, and the jail, domain and address panels start folded (each visitor's choice is remembered).

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.15.2` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit.
- **Added**: `front/src/lib/server-text.json` and `lib/serverText.ts` (a test fails when a fixed server message has no English text); `UniFi.card_devices()` and `unifi_cards._from_controller`; LogviewR threats get `domains`.
- **Changed**: MynetworK read errors show a fixed text on screen (the detail stays in the container log); the Fail2ban blocks are `FoldPanel`s.
