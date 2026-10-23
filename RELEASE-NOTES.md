# Release notes: MyServices 0.20.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.20.0** (23 October 2026): a new navigation. One menu on the left holds every page and its sub-pages; the Settings page, the tabs inside the pages and the settings windows are gone.

## For everyone

**What's new?**
- **One menu on the left**, in four groups (Overview, Inventory, Protection, Administration):
  - always visible, folded to icons on demand (folded by default under 1280 px), a drawer on a phone;
  - the views of a page are sub-pages listed under its entry, each with its own address (`#network/unifi`, `#dns/servers`), so « back » and links work;
  - folded to icons, the sub-pages open in a small panel, on hover or on a click (Profile → Appearance → Folded menu);
  - « To watch » is the first sub-page of Services, Network, DNS, Backups and Security, and leaves the menu when nothing is to watch;
  - the alert dots stay on the entries, with a count next to Network → Discovery and each Security sub-page.
- **Settings spread over the menu**: each setting now sits under the topic it sets (Machines, Network → Discovery, Backups → Settings, Alerts) or in Administration (Connectors, Accounts and access, Application). Old `#settings/...` links still lead to the right page.
- **Pages instead of windows**: a service, its settings, « Declare a service », adding a machine and linking a found connector all open as pages. The start assistant keeps its windows.
- **No more folded blocks used as pages**: Backups and Network → Discovery settings, Alerts, Home, History, DNS, the devices not followed, the new services, the connectors already read over SSH or by an agent, and the found connectors to link are each a sub-page, shown directly.
- **Figures on top**: Statistics opens on a row of key figures, then the counters of each topic in a grid; Availability and the network scan start with figures too.
- **Full width**: the « Page width » setting is removed; the pages follow the screen. The header keeps the data age, the version and the scan.
- **Fix**: leaving History, Services, Network, Backups or Security by the menu could bring back to the page just left; it no longer does.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file or your settings: only the front end changes. A bookmark to an old address still opens the right page.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.20.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Front only**: no API, configuration or data change. The menu is described in `front/src/lib/tabs.ts` (`NAV`), drawn by `components/Sidebar.tsx`; the address of a sub-page is read by `lib/route.ts` (`usePageView`).
- **Quality**: SonarCloud quality gate passed with no open issue on the pull request.
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
