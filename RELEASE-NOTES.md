# Release notes: MyServices 0.18.3

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.18.3** (21 October 2026): Network in one sub-tab per source with SFP modules and port errors in its diagnostic, services you can edit, declare public or hide from « To watch » right from the page, and a container that no longer fills with zombie processes.

## For everyone

**What's new?**
- **Network**: one sub-tab per source, UniFi first, then Freebox (when one is linked), Scan, Devices and Diagnostic. The **Diagnostic** lists every SFP module with its sensors (temperature, light received and sent, voltage, current) and raises a finding for a loss of signal, a fault, a hot module or weak light; a module can be accepted as normal. A **Port errors** frame lists the ports with errors or dropped packets, and a rise of the errors between two readings becomes a finding.
- **Services**:
  - a **pencil** (in the full list and in the detail) edits a service: category among the existing ones, description, tags, kind of interface, public on purpose, direct access on purpose, pause;
  - an NPM site without access list shows « ⚠ public? » and is **declared public on purpose** in one click (globe icon) or from its detail;
  - a service can be **hidden from « To watch »**, the tab's dot and the home page until its problem changes, then found again with « Show hidden ».
- **Settings**: the Audit log and the Logs leave the account menu and join Requests in Settings › Application › « Requests and logs », as three sub-tabs; the old links still work.
- **Pages**: DNS, Security, Backups and Services carry badges next to their title as Network does; an empty « To watch » frame is no longer shown; « To deal with now » on the home page folds; a DNS row names the very domain that does not resolve; percentages keep their unit on one line, and each GPU of the Machines table has its load bar.
- **Fixed**: the container no longer fills with zombie `ssh` processes after a day (the server could no longer start a thread); a failed reading pass no longer re-reads every connector every 10 s; Home Assistant's system health (which tests GitHub, against the quota of your public IP) is read hourly; Glances no longer asks a switched-off plugin at every pass; Beszel signs in once per token instead of at every pass.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file. The Port errors frame needs a MynetworK that passes the port counters in `card-devices`; without it, the frame says it is waiting.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.18.3` (amd64 and arm64); `:latest` follows the latest tag, `:main` the latest commit. `tini` is now PID 1.
- **Added**: `GET`/`PUT /api/v1/services/meta` (a service's hand-set entry, the categories, the edit), `PUT /api/v1/services/public`, `GET`/`POST /api/v1/services/watch-hidden` (state `services-watch-hidden.json`, part of the configuration export), `sfp` and `port_errors` in `GET /api/v1/network/diagnostics` (state `port-errors-samples.json`); `services_hidden.py`; front `HeadTags`, `SubTabNav`, `Pct`, `ServiceEdit`, `ActivityHub`, `lib/servicesHidden`.
- **Changed**: `Overlay` has an `actions` slot, `WatchPanel` renders nothing at zero unless `keep`; the Network sub-tabs are `unifi`, `freebox`, `scan`, `list`, `diagnostic` (a remembered « overview » leads to UniFi).
- **Fixed**: readers note the attempt before the reading, `run_isolated` turns a thread that cannot start into a failed reading, `ha_get_system_health` cached one hour, Glances plugin 400/404 remembered one hour, Beszel token kept in memory until its expiry (keyed by URL, account and a digest of the password).
