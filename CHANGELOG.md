# Changelog

All notable changes to MyServices v2 (Docker). One section per published version, newest first. **This file is always written in
English.** For the latest update explained in plain words, see [RELEASE-NOTES.md](RELEASE-NOTES.md).

Versioning: the first pre-releases were called `2.0.0-alpha.N`, `-beta.N` and `-rc.N`. Since the project is still in BETA,
numbering restarts **below 2.0.0** with **0.9.0** (2.0.0 is reserved for a version judged stable). The `:latest` image tag follows the
latest published tag. Images: `ghcr.io/erreur32/myservices` (amd64 and arm64).

## Unreleased (next version, not tagged yet)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Agent install**: a box adds the three exact read-only sudo rules to the Linux command, instead of typing `MSV_SUDO=1` by hand. It is off by default.
- **Agent install over the internet**: both installers refuse plain http beyond the local network or a VPN, as the agent token would travel unencrypted. `MSV_ALLOW_HTTP=1` accepts it on purpose. Agents already installed keep working.
- **Agent on a machine outside your network**: the install frame shows the address field and warns when the machine cannot reach this address, or when its token would cross the internet unencrypted. A VPN address (Tailscale, WireGuard) or https is the way to go.

### Fixed
- **Backups map**: it could stay frozen when a machine both sends and keeps copies. Links inside a row now go under it instead of through the machines.
- **Maps**: a map that failed is tried again at the next pass, even when its data did not change. Until then, the Diagrams page says it is out of date instead of showing it as up to date.
- **UniFi cards**: a card now zooms like a picture when it is resized: ports and access point image follow it and the card always reaches the edges of its frame, while the texts keep their size. Ports are bigger from the start on switches and gateways, and no longer fold onto more lines. The default order is gateways, switches, then access points, with a default size for each kind of device; a card resized by hand keeps its own. A card never goes beyond 700 px high, and the status of an access point is green when it is connected.
- **Copy buttons**: the button of the kernel errors works on a plain http address, and every copy now shows a short confirmation, or says when it failed.
- **Kernel errors**: a CIFS share closing a file left open by an interrupted request (`Close unmatched open`) is no longer a warning; a share that stops answering still is.
- **Open ports**: the domains of a port sit beside the name of its service in aligned columns, and the ports of the machine's own programs are hidden behind a button.
- **Software and services card**: it now takes the top of the second and third columns of the machine page, the open ports moving to the first, with one table of what runs on the machine: a row per software with its type, container, domains, ports and path, sorted by any column and filtered by web servers, containers or no service.
- **Network map**: it could fail when a device left a switch, a link label landing on the title of the next group. These labels repeated what the group already says, so they are gone.
- **Settings > Requests**: the port pulse no longer counts the ports an agent answers for, as they cost no connection.

## v0.33.0 (2026-10-31)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Routers**: four read-only connectors shown with the Internet boxes. None was tried on a real router: the answers come from the documentation or from client libraries, so please tell us how they behave.
  - **OpenWrt**: through ubus, model, firmware, state and address of the Internet connection. A dedicated read-only account is explained in the guide.
  - **MikroTik RouterOS**: through the REST API of RouterOS 7.1 or later, with the Internet side read from the PPPoE or DHCP client. RouterOS 6 has no REST API.
  - **Asus router** (AsusWRT and Merlin): one login at a time, so it reads every 15 minutes by default. Models with a nonce login are not covered.
  - **TP-Link Archer**: only the encrypted LuCI firmwares, from a single source. Each reading closes the owner's open web session, so it reads every 15 minutes by default. Other generations are refused with a message.

## v0.32.1 (2026-10-31)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

- **Security: a crafted answer can no longer hold the server.** A web page could take 5 s of the collection, and a long word in the Docker networks of an agent report several minutes. Both are read in milliseconds now.

## v0.32.0 (2026-10-31)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Availability to the minute**: machines and services keep their outages from the pulses, and the 24 hour view shows 96 quarter-hour cells. A new `avail_runs` table holds them, created by itself.
- **Quick recheck**: a service found bad although its port answers (a 5xx, or no answer on its public site) is tried again about 90 seconds after the watch, one per domain and at most 20 per pass, so the outage is confirmed without waiting for the next collection. Only the appearance of an outage is sped up, and the log says "contrôle rapide".
- **Pulse cost**: Settings › Requests shows what the port pulses cost.
- **Header**: every scheduled task can appear in the header, chosen per browser in Tasks and schedules; the collection and the network search stay on by default.
- **Internet box**: a Liberty gateway connector for Virgin Media Hub 5 and Ziggo SmartWifi, based on the liberty-global-gateway project, whose author tried it on a Ziggo F3896LG only; simulated here.

### Changed

- **Agent first**: a machine with a fresh and complete agent report is no longer read over SSH for its inventory, ports and logins. Ports without a web page are followed from that report.
- **Agents**: when a fresh Linux agent cannot read everything (no sudo for the names behind its ports, Docker unreadable), the Agents and SSH connections pages say what is missing and how to fix it; SSH stays used meanwhile.
- **Header colours**: each task has its own gradient and title colour, made from the theme's tokens, tasks with no percentage get a back-and-forth bar, and a short task stays on show for 4 seconds. The animations are slower. The orb follows the theme in use instead of the system's light or dark setting.
- **Tasks and schedules**: the coming runs in a table sorted by time at the top of the page, a real table with state, schedule, next run and header columns on wide screens, and a task that ends shows at once instead of at the next read. The section "By hand or once" is now "Searches with no schedule" and says there is nothing to do day to day.
- **Analytics connectors**: Rybbit and Umami are read every 15 minutes instead of 5: their counts cover 24 hours and each site is one call.
- **Machines, Services, Connectors**: the search field moves into the title of the frame, centred. Services shows its main filters on the left like Machines. Connectors gets the same frame, 6 cards a line at most, a tighter card body on its own background, and a footer that belongs to its card, with a short link.
- **Services**: the ignored domains leave their frame for a small button in the title line, with the domains beside it and the full panel opening under the button.
- **Cloudflare, Audit log**: the browser keeps the chosen period, and the chosen domain on the Cloudflare pages, like the other pages already do.
- **Frigate**: with an account, the sign-in is kept in memory between readings and camera pictures instead of being done again each time. It stays out of any file, and a changed password is really tried.
- **Machine notices**: each one says since when it lasts, and more of what is behind it: the thresholds, the hottest probe and the load for a hot processor, the free space of a disk, the amounts of memory, the security updates and the packages waiting.
- **Login page**: the button text uses the page font at its proper size.

### Removed

- `legacy/`: the old systemd installation, unused since the Docker version.

### Security

- **Custom icons**: the key is checked where the file path is built.

## v0.31.10 (2026-10-31)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Cloudflare**: a read-only connector and its own page: what to improve and why, domains side by side, and each proxied name checked against NPM, Apache or nginx, in a sortable table. The traffic page reads 24 hours, 7 and 30 days for one domain or all, with the trend against the period before, server errors, the names in error, countries, content types, encryption and browsers.
- **Read now**: a button reads one connector, tests one service or reads the health of one machine, without waiting for its period or a whole pass.

### Changed

- **Agents**: a new agent reports every 5 minutes instead of 15. An agent already installed keeps its rhythm until its install command is run again.
- **Video and cameras**: the overview and the Frigate page are laid out on three columns, the detectors, GPUs and storage as compact cards.
- **Fields**: every field has a background of its own in each theme, and the text typed in it, its example and what the browser fills in stay readable.
- **Connectors**: the connector button of a page opens its connector for editing, or lists the connectors of the page when there are several.
- **Assistant**: reopened once finished, it starts over at the first step and keeps what was validated; unfinished, it stays on the waiting step.
- **Header**: the step of a running collection is shown in full.
- **Agents**: an « Install the agent » link opens the agent's frame of that machine directly.
- **Services**: one service, one place: its sheet now opens inside its card, under the table, and its pencil edits it there. The separate service and edit pages are gone; their old addresses open the card on the right row.
- **Assistant**: the last step is a short message with one main button, « Add a machine », and a link to connect your tools. Adding a machine now offers the agent first.
- **Services**: « Ignored domains » shows its list in the title and always starts folded.
- **Assistant**: « Finish » always ends it and brings the summary into view.
- **Services**: a closed port no longer waits for two collections. A light pulse tries the port of every web service each minute, confirmed twice: the status changes and the alert leaves within 2 to 3 minutes, instead of 20 to 35. Ports without a web page (SSH, mail, SMB, databases), 5xx errors and public sites stay read by the collection. Set or turned off in Tasks and schedules, « Live checks ».
- **Availability**: redesigned, with machines, services, domains, machine, domain and state always in sight, and cells that line up from row to row. It opens on the machines and keeps your filters.
- **Machines**: a visible filter, on by default, hides the machines powered off or no longer followed.
- **Cloudflare**: new pages Security, Server and cache, and DNS; Traffic gains visits, page views, most requested pages, bots and clients, methods. Two more calls per domain each hour.
- **Cloudflare**: small curves in the figure tiles of the overview and of Traffic, read in the same query, with no extra call.
- **Services**: the pencil opens the settings of a service inside its card, without leaving the list, and the row buttons are easier to see.
- **Machines › SSH connections**: a badge tells which machines must keep SSH and why (what the agent does not read, no agent possible on the system, an agent that no longer reports), with counters; the note says how to remove SSH where it is optional.
- **Machine alert limits**: the fields show the values in force, so their arrows no longer start from 0; emptied, a field goes back to the default.

## v0.31.9 (2026-10-31)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Machines**: stop following a machine, or follow it again, right from its line in the list and from its page (admin), with a confirmation in place. The list and the alerts follow at once, and the page of a machine no longer followed says so.

### Changed

- **Services**: one card per service. A container keeps all its ports, addresses and NPM hosts on one card, and a program found on several machines or ports (AnyDesk, Veeam services) is one card that lists them. Interpreters such as `node` or `java` stay one per address, and what Windows itself listens with (`System`, `svchost`) moves to the technical pieces.
- **Services**: the tiles, their curves, the home page and the MCP count one service per machine, whatever its ports, in its worst state. The curves step down once at the update: earlier points counted each port.
- **Tapo**: a device refused by the account is listed all the same, with its model, and a camera without a recorder can show its picture with its camera account, set per camera. The C310 works this way too.
- **Untracked devices**: one list instead of two, each device once with who saw it, filters (To look at, Simple devices, Offline, Hidden), and « Hide » for what you do not want to follow.
- **Connectors**: « Verify HTTPS certificate » starts unchecked on a new connector and only shows for an https address. Connectors already saved keep their setting.
- **My connectors**: every card has the same height, with a dark title and a lighter body. A trouble takes one line at the foot of its card, so a long message no longer stretches its neighbours. The open card says what it means, what still holds and what to check first, with the technical message folded. Its fields sit in a narrower column on the left, and the troubles, what it reads, the help and the buttons on the right.
- **Machines**: the cards fit four per line from 1280 px and five from 1536 px, the name keeps its room and the source badges move to the foot. Clicking a card or its title opens the machine page, and the link at the bottom opens its services, filtered on it.
- **Machines**: the machine page is rebuilt on three columns, always the same subjects at the same place: the state of the machine, what runs on it, access and protection. Two columns on a smaller screen, one on a phone, cards with the same margins and long lists folded at their foot: the page is less than half as tall.
- **Machines**: the « Alerts » and « Type » (VM, host, machine) filters and the « Not followed » switch stay on the search line, the other filters go behind the button, and API, manual SSH and « via a connector » no longer have a filter of their own (the tiles and links that use them keep working).

### Fixed

- **Connectors**: a wrong connector setting (unknown type, no name, missing field) no longer stops the whole collection. That instance is skipped and reported as failed, and the others keep working.
- **Glances**: a plugin that this Glances does not have (no sensors in a container) is no longer called, which ends the HTTP 400 seen in Settings › Requests. The list of plugins is asked once an hour.
- **Machines**: the « Updates » card stays on the machine page when a notice points to it with nothing waiting (automatic updates in error or too old, a snap to update, a service to restart). Those links used to open the page without scrolling or flashing; the automatic updates one now lands on its exact row.

## v0.31.8 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- **Machines**: an open SSH port no longer asks for anything (notice, « SSH access to set up » badge, reminder in the network search): the agent comes first. The texts say « no agent or SSH » when nothing reads a machine. A machine read by its agent gets no warning about a refused key, a wrong port or an unreadable Docker; these checks stay for a machine that depends on SSH.
- **Home**: a health warning names the machine and its exact trouble with its value (« disk / 91 % full »), two causes at most, and its button opens the machine page on the frame that explains it (new address `#machines/<ip>/watch/<notice>`). The button « Machine settings » is now « Settings ».
- **Home**: a service in trouble gives its exact reason and opens the list on its card, with the « To check » frame in view and flashing (new address `#services/all/<key>`). Up to three NPM entries in warning get a line each; more stay grouped.

## v0.31.7 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- **Netatmo through Home Assistant**: the cameras show on the Video page and on Domotique, Netatmo, with their picture, without a Netatmo connector. A camera read by both stays once.
- **Tapo**: a camera filmed by Frigate or Shinobi shows its picture on the Tapo page, matched by address (Frigate and Shinobi cameras now carry the host of their stream, never its account).
- **Video**: the picture is asked by the instance name, which can differ from the name of the app.
- **Tapo**: a device that answers the search but not the reading gives its address and the cause of the failure, and the account is only blamed when the error says so.

### Removed

- **Windows Admin Center connector**: it only gave a list of names, the Windows agent already gives the Hyper-V VMs and the system, and it lived for two versions (0.31.5 and 0.31.6). A leftover in `config.json` is ignored without an error. Windows Admin Center is still recognised in Services, now on port 20443 too.

## v0.31.6 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Windows Admin Center: recent gateways** (login page, port 20443 by default) are now signed in the way their page does it (csrf value, public key from `/api/user/key`, RSA-OAEP SHA-256 packet to `/api/user/login`, session cookies). The Windows sign-in (NTLM) stays for older gateways, and the connector picks by the first answer. Written from the code of a real login page and checked against a simulated gateway, not tried on a real gateway yet.

### Fixed

- **Windows Admin Center**: the access rule said in the guide is the local Users group or WAC Settings, Access (the group named before does not exist).
- **Tapo**: a refused device says why, with a reminder about the camera account, and the address of a device is its IP alone.

## v0.31.5 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Windows Admin Center connector** (read only): the servers, clusters and PCs listed by a WAC gateway (`GET /api/connections`), signed in with a Windows account (NTLMv2, written in the standard library in `connectors/ntlm.py`, checked against Microsoft's MS-NLMP test vectors). A self-signed certificate is accepted by default. Written without a WAC instance at hand: the answer is read leniently, and a gateway set to form sign-in (no Windows sign-in offered) is said in words. To be tried on a real instance.

## v0.31.4 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Domotique**: three sub-pages in the menu, « Overview », « Netatmo » and « Tapo ». The overview shows the house in one look, a folded « To deal with » panel, one card per brand with its main figures, and a table of all devices.
- **Tapo connector** (read only, `tapo` library): plugs with power, today and month energy and a 24 h curve, cameras (online or not), lights, hub sensors, and a table of all devices. It finds the devices on the local network (UDP discovery) and reads them with the Tapo account. Not tested against a real account yet. Rebuild the image to get the library.

### Changed

- **Virtualisation**: the host header shows the brand logo (vCenter, ESXi, Proxmox), and the vCenter / ESXi datastores frame comes first.
- **Icon picker**: the frame no longer scrolls inside, it grows with its content.
- **Windows Admin Center** is recognised by its page title, port or Windows service, with its logo; Tapo uses the TP-Link logo.

- **Machines > Cards**: each card has a foot with a « Details » button that stands out and the health state in words, and its head, foot and edge take the colour of the level (green, orange, red). A card with a warning (the orange or red dot on its icon), or in a critical state, or unreachable, gets a coloured frame too.
- **Netatmo page redone**: the 24 h curves are in view without opening anything (temperature, humidity and CO2 charts side by side, a legend switches a line on or off), room cards with bars for CO2, humidity and battery, roller shutters and outdoor blinds in two panels, a heating scale, and cameras with a picture thumbnail.

### Fixed

- **Machines**: in the « Table » view the cards were shown under the table as well, both views mixed. The cards now only show in the « Cards » view, and as the phone fallback of the table.
- **Machine icon**: the icon picked in a machine's settings is published at once (like the name and tags), so the machine page no longer waits for the next collection to show it.
- **SVG import** (security): the plain DOCTYPE is dropped with a linear search instead of a regex (CodeQL `py/polynomial-redos`).
- **Tapo**: a device the library cannot drive (no handler) no longer breaks the whole reading, and the 18 SonarCloud remarks of the Domotique and Tapo code are fixed.
- **Icon import**: an SVG could not be imported. The page now sends a `.svg` whose file type the browser left empty as an SVG, and the server accepts what editors write: a leading comment, a plain `DOCTYPE`, a metadata block (RDF), `sodipodi:namedview` and more filter elements. Scripts, entities, outside links and a DOCTYPE with an internal subset stay refused.

## v0.31.3 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Security**: findings can be ignored. Each row has a « Stop reporting » button, and each area (sites, ports, SSH, certificates, Fail2ban, access) can be switched off as a whole. Ignored points are listed in a folded « Ignored points » panel with a « Put back » button, and no longer count in the menu dot or the tiles. Stored in `services-meta.json` (`security_ignore`), admin only, audited (`GET/PUT /api/v1/security/ignore`).
- **Backups > By machine**: the « Sets produced » column is now a button (icon, worst state, number of sets) that opens the sets of that machine; the machine name links to its page.

### Fixed

- **Access advice**: a machine listed by a VMware connector (a VM seen by vCenter, for instance a Windows PC) was taken for an ESXi host and told « No agent possible ». ESXi is now recognised from the machine itself only (its SSH reading, icon, scan), not from the connectors that list it.

### Changed

- **Access advice**: an agent is now allowed on a VMware ESXi host, as the last option after the connector and SSH. The page says VMware does not plan for it and it may disappear after a reboot. Closed NAS systems keep their rule.
- **Security > Exposed sites**: new design, one row per site with a progress bar and one badge per check (HTTPS forced, HSTS, Block exploits, Headers, Certificate).
- **Security > Network ports**: a note says the scanner only sees the local network, and a device can be ignored.

## v0.31.2 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- **Menu**: « AI and agents » now sits right after Domotique in the Inventory group.
- **Services**: the « Ignored domains » panel moved to the top of the page, just under the tiles (still folded by default, admin only).

### Fixed

- **Services**: an opened card marked « To check » now says why. The reasons that turn a card to check (no access list, name not resolving outside the LAN, unknown target, not identified...) were only in the tooltip of a small flag, so a card whose only cause was a proxy check opened onto nothing. They are now listed under a « To check » block, with their explanation and the address concerned.

## v0.31.1 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Connector « Internet box (UPnP IGD) »**, read-only, no account: finds a box by SSDP or from its description address, then reads the line, its state, the current and maximum rates, the public address and the uptime. SSDP answers only count from a gateway on the private address that answered, control addresses must stay on the host of the description, and the XML goes through `defusedxml`.
- **Common « box » shape** (`connectors/box_kit.py`) for the Internet box connectors to come: each fills what its protocol gives, a field left empty is not shown.
- `Context.http` can post a raw body (`payload`).
- **Connectors « T-Mobile Home Internet », « Hitron CODA », « Verizon Fios Router » and « Arris SURFboard »**, read-only, written from public client libraries and checked against frozen answers only: none was tried on a real box. T-Mobile reads the model, firmware, 4G/5G signal and uptime (devices and Wi-Fi with an account; Nokia gateways are not handled); Hitron CODA (Rogers, Vidéotron, Cogeco, Eastlink, Cox) reads the firmware, DOCSIS state, public address, uptime, devices and cable signal levels; Verizon Fios reads the public address, uptime and devices of the G3100 and CR1000A, and the devices of the G1100; Arris SURFboard reads the model, firmware, uptime and the cable channels (power, SNR, errors) from the status page, with HNAP login on recent models. A refused login stops at the first call and is not tried again until the settings change. AT&T gateways are not covered: no reliable protocol was found.
- **Connectors « Swisscom Internet-Box », « Compal Connect Box », « Telekom Speedport » and « Technicolor gateway (Homeware) »**, read-only, written from public client libraries and checked against frozen answers only: none was tried on a real box. Internet-Box shares the Livebox protocol; Connect Box (Vodafone Germany, Ziggo, UPC) reads the cable state, rates, public address, devices and temperature; Speedport reads the model, firmware, line rates and Wi-Fi without a password, and the public address and devices with it; Technicolor gateway logs in with SRP-6 and reads the model, firmware, DSL rates, devices and public address. A refused login stops at the first call and is not tried again until the settings change.
- **Connectors « Livebox », « Vodafone Station », « Sagemcom F@st » and « Bbox »**, read-only, written from the public client libraries (aiosysbus, aiovodafone, python-sagemcom-api, bboxpy) and checked against frozen answers only: none of them was tried on a real box. Livebox reads the model, firmware, line type, state, public address and Wi-Fi; Vodafone Station (Technicolor and Sercomm interfaces, not Homeware or Ultra Hub) reads the model, firmware, uptime and devices; Sagemcom F@st (Bell, Proximus, Telia, KPN…) reads the model, firmware and devices; Bbox reads the model, firmware, line type, state, rates, public address, devices and Wi-Fi, with the login the box asks for since firmware 23.7.8. A refused login stops at the first call: none of them tries a wrong password again. Their passwords are kept in the secrets store.
- **Connector « SFR Box »**, read-only, no account: reads the model, firmware, line type (fibre or DSL), its state, the line rates on DSL, the public address, the uptime and the temperature from the box's local API (`/api/1.0`), the calls that answer without a login. The Wi-Fi reading needs a login and carries the Wi-Fi key, so it is never called. Not tested on a real box yet: it is written from the `sfrbox-api` library and checked against frozen answers.
- **Connector « FRITZ!Box »**, read-only, by TR-064 (port 49000, or 49443 with TLS): reads the model, firmware and update available, the line type, its state, the current and maximum rates, the public address, the uptime and the Wi-Fi. It needs a FRITZ!Box user and « Allow access for applications ». The temperature and the number of connected devices are not read. Not tested on a real box yet: it is written from AVM's TR-064 documentation and the `fritzconnection` library, and checked against frozen answers.
- **Menu**: in the Protection group, Security now comes before Backups.
- **The Freebox moves to Network › Internet box.** Its card now carries the common « box » reading, filled from what MynetworK already reads (line type, state, rates, capacity, firmware and update, devices, Wi-Fi, hottest sensor): not a call more to the Freebox. The page shows what only the Freebox tells (fibre light, storage, fans, internal disk, virtual machines) in an « Other readings » section, and keeps the Freebox curves in the figures above. The separate « Freebox » sub-page is gone and `#network/freebox` opens the box page. The public address and the connection uptime are not in MynetworK's summary, so they stay empty.
- `Context.http` can answer a Digest challenge once (`digest=(user, password)`): a second refusal is reported as it is, because an Internet box locks an address that keeps trying a wrong password.
- **Network › Internet box** page, shown when a box connector answers: line, rates with 24 h curves, system; whatever the box does not tell has no line. The public address is shown in clear.

### Changed

- **Warning notes start folded** on every page (one click opens them; a warning that carries an action, like « Turn it on anyway », stays open). The home « To deal with now » frame and the revoked agents also start folded.
- **Machines, card view**: the cards are grouped by hypervisor node (the node first, then its VMs), the others under « Other machines ». Type (VM, host, machine), State and Alerts filters now sit beside the search box.
- **Connector cards**: the header and the footer have their own background, to tell them from the body.
- **Virtualization**: swap, the system disk and I/O wait of a node are gauges, like CPU and memory.
- **Machines › Agents**: a « + Agent » button opens a page that lists the known machines without an agent, those where an agent is the advised way first, with one click to create it.

### Added (settings)

- **Ignored domains** (Services › All services, bottom panel, `public_ignore` in `services-meta.json`): domains or `*.domain` patterns that are never asked « public? ». A host whose every name matches is left out of that check and of the open-site alert; its probes, certificate and DNS checks go on.

### Fixed

- `GET /machines/advice` answered HTTP 500 since 0.29.0 (two modules imported by their old, pre-`msv/` names), which broke the access advice of the setup assistant. A test now fails on any such import.

## v0.31.0 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Home page

- **Your whole fleet in figures**: a more compact panel, up to four columns on a wide screen.

- **New home page**: a sentence tells the state of the network, beside a short live list of the machines (those to watch first, 6 at most). Key figures follow; each one opens its page.
- **To deal with now**: each alert shows a coloured category badge (also on a phone), what to do, and for an administrator a button to the setting that settles it. The badges filter the list.
- **Statistics moved to the home page**: its menu entry is gone, `#stats` opens the home page, which now holds the counters, the date, clock and scheduled tasks card, and a panel listing the linked tools.
- **First visit**: an administrator with one machine or none followed gets a welcome page with the three steps and what MyServices brings.
- **Going further**: formerly « Missing »; notification channels switched off no longer count as set up.
- **Header**: the card shown when hovering the data age no longer has a coloured left edge. This card, also on the home page, now gives the last run of each task beside the next one.

### Agents

- **Windows installer**: it now checks what it downloaded before writing anything. A wrong address answering a web page used to replace a working agent and its config, and the agent then stopped reporting without a line in its log.
- **Agent back from a silence**: its machine's ports and services are read at once instead of waiting for the next scheduled collect.

### Connectors page

- **My connectors**: smaller cards, three to four per row, with plain figures ("48 devices, 41 online") instead of raw counters. A search box and filters (to check, off, category, the first two in colour) sit above them, and a click on a card opens, in one place, what the connector reads, its problems, a link to its page and its settings. Test and Delete moved there too.

### Services page

- **One card per real service**: the collected rows are gathered by application, each site with a domain stays its own service, and connectors with no machine (Netatmo) appear as Cloud services. Two views, by application (six themes plus Others) or by machine, with the existing filters plus "to check", access and Cloud, and a sort by state, name, machine or address.
- A card links to the domain, else to the machine and port, and opens a table of its places (machine, address, domain, access, state). Agents, plumbing and redirects stay folded at the bottom.
- **The unreleased Infra page is gone**: what it showed is now on the connector cards.

### Languages

- **English**: the connector forms (labels, help, the "Need help" guides) and what connectors report (facts, problems, test results) are now translated, about 650 sentences and 100 patterns. A test fails when a new form text or problem has no translation.

### Cameras

- **Cameras page**: filter by place (indoors, outdoors, other) beside the brand or recorder, with a sortable column in the table. The place comes from the connector, else from the camera's name. Each camera shows the logo of its brand or recorder, and the Frigate page its own.

### Smart home

- **New page, Smart home**: the state of the house in a sentence, key figures, what to deal with, every sensor room by room, then the shutters and the cameras.
- **24-hour curves**: a click on a sensor card opens its curves, read on demand from Netatmo or from Home Assistant's history.
- **Through Home Assistant**: without a Netatmo application, the page reads the Netatmo devices Home Assistant already knows. It also adds the other room sensors, shutters and heating of the house, never the applications connected to Home Assistant, and never the same device twice.

### Connectors

- **Netatmo**: new read-only connector for every product of an account (weather stations, Home Coach, thermostats, cameras, detectors, shutters). It keeps the rotating token encrypted and refreshes it under an inter-process lock. Its cameras appear on the Video page, picture only.
- **Tautulli**: the connector always failed with HTTP 400, even with a good API key: it asked for a command that does not exist. It now reads `server_status`.

## v0.30.1 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Network
- **The Freebox machine page has its own « Line » frame** (state, download and upload against the line's capacity with their bars, and the bandwidth history with the period switch) **and a « Fibre (SFP) » frame**: module present, light seen, link, power supply, module model and vendor, light received (read as right, weak, strong…) and sent, with an explanation. The Freebox gives no module temperature.
- **The UniFi view shows the SFP modules of the gear** (the table of the diagnostic: temperature, light received and sent, voltage, current, state).
- **The « Sources » tile of the Network page is gone**: the sources are already the badges of the title.

## v0.30.0 (2026-10-30)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Video and cameras
- **Overview page redone.** Tiles (filming, detecting, events over 24 h with the peak hour, last event, storage), an hourly histogram, detected objects, a per-camera detection table, the latest events and the detectors, each block in a pinned frame.
- **Camera pictures load by themselves** for every signed-in user (no audit line); the live MJPEG stream starts on the play button, lasts 5 minutes, at most 4 at once, and is audited (`/stream/live`).
- **New sub-page Video > Frigate** (shown only when Frigate reports its system stats): detectors, graphics cards, cameras with their processes, storage and temperatures.

### Machines
- **Windows names follow the build number**: Windows 11 (build 22000 and above) is no longer shown as 10, Server editions get their year (2008 to 2025) and the feature version (23H2, 25H2) is kept. The Wazuh connector gives the same name to machines the agent does not read. New icons for Windows 7, 8 and Server 2008, 2012, 2016.
- **A machine always has an icon**: unknown systems get the generic server icon instead of an empty space.
- **Alert thresholds per machine** (disk and memory, warning and critical percentages) in the machine's settings, Options tab. Checked server side (1 to 100, warning below critical).
- **The « Services » button of the open-ports frame is « Web services »** and is greyed out when the machine has none.

### Diagrams
- **Links of the second level are drawn** (each item is chained to the one above it).
- **New diagrams « DNS » and « Who watches what »**; the « Alert chain » diagram is removed.
- **Generation no longer gets stuck**: stale Archify locks are cleared at start, a second generation is refused while one is running (409, the button is disabled).
- **Footer on each diagram**: back to MyServices, the other built diagrams, « Generated with Archify ».
- The Infra and Diagrams pages stay hidden in released builds.

### Pages
- **Same head on the list pages**: icon and title, tags, then the actions at the right (link to the connectors as an icon, the period, then the main button last). The main element sits in a pinned frame on Machines, Virtualization, Agents, SSH connections and Diagrams.
- **The « read only » badge is gone from the page heads**; the tags of the AI page show one name per row plus a « +n » badge so the head stays on one line.
- **Softer state tiles and clearer menu**: the warning yellow of the tiles (figure, bars, dips line) is softer in every theme, and an open menu group gets a vertical bar over the whole block, its active sub-page frame starting right of that line.
- **« Data N min ago » in the header opens the scheduled tasks card** (the one of the Statistics page, with the exact time of the last reading) on hover, or on click (kept open until a click elsewhere or Escape).
- **Dev image: « prod » shows the version really running in prod**, read from the OCI label of the MyServices container the Docker tools see (it said the last changelog version before, wrong between the version commit and the tag). Other images are unchanged.
- **Blue information frames can be hidden** with their cross (kept in the browser) and shown again from Profile or Settings > Appearance. Orange warnings cannot be hidden.

## v0.29.0 (2026-10-28)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Speed
- **The image ships compiled Python (`.pyc`).** `/app` is read-only for the app account, so each task process (collection, watcher, health, which runs once a minute per agent report, backups) used to compile all the sources again at every start. Measured start times (import only): health 182 → 75 ms, collection 228 → 88 ms, watcher 72 → 57 ms, for about 1 MB more in the image. The `.dockerignore` also stops host `__pycache__` folders from entering the image.
- **Hashed front files are cached for a year.** `assets/index-<hash>.js`, `.css`, fonts and images of the compiled front are served with `Cache-Control: public, max-age=31536000, immutable` (a new build has a new name); the page itself, `data.json` and every other file keep `no-cache, must-revalidate`. A file of the data volume is never given the long lifetime.
- **The page's live stream is 99 % lighter on the processor.** While a page is open the server checks the collector's state every second; that check decoded the whole `data.json` (~160 KB) each time just to read its `generated` date (6.1 ms). The file is now decoded again only when the collector has replaced it (0.007 ms). A full check dropped from about 7 ms to 1 ms, and the stream thread from 570 to 220 ms of processor per minute (measured on the dev server with a page open).
- **Tests run in a third of the time** (local run 40 s → 14 s): the test HTTP servers no longer wait half a second to stop. CI: the SonarCloud job caches pip and npm downloads, and the test and release image builds read each other's layer cache.

### Code layout
- **`api.py` (3,300 lines) is split.** `msv/api/common.py` holds the app, its guards (allowed networks, session, CSRF, origin), the stores and the helpers shared by the routes; the 179 routes sit in `msv/api/routes/` (v1, services, machines, access, system, backups, history, accounts, alerts, notifications, page), none above 540 lines. `api.py` only includes them, in the order they were declared. The public API is unchanged (same 177 operations, checked against the previous version).
- **No more import cycles between the modules** (checked on the whole `msv` package, imports inside functions included). The image now starts `python3 -m msv.api.run` (the web server and the background loops start there; `server.py` is only imported, so the old « module started under two names » workaround is gone). The infra map command line is `python3 -m msv.diagram.archify_cli`. The agents' last reports are read by a small standalone module (`msv.machines.agent_reports`) that both the agents and health modules use.

## v0.28.0 (2026-10-28)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Code layout
- **The 66 Python modules of the project root now live in a package, `msv/`**, in nine folders: `core` (config, accounts, tokens, secrets, history, models), `api` (API, server, MCP), `collect` (collection, watcher, health, readers, network), `machines` (agents, machine settings, setup, discovery, matching), `backups`, `alerts` (alerts, notifications, mail), `remote` (SSH to hosts, hypervisors, NPM), `diagram` (Archify maps) and `tools` (account and import command lines). Nothing changes for the user.
- **The image starts `python3 -m msv.api.server`**, and the scheduled tasks (collection, watcher, health, backups) and the infra map run as `python3 -m msv.collect.myservices`, `msv.collect.watcher`, `msv.collect.health`, `msv.backups.backups` and `msv.diagram.archify_map`. The command lines moved the same way: `docker compose exec myservices python3 -m msv.tools.manage users`, `... -m msv.machines.setup --check`, `... -m msv.tools.import_install`.
- **The old installation without Docker is no longer maintained.** `install.sh`, the systemd units, the nginx and Apache snippets and `refresh-api.py` were moved to `legacy/`, as a reference only (see `legacy/README.md`). Use the Docker image.

## v0.27.0 (2026-10-28)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixes
- **Machine page: a machine nothing reads Docker on no longer shows a Docker fault.** "docker unreachable (SSH or docker group)" is kept only when SSH is set up; otherwise the line says "no container" (agent) or "not read (no SSH access)".
- **Discovery reminder "Agent to install" opens the machine**, not an empty page, and says how to get a new command when the token is lost (it is shown only once).
- **The header bell keeps its two kinds of optional suggestions apart**: "apps to link" opens Connectors › Detected, "other discovery suggestions" (devices not followed, backup folders…) opens Discovery, one line each.
- **Add machine: closing the assistant no longer leaves an empty page.** After the add (or a cancel opened from `#settings/machines/new`) you land on the machine list instead of an almost empty settings card at the same address.
- **Dev server (:5180): the agent installer works.** `install.ps1` fetches the agent from `/myservices/agent/…`, which Vite answered with the web page; the dev server now relays `/myservices/` to the container like the other agent routes, and `install.ps1` fetches the agent at the root (`/agent/agent.ps1`) like `install.sh`, so it no longer depends on the old prefix.
- **Add machine: "Often switched off" is no longer ticked for a Windows Server**, whose generated name is `WIN-` + 11 characters (a server must stay on, an outage deserves an alert). The switch now says it plainly: for a PC or laptop often switched off or unplugged, no alert when it does not answer.
- **Add machine: the Windows logo shows as soon as Windows is detected.** The automatic icon of the identity step used to stay empty until the machine was added.
- **A virtual Windows machine is recognised by its agent.** The maker and model the agent reads (QEMU, VMware, Hyper-V, VirtualBox, Xen, Parallels) tick "Virtual machine" by themselves, like `systemd-detect-virt` does over SSH. The switch now says it adds the "VM" tag, and it no longer sits in the add-machine wizard: it stays in the machine's settings. The same goes for "Reachable only through NPM", which nothing detects and which only matters once services fail.
- **Add machine: a Windows PC or server is recognised without a ping.** The WinRM port (5985) is now a Windows hint, and a host name Windows generates itself (`WIN-` + 11 characters, `DESKTOP-…`, `LAPTOP-…`) selects Windows and the agent by default.
- **Add machine: three steps instead of four, and a silent ping is no longer a warning.** What was found and the access (agent, SSH or none) are now one step. A machine that does not answer the ping but shows other signs (open ports, Windows) gets a grey badge and a note explaining that the Windows firewall blocks the ping by default and that the agent, listed first, does not need it; the orange warning is kept for a machine that answers nothing at all.
- **Removing a machine leaves its settings page.** After the trash button and its confirmation, you land back on the machine list instead of staying on the page of a machine that no longer exists.
- **A removed machine disappears from the pages at once.** Removing a machine in Settings left it listed until the next collection pass (up to the collection interval); it is now taken out of the published data right away.
- **Add machine: choosing « Agent » now creates the agent right away.** The last step used to say the command would be given after the add, then showed « Agent: none » and a button to click again; the token and the command now appear at once.
- **Windows agent: the UPnP (2869) and WSD (5357) ports are ignored.** They are held by the Windows kernel (`System`) and the firewall closes them to other machines, so they were always reported as "unreachable" (TimeoutError) in Services.

### Icons
- **Machine list, System column: the right icon for a Freebox and for UniFi gear.** A Freebox "v8" is the Pop, any other Freebox (Delta, v7) gets the Freebox logo, and every UniFi device without a photo (gateways UDM / UCG / USG / UXG, switches USW, UNVR…) gets the UniFi logo; the access points keep their photo. The **System** column of the machine table now shows that photo or logo next to the Freebox and UniFi lines.
- **Import your own icon.** The icon picker of machines and services has a **My icons** section with an **Import an image or an SVG** button (PNG, JPEG, WebP, GIF or SVG, 512 KB at most, 200 icons). Photos and logos are shrunk to 128 px on your side; an SVG is reduced to plain drawing by the server (no script, no outside link) and served in a sandbox, like an avatar. The icons are kept in the state folder, shared by every machine and service, and one can be deleted once nothing uses it. New routes: `GET/POST /api/v1/icons`, `GET/DELETE /api/v1/icons/<key>`.

## v0.26.2 (2026-10-28)

> **Young but working: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Menu
- **Requests**, **Audit log** and **Logs** moved from their own **Activity** item to the **Application** item of Settings (Updates, E-mail, Export and import, Requests, Audit log, Logs, Information). The addresses (`#settings/requests`, `#settings/requests/audit`, `#settings/requests/logs`) do not change. The README and the help text follow.
- The **History** item (Events, Availability) is now part of **Home**, right under the dashboard (Dashboard, Events, Availability, Statistics). The addresses (`#history/events`, `#history/availability`) do not change.

### Development
- The herdr pane « PR et git » finds the pull request of a version by its tagged commit (a title without the version number no longer shows the chain as unfinished), shows the pull request line and always shows the working branch `next`.

## v0.26.1 (2026-10-27)

> **Young but working: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### README
- The README (English and French) now says the project is young but working, marks the connectors proven on a real network (in bold) and says the others were written from the documentation and tried against simulated servers only. The connector table lists the whole family (about 60), and the menu paths are the current ones (Collection › Connectors, Collection › Discovery).

### Tiles read more often
- The tiles whose figure moves are now kept **almost live**, without a call more to the services: the **Internet rate** is kept every minute (it was 2), the **GPU** tiles (load, memory, temperature, power) every time the GpuViewR connector reads again (a point only per new reading, taken from the readers' shared state), and the **DNS answers and latency** every minute (one UDP packet to each server). The rest (health, services, agents, backups, storage, virtualization, engines and models) stays at each collection, every 15 minutes. How often a connector is read is still its own setting (Settings › Connectors, « Read every ... min »): set GpuViewR to 1 minute for a GPU curve that moves.
- Fixed with it: the history store kept points at least 9 minutes apart for every key; the keys read every minute now keep points 55 seconds apart.

### Virtualization
- Six **tiles with a history** above the hosts (period switch 24 h, 3 days, 7 days), for every hypervisor read together: **hosts online** (strip), **machines running** (templates left out), **average processor** and **average memory** of the hosts online, the **fullest storage** (its name below), and **backups up to date** (the vzdump sets followed in Backups, a strip). Under them, one pill per tool (Proxmox, vCenter, ESXi…) with its hosts and machines. Counted on the server like the page (`tile_history.virt_points`, keys `virt.*`, `GET /virtualization/history`). Veeam is not a hypervisor read here, so it is not in this row.

### DNS
- A **real DNS query** (an A record) is sent at each collection to every DNS server of the page and to Cloudflare (1.1.1.1) and Google (8.8.8.8), in parallel, with the latency measured (`dns_probe.py`, `GET /dns/history`). The **DNS servers** tile gets the strip of the answers, and a new **External DNS latency** tile draws one curve per public resolver (legend that hides a curve, the same tile as Download and Upload). A line under the tiles gives the share of answers over the period. The list of public resolvers is fixed for now.

### Services
- Fixed: the history of the tiles was not kept when a service redirect had no final code (`follow.code` empty): the sampling stopped at that error, so no point was stored for the Services, Agents, AI, Virtualization and DNS tiles. Each history is now kept on its own, a failure in one leaves the others alone.
- New **Services health** tile: the share of the services followed that are neither in warning nor down (a percentage on a 0 to 100 scale), with the warnings and the services down written below. Counted on the server with the rule of the page (`services.health`).

### AI and agents
- The overview has **two rows of tiles with a history** and the period switch (24 h, 3 days, 7 days). Row 1, the machine: **GPU load**, **GPU memory** (the orange warning from 90 % stays), **GPU temperature** (the hottest) and **Power** (limit in the sub line). Row 2, the content: **Engines online** (strip), **Models loaded**, **Agents** (platforms connected, strip) and the **memory of the AI machine** (the RAM of the machines that carry a GPU, from the health reads). Only the GPUs of machines that answer are counted.
- Counted on the server like the page (`tile_history.ai_points`, keys `ai.*`, `GET /ai/history`), one point per collection, kept 7 days. Tokens per second are not read by the current connectors, so there is no tile for them.

### Agents
- New **Health** tile and column: a score out of 100 per agent, shown as a bar (green from 80, orange from 50), in three parts: 50 for reports on time, 30 for an up-to-date script, 20 for a recognized machine (no pending host name). 0 before the first report. The tile shows the average with its history (`agents.health`); the pointer on a bar says what is missing.
- The **Running** and **To update** tiles of Settings › Machines › Agents draw their history (a curve and a strip) with the period switch. Counted on the server like the page, one point per collection, kept 7 days (`agents.running`, `agents.late`, `GET /agents/history`, admin).

### Network
- New **Download** and **Upload** tiles: the rate of the Internet link per source, the Freebox (red) and the UniFi gateway (blue), each with its own curve on a shared scale and its own value under the figure. The legend switches a curve off (kept by the browser). On the Freebox sub-page only the Freebox is shown. Nothing is shown for a source that gives no rate (UniFi needs MynetworK 0.11.1+ or a local account for its port table).
- Rates come from what is already read: the Freebox from the connector readers' shared reading (`connectors.json`, MynetworK `freebox.connection`), UniFi from the UniFi cards (WAN port of the gateway, shared 30 s). A new thread `bandwidth` stores one point per source and direction every 2 minutes at most (`bandwidth.py`, `tile_samples` keys `bw.*`, kbit/s and link capacity, 7 days). `GET /network/history` carries them as `bw`.
- Download and Upload curves share one time axis: they start at the same moment (the oldest reading both sources have) and end side by side at the right edge, each carrying its last value on, instead of stopping at its own last reading.
- The orange stretches under the curve of **Devices online** are gone (the total is never reached there, so the whole curve was orange).
- The **Sources** tile is a compact tile with the short names of the sources (MynetworK, UniFi, Freebox), and the tiles go to a second line on a narrow page.

### Services
- The **Warning** tile draws a strip of the services in warning over the period switch. They are counted on the server with the rule of the page (`status()`); the services hidden from « To watch » are counted like the others. `GET /services/history` now also carries `warn` (`tile_samples` key `services.warn`).

### Tiles
- The figure of a tile with a chart keeps a minimum width, so the charts of all the tiles start at the same place even with a one-digit figure.

### Development
- `scripts/dev-status.sh`: a herdr pane « PR et git » (`dev-status.sh open` puts it above « MyServices dev ») showing the release chain of the version as a colour bar, the main branch (lag, CI, Sonar, tag, Docker) and the branches with an open pull request, like the gitstat mod.

### Backups
- The tiles **Up to date** (curve), **Late** and **Missing or failing** (strips) of the Backups page keep their history over the period switch (24 h, 72 h, 7 days). New `GET /backups/history?hours=24|72|168`. The sets are counted like the page (not archived; late = `warn`; missing or failing = `crit` or `down`) after each collection (`tile_samples` table, 7 days kept).

## v0.26.0 (2026-10-27)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Page heads
- One head for the list pages (Machines, Services, Network, DNS, Backups, Security, AI and agents, Video and cameras): the title with its icon, the tags and, at the far right on the same line, the actions of the page (history period, link to the connectors, buttons with the main one last). The line wraps by itself on a narrow screen.
- Machines: **Re-detect** and **Add a machine** move from the search bar up to the head. Services: **+ Service** is now a main button. Backups: new **Add backups** button for admins. Network: new **Connectors** link for admins.

### Machines
- The figure tiles of the Machines page now draw their history over a period chosen once for the whole row (24 h, 72 h or 7 days, kept by the browser): a strip of states for **Reachable** and **Unreachable** (one column per slot, orange or red where a machine did not answer) and a stepped curve for **Health**, with the change over the period under the figure and the reading at the pointer on hover. A click on a tile filters the list under it (a second click clears it).
- New `GET /machines/history?hours=24|72|168`: the readings behind those tiles, `[time, value, total]` each. Reachability comes from the availability history; the health count is kept from now on (`tile_samples` table, 7 days), so the Health curve builds up after the update.
- **Processor and Memory** tiles: the average of the machines that report it, the most loaded one under the figure, a 0 to 100 % curve over the chosen period. A click lists the machines over 80 % (new **Load** filter). `GET /machines/history` now also carries `cpu` and `mem` (one point per 10 minutes, the average and the number of machines). The machines' readings (`metric_samples`) are kept 7 days instead of 24 h; the machine page still draws the last 24 h.
- The icon and settings header cells of the machines table had no bottom border or background, which cut the line under the header; they now use the same header cell as the other columns.

### Services, Network and Security
- **Services**: the **Online** tile draws a curve and the **Down** tile a strip, over the same period switch. New `GET /services/history?hours=24|72|168`, read from the availability history (nothing new is stored).
- **Network**: **Equipment online** (strip), **Clients** and **Devices online** (curves) keep their history, over the same period switch. New `GET /network/history?hours=24|72|168`. The figures are taken from `data.json` after each collection with the same merge by MAC as the page (`tile_samples` table, one point per 9 minutes at most, 7 days kept).
- **Security**: the **Fail2ban, 24 h** tile and the two ban tiles of the Fail2ban page draw the bans per hour and per day that the LogviewR connector already gives (no new storage).
- Tiles with a chart keep 24 px between the figure and the chart and a wider minimum size, so a chart never overflows its tile; the Machines tiles go to a second line on a narrow page.

### Menu
- New **Collection** group between Protection and Administration: **Connectors**, **Discovery** and **Tasks and schedules** are now entries of their own instead of sitting under Administration, which keeps the settings and information of the app (Notifications, Accounts and access, Application, Activity). Addresses do not change.
- Clicking the name of a menu category now opens its main page and unfolds it, where it used to unfold only. The chevron still folds and unfolds without changing page, and the dot still opens the page on its alerts.

### Backups
- A copy that does not run every day (a weekly rsync to a NAS, say) can now say so: **Rhythm** (days between two runs) in the form of a copy, `every_days` in `backups-meta.json`, also settable through `PATCH /backups/settings/{set_id}/locations/{index}`. Between two runs such a copy is no longer reported as late on the source; it is judged on the newest archive old enough for its next run to have passed. Default is 1 (daily), nothing changes for existing sets.
- Machines tab: the disk usage and free space figures are right-aligned, so they line up from one disk to the next.

## v0.25.0 (2026-10-26)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **MCP, reading a server without its pages**: a new read tool `get_backups` gives the Backups page as data (each set with its level, why it is not « ok », and every place with its age; problems first, `problems_only`, `query`). `status` now says the running version, the server time and the state of every task (enabled, next run, last result). `get_health` carries SMART per disk and its source, Docker (containers stopped on purpose, issues), temperature and pending updates, with the source each reading came from, and takes a `query`. `list_services` shows the Docker state of the container behind a service and whether it is stopped on purpose, and filters on one `status`. `list_machines` carries the machine's « containers stopped on purpose » and takes a `query`.
- **MCP, `machines_config` action `patch`** (route `PATCH /machines/settings/{ip}`): change some fields of a declared machine and keep the others. `save` takes the whole record, so a script that only meant to set one option had to send the name, the role and the SSH access again. A field set to null is removed.
- **MCP, `settings_config` action `task_run`**: run a task now (backups, health…) through the route of the Tasks page, instead of waiting for its schedule.
- **Processor temperature: a threshold per machine, and an alert only once the machine stays hot.** The fixed 85 °C made a Proxmox host or a gaming PC blink between « OK » and « à surveiller » at every peak. Each machine may now set its own warning threshold (machine card › Options › « Seuil de température », field `temp_warn_c` of `machines_config`, critical 10 °C higher), and a machine is only flagged when it has been above it for more than ten minutes (`hot_since` is kept between two health passes): a compilation, a game loading or a backup no longer raise an alert. The reading carries its level and thresholds (`temp.level`, `warn_c`, `crit_c`, `hot_s`), the pages follow them.

### Changed
- **Container states between two Docker inventories**: the inventory of a machine (containers, ports, labels) is read every two hours, so a container stopped, started or left « Created » after that showed its old state on the Services and Machines pages for up to two hours. The `docker ps -a` the health check already runs at every pass (over SSH, or sent by the Linux agent every minute) now refreshes the state of each cached container, without a new inventory; a container that appeared or disappeared makes the machine's inventory read again at the next collection. A service whose container no longer publishes a port (stopped, « Created ») keeps its last known identification, as before, but now with the container's current state instead of the remembered one. The inventory cache file is written in one go (temporary file, then renamed).
- **Filled buttons on Dracula and Ayu Mirage** (« + Machine », the current step of the assistant, the filter counter, the home page's red action): they took the link colour, a light cyan on these two themes, unreadable under white text. They now take an accent colour of their own (`--accent`: deep purple on Dracula, deep blue on Ayu Mirage), and the link colour on the other themes as before.
- **Application icon**: the browser tab's icon (favicon) now follows the logo chosen in Profile › Appearance, and the grid without background is the default and first in the choice (a saved choice is kept).

### Fixed
- **A process bound to a bridge or container address was probed and shown down**: the listening ports read over SSH or sent by the agent (`ss -tlnp`) only kept « loopback or not », so an Apache listening on `172.30.0.3:8443` (behind Anubis, in a Docker network) was probed through the machine's IP, refused, and shown as a failure. The listen address is now kept with each port, and a port bound to an address the collector cannot reach (not every-interface, not the machine's IP, not loopback) is marked internal, like the Apache `Listen` lines already were: the process is up (seen listening), no probe, the card says on which address it listens.
- **Menu dots: the click now shows what the dot's tooltip lists**: the Machines dot filtered the page on the « Alertes » facet (the whole « À surveiller » column: services down, updates, SMART, flagged devices…) while its tooltip counted the health alerts, so « 2 machines » in the tooltip became 6 in the list; the Services dot filtered on « en alerte », which also kept services that are OK with a remark, all unfolded. The Machines dot now filters on the Santé facet (à surveiller, critique, injoignable), like the « Voir la santé » lines of the home page, and « en alerte » on the Services page now means down or with a warning and not hidden from the alerts, the OK services with a remark staying under « À vérifier » (`DOT_FILTER`, one table for every dot).
- **Connectors in trouble had no menu dot**: their alerts belong to the Settings tab, which no menu entry carries, so they only showed on the home page. The dot is now on the entry the alert names: « Connecteurs » for a connector that fails, « Machines » for a Docker that cannot be read; its click opens that entry.
- **SMART « in fault » on a disk nobody could read**: when a machine's SMART was taken from Beszel (the agent has no `sudo` rule for `smartctl`), a disk Beszel could not query (state `UNKNOWN`, temperature and hours at 0) was shown as « SMART: /dev/nvme0n1 in fault » by the pages, while the health check counted it as fine. Such a disk is now left out, and the pages report a disk only when it is really `failed`, like the health check.

## v0.24.2 (2026-10-26)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **A service whose container is stopped on purpose is grey, not red**: the Services page, the watcher alerts, the MCP and the machine counts now follow the rule the health reading already used (`docker_state.py`): a container that never started, one stopped cleanly (exit 0, 143 or 137) or one listed in the machine's « Containers stopped on purpose » no longer turns its service to « down ». The row reads « stopped on purpose », is not probed, is not a point to fix and sends no alert; it returns to normal by itself when the container runs again, and a crash (exit 1, not listed) is still red. The « stop following » button stays for services that are not in Docker.

## v0.24.1 (2026-10-26)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Containers stopped on purpose** (machine › Options › « Containers stopped on purpose », `stopped_ok` in `services-meta.json`, also set by the MCP `machines_config` save): a container stopped by hand or by a script with an exit code other than 0, 137 or 143 (an app that exits with 1 when it receives the stop signal, for example) counted as a Docker failure and turned the machine to « warn ». The names listed for a machine are now filed with the intended stops, without a warning. A container restarting in a loop is still reported. Applies to Linux machines read over SSH or by an agent.

## v0.24.0 (2026-10-26)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **MCP, `settings_config`** (admin, off until switched on in Settings › API and MCP): the general settings from an AI assistant, through the routes of the Settings pages: e-mail sending (read, set, send a test), the schedule of each task, the pulse and the fast connectors, the automatic check for updates, and the alerts (channels with a test message, rules, presets). Left out on purpose: the configuration export and import, the container log, the app's SSH key, accounts and tokens. The test e-mail goes to the account that created the token (a token has no address of its own). The `*_config` tools no longer return the 200 KB changelog that the update route carries.

### Changed
- **Kernel errors**: the notice a Linux machine logs when it mounts a Samba share that does not give inode numbers (`CIFS: VFS: Autodisabling the use of server inode numbers…`) is no longer counted as a kernel error, so a machine that mounts such a share no longer flips between « ok » and « warn ». The MCP `get_health` shows the journal lines behind a kernel warn (`kernel_errors`).

## v0.23.0 (2026-10-26)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **MCP, `machines_config`** (admin, off until switched on in Settings › API and MCP, like the other `*_config` tools): list the declared machines, add or change one (SSH access, role), remove it, check it (SSH, Docker, AdGuard, health), re-read a single machine, and set the automatic network search. It runs the routes of the Settings pages, so the checks and the audit log (`mcp:<token name>`) are the same.

### Changed
- **MCP, why a machine is not « ok »**: `get_health` lists the controls in warn or crit of each machine (`checks`), `list_machines` names the services in trouble of each one (`problems`) and says its containers are the running ones, and `status` also lists the health connectors (Beszel), whose state was read by the health task and then dropped, so a Beszel that stopped answering showed nowhere. The health file (`stats.json`) keeps them in `connectors`.
- Machines › SSH connections: the agent of a machine that reports is a link to its page; the machine page shows which services are down in a tooltip.
- Access advice: VMware ESXi and closed NAS systems (Synology, QNAP, WD My Cloud, TrueNAS, Unraid) are read by their connector or over SSH, never by an agent. The machine page › Access › Agent now says « No agent possible on this machine » and why (box, ESXi, Home Assistant OS, closed NAS) instead of offering an install, unless an agent already exists.

## v0.22.1 (2026-10-24)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed
- **Release build**: a test of the 24 h curves (`test_metrics`) depended on the day it ran and failed from 24 October 2026 on, which stopped the 0.22.0 image from being built; it now fixes its clock. No change to the app itself: 0.22.1 is 0.22.0 with its image.

## v0.22.0 (2026-10-24)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **AI and agents, a new menu entry** (Inventory group, shown as soon as Services finds an AI service or an AI connector is set): what the AI services hold, without a probe or a form of its own (their state is the one of Services, every card leads to the service's page). Four sub-pages: **Overview** (engines, models, agents, GPU memory, what to watch, one card per service; a service no connector reads is drawn dotted, with « Add a connector » opening the right connector already filled with its address), **Models** (every model of every engine in one sortable table: size, quantization, family, parameters, context, loaded or on disk, GPU memory; plus what GpuViewR sees running on a GPU without a connector), **Agents and MCP** (Hermes and the state of each platform, the MCP servers, and « who talks to whom »: Open WebUI's model and tool servers read in its settings, an agent's model matched by name on an engine, marked « deduced »), **GPU** (each GPU with memory, compute, temperature, power, fan, driver and what takes it).
- **Video and cameras, a new menu entry** (Inventory group, after AI and agents; shown as soon as Services finds a service of the new **Stream** category or a video connector is set): what the camera recorders, stream relays and live broadcasts hold, their state being the one of Services. Four sub-pages: **Overview** (cameras filming, recording, events of the last 24 h by label, the fullest recordings storage, what to watch, one card per tool), **Cameras** (every camera of every recorder, as tiles or a sortable table, silent ones first, with the relays carrying a stream of the same name; an admin can ask for **the picture of the moment** with its play button (nothing from a camera loads by itself), read on demand, never kept and written to the audit log), **Streams** (what go2rtc and MediaMTX relay, codec, readers, and Owncast on or off air), **Recordings** (space used per recorder and events per camera). What to watch: a silent camera, recordings storage at 90 % or more, a detector slower than 100 ms per frame, a relayed stream whose source is gone. Only the last 24 hours are read: no fill rate or « full in X days » yet.
- **Four video connectors**: **Shinobi** (each camera, its mode and state; read-only API key and group key), **go2rtc** (streams, codec, readers; no key by default), **MediaMTX** (paths ready or not, readers; its API must be on) and **Owncast** (on air, viewers; public route). **Frigate** now also gives each camera's detection and recording settings and its events, the labels seen and the recordings storage. **Frigate also takes an optional account** for its signed-in port 8971 (Frigate 0.14+; a « viewer » account is enough): it signs in, keeps the session token in memory only and signs in again when it expires; without an account, port 5000 works as before. The address of a camera or of a stream's source is never kept, only its name. New known apps in the **Stream** category: Shinobi, go2rtc, MediaMTX, Owncast, ZoneMinder, motionEye, Agent DVR, Viseron, Kerberos.io, Scrypted, Restreamer; **Frigate moves from Home automation to Stream** (add the « Stream » rule of `services-meta.example.json` to your own `services-meta.json` for the category to apply; the page also recognises these apps without it).
- **Two AI connectors**: **Open WebUI** (version without a key; with an API key the models it offers; with an admin's key the Ollama, OpenAI and tool servers it is linked to, of which only the addresses are kept, never the keys) and **OpenAI-compatible API** for vLLM, LM Studio, LocalAI, KoboldCpp and LiteLLM (models served, loaded or not when the server says it, version when there is one). vLLM, LM Studio, LocalAI, KoboldCpp, LiteLLM and Open WebUI now propose their connector when found; LiteLLM is recognised by its page and image.
- **Ollama, llama.cpp, Hermes: more read**: Ollama gives each model's size, quantization, family, parameters and context, and tells the « cloud » ones (run on ollama.com); llama.cpp its model's size, parameters and quantization (`/v1/models`); Hermes, at the dashboard address, each platform and the model in use (`/api/model/info`, public).
- **GpuViewR, more per GPU**: index, driver, fan, power cap, throttle temperature, shared memory of an APU, and the processes on the GPUs of each machine online (`/api/v1/processes`).

### Changed
- **The service page, read and edited in place**: « Edit » no longer opens a separate form; the same three blocks turn each value that can be set into its field, and say where each value comes from (detected, automatic, set by hand) with « Reset ». New settings: a **display name**, an **icon** (the machines' picker), the **app** (to fix a wrongly recognised one or name an unknown one: it changes the logo and the connector offered), the **address to open** (the « Open » button, new on the page, and the name in the list lead there) and an **alerts level** kept on the server (all, outage only, none) that the notifications follow. A line counts the unsaved changes.
- **Health alerts, short labels**: « Health good », « Health to watch », « Health critical », « Machine unreachable », in the notifications, the audit log and the history, translated in both languages (older events too); the « Health » tile of Machines and Statistics explains on hover what it counts.
- **Assistant › Tools**: the « Scheduled tasks » block is gone; they stay in Application › Tasks and schedules.

### Fixed
- **Backups, a connector switched off on purpose no longer raises an alert**: a machine read by a connector switched off in Settings (to spare its API) was « unreachable » in To deal with now. Its sets and the machine now say « connector off », with no alert and no « no copy elsewhere » check until it is on again; a connector really missing from config.json still says so.

## v0.21.0 (2026-10-24)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **MCP, configure the app from an AI assistant**: four new tools at the admin level (an MCP token made with the password and an expiry), off until switched on in Settings › API and MCP. `connectors_config` lists, tests without saving, saves (tested first: collection off if the test fails), switches and deletes connectors; `backups_config` covers every backup setting (folders by SSH, Veeam, remote, Synology, PBS, agents, vzdump, Home Assistant, copies, thresholds, unfollow); `agents_config` lists, creates (install command shown once), updates and revokes agents; `validate_config` tests every saved connector and says what fails. Each tool's « help » action gives every action with its parameters as a JSON schema. They run the same routes as the Settings page: same checks, same audit log (as « mcp:<token> »), same reread. Showing a saved secret, installing npm-api.sh on a machine, accounts, tokens and the configuration import stay out of reach.
- **REST API, admin tokens reach backups and agents**: the `backups/…` and `agents` routes are now open to admin API tokens, like connectors and machines already were.
- **Connectors › Found, to link, sortable table**: every column sorts (service, machine, state, activation), by machine at first.
- **Three more dark themes**: GitHub Dark, Night Owl and Ayu Mirage in Settings › Appearance, beside Dark and Light. The header's theme button now switches between light and the last dark theme picked.
- **Backups › Sets, grouped by machine**: the sets sit under one header row per machine (its icon, name, number of sets and worst state) on a dark background, set apart by a thicker line; « By machine » turns it off (remembered). The machine column, kept when not grouped and on « To watch », shows the machine's icon.
- **Backups › a set's page, every setting**: besides name, folder, schedule, age and copies, a set's page now edits its retention, its note and how copies are compared (newest archive or each one); the source of a folder set and each of its copies open a form with the machine (moving the source moves the set), the folder, the archive names read, the depth, how they get there and « encrypted ». Places read from a source (vzdump, Veeam, PBS, Synology, Home Assistant) stay as their source gives them.
- **Side menu, the alerts in the dot's tooltip**: hovering the dot of an entry lists the alerts behind it (as the home page words them, up to 8, then « and N more »), instead of only « to watch ».
- **Services › All services, stop following a known alert**: a service down (even on purpose), in warning or with a point to check gets the same button as on « To watch » (admin only, also on the phone cards): it hides it from « To watch », the tab's dot and the home page until its problem changes; once hidden, the button shows it back. On any other row (online, stopped on purpose) the same button stops following the service for good, until shown back. A hidden service is no longer counted as down or to fix: tiles of the Services page, counts of a machine group, NPM and Services groups of the home and Statistics pages, the « services online » key figure; its state is greyed on the row.
- **Backups › Sets, a search**: a search field (set, machine, folder, schedule, place of a copy) and a machine filter in chips, above the three chips (in use, flagged, archived), whose counts follow it. On Backups › By machine, the « Sets produced » badge of a machine opens the sets filtered on that machine.

### Changed
- **Side menu, tidied up**: the first group is « At a glance » and the home page's sub-page « Dashboard », so « Overview » is Security's page alone. Requests, audit log and logs leave Application for their own « Activity » entry. Backups' four settings pages sit flat, like everywhere else. « App SSH key » joins Machines › SSH connections: the key is a band on top of the page (shown, copied, the steps to authorise it unfolding), the machines refusing it are listed above, and a « Key » column tells which key each machine signs in with; #settings/ssh redirects there. Alerts leave Protection for Administration, named « Notifications ». Automatic discovery is now at #settings/discovery and Security's Overview at #security/overview; the old addresses redirect.
- **Updates, a notice in the header**: « Check now » shows its result in the middle of the header, with an animated orb (a new version, or up to date), and the new version's pill shows at once. A release found by the automatic check is announced once, then its pill stays. The header now gets the last check even with the automatic check off. In Settings › Updates, the automatic check and a new « Notices in the header » switch (this browser) sit in the Updates frame. The orb in the middle no longer makes the header taller.
- **Logs, the app's SSH key**: at startup the logs give its fingerprint only; the public key and the command to authorize it are in Machines › SSH connections (the README says so instead of pointing to the logs).
- **Logs, how many lines**: 200, 500, 1,000, 5,000 or all (remembered by the browser); the app now keeps the last 10,000 lines instead of 3,000.
- **Settings › Export and import**: its cards open by default.
- **Logs, a map not regenerated**: the line now gives Archify's error and its error diagnostics, instead of the cut tail of its JSON (« r successfully »).
- **Activity**: « Requests » opens the requests again, not the last part seen (the audit log).
- **Machines, the Apache chip**: a site hidden in Services no longer turns it red.
- **Discovery, each part with its subject**: the Discovery group leaves the Network menu. The machines found by the network search sit on top of Machines › Devices not followed (with what the tools see below); the apps recognised (to activate, stopped, forgotten) are all in Connectors › Found, to link, which already had them with the activation form, « Forget » and « Recall »; the mode, what to do, the other suggestions and the forgotten ones form Application › Automatic discovery (with its count of things to do). The old #settings/network/<part> addresses lead to the new pages, and the texts that named « Settings → Discovery » name the new places.
- **Security, « To watch » becomes « Overview »**: the findings of every Security page in one table, always in the menu (even with nothing to report) and opened by default and by the menu's dot. No other page has a « To watch » page any more.
- **Services and Network, no « To watch » page in the menu any more**: the menu's dot opens Services › All services and Network › Devices and equipment on a new « Alerts » chip. Services: down, warning or a point to check, hidden ones left out; the « public site on purpose » button is now on the rows, and the wording speaks of the alerts. Network: gear offline or with an update, weak Wi-Fi; on « Alerts » every section is open, and a failing source or what the Internet access reports sits in a frame above the list. The old /watch addresses open the same filtered views.
- **Backups and DNS, no « To watch » page in the menu any more**: the alerts are a filter of the pages. The menu's dot (and the home page lines) open Backups › Sets on the new « Alerts » chip (the sets not ok, archived ones left out; it replaces « Flagged ») and DNS › Details on « Alerts » (only the tables an alert points to, and the server and sync cards when the alert is there; « All » shows everything again). The old #backups/watch and #dns/watch addresses still open these filtered views. Opened bare, Backups shows By machine and DNS its servers.
- **Backups › Settings › To link, local backup folders**: the Folder column gets a set width instead of all the room left; the sets that cover a folder take it, one badge each.

## v0.20.2 (2026-10-23)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **History › Events, the figures of the period**: a row of figures on top that follows the chosen period (and the search and chips, as the chart): events and their average per day, outages (services and machines), serious ones, returns to normal, and the most affected machine.
- **Wazuh on the Statistics page**: a Wazuh group (active and disconnected agents, serious alerts over 24 hours and critical vulnerabilities with the indexer, agents never connected without it), shown only when a Wazuh connector is set and answers; its title opens Security › Wazuh. In the side menu, Security › Wazuh gets the number of disconnected agents and serious alert rules of the last 24 hours (vulnerabilities are left out of it).
- **Security › Wazuh**: a page of its own in the side menu when a Wazuh connector is set: figures (active agents, alerts and serious alerts over 24 hours, critical vulnerabilities, average compliance), a chart of the alerts per hour with their serious part, the serious rules, and one row per machine (agent state, compliance as a bar, vulnerabilities as a bar split by severity, the worst CVE unfolded), worst first, each linked to its machine page. The connector now also returns the agents summary and the alerts per hour.
- **Wazuh on the page of each machine**: a Wazuh card for a machine that has a Wazuh agent (matched by the agent's IP, or by its name when that IP is no known machine's, as an agent in a container giving its inner IP): the agent's state, the configuration score of each SCA policy, the hardware, number of packages and listening ports seen by Wazuh (read for active agents, kept an hour), and, with the indexer set, the vulnerabilities by severity with the worst CVE and their package (kept half an hour). The Wazuh card adds the number of critical vulnerabilities. Nothing new to set up for the score and the inventory (same read-only API user).
- **Wazuh: the security alerts of the last 24 hours** (optional): with the address of the Wazuh indexer (`https://<IP>:9200`) and a read-only user of it (role `readall`), the Wazuh card adds the number of alerts over 24 hours and of serious ones (level 13 and more: level 12 holds routine rules such as a system user logging in), and names the serious rules. Only counts are read. Without the indexer, the card stays as before (agents only); an indexer that does not answer is said on the card, the agents stay read.
- **The last 24 hours of each machine, as small curves**: after each health reading, MyServices keeps the processor, memory, fullest disk and temperature of each machine for 24 hours (one point every 4 minutes at most, in the SQLite base; route `GET /api/v1/machines/{ip}/metrics`). The figures of the machine page draw them under their value, in the colour of their state (lowest and highest on hover); while the history is younger than 24 hours the curve starts at its first point, and the page reads the points again every 4 minutes. A machine with an agent gets a point every 4 minutes, even when its health is read over SSH first (the SSH reading stays the health; the agent's report only feeds the curves); one read over SSH only gets one at each health pass.
- **When the machine was last read**: the Health tile of the machine page gives the time of the last reading of this machine (each machine of `health/stats.json` now carries its own `read_at`; a pass for one machine leaves the others with theirs).
- **A Temperature tile** among the figures of the machine page (orange from 85 °C, red from 95 °C, as the health check).

### Changed
- **Machines page, a head as the other pages**: the title with its counts (machines, read over SSH, with an agent) and a row of figures (reachable, health OK, to watch, unreachable, off) above the list.
- **Machines page, one frame less**: the search and filters above the Machines table lose their own frame; the table keeps its.
- **The agent first**: the health of a Linux machine with a fresh agent report is read from its agent (every minute, no SSH connection opened); SSH takes over when the agent goes silent and keeps what only it reads. An order set by hand for a machine still wins. The first-steps assistant now advises the agent for a Linux machine (SSH as the alternative; a machine already read over SSH is not flagged), with a « Which one to choose? » box, the same in Settings › Machines; README (EN and FR) aligned, and its outdated « no Linux agent yet » line fixed.
- **One settings icon**: « Set › » links (SSH connections, Backups, other schedules) are the sliders icon of the Machines table, the name in its tooltip; the backup set's « Set this set » uses it too. SSH pages get a round back button, the machine's icon and name as title, a « Machine page » button and « Done ».
- **SSH or agent, said per machine** (Machines › SSH connections): the page says that the agent takes the same health readings every minute without an SSH key, and that SSH is kept for what the agent does not read (backups, Proxmox or ESXi, NPM, AdGuard). An Agent column tells, per machine: « Install the agent », « SSH optional: the agent is enough » with « Turn SSH off », or what SSH is still useful for (`GET /api/v1/machines/settings` gives `ssh_uses`).
- **Access set in place**: on Machines › Agents, each row carries the agent's buttons (automatic update, update now, new token, revoke), as in GpuViewR, and a new command shows under its row; on Machines › SSH connections, « Set » opens the SSH access of that machine alone on its page (the other machines are not listed meanwhile), and « + SSH connection » picks a followed machine without one and sets it on the same page. The old address of an agent's page opens the list with its row lit.
- **Sources at the head of the machine page, without colour**: SSH, agent and connectors are told apart by their logo instead of a green badge each; a source that does not answer keeps a small ⚠ or ✕. The Sources column of the Machines table is unchanged.
- **One list of open ports on the machine page**: the Open ports card now merges the MyServices scan, the MynetworK scan and the ports Wazuh sees listening, with the program behind each port (Wazuh), who saw it (on hover) and « machine only » for a port listening on 127.0.0.1 alone. The open ports line of the Card and the ports of the Wazuh card are gone (they repeated it).
- **Uptime, clearer**: durations keep their two largest units (« 12 d 4 h », « 4 h 20 min », « 12 min ») instead of « 0 h » under an hour, everywhere they are shown; the Uptime tile of the machine page (« Up for » renamed « Uptime ») also gives the start date.
- **Availability on the machine page back to its former height**: day cells as tall as before, with the « 30 days ago / today » line under them.
- **The page of a machine, reworked**: a row of figures on top (health, processor, memory, fullest disk, uptime, and availability over 30 days with a cell per day), the « To watch » strip open (it can be reduced), then a wall of cards in two columns with no empty space: Updates first (left out when nothing is pending), Health (only its checks: logs, services, clock, sessions, Fail2ban), Card (identity and network), System (system, kernel, hardware, and the measures: processor, memory, disks, temperature, probes), Access, Software and services, Backups, Shares, Open ports, Virtual machines. Each card has a dark title strip; sources are a short grey line instead of badges; long values (keys, paths, MAC, backup names) wrap instead of being cut; temperature probes have short names (full name on hover); big logs and Fail2ban jails are compact tables.
- **Side menu, one category open at a time**: opening a page folds every other category, only the one holding the page stays open; a category opened by hand closes the others.
- **Backups, simpler**: « All sets » and Settings → « Followed sets » were the same list twice; there is now one « Sets » view (chips: in use, flagged, archived) where « Set » opens the page of one set (name, what is followed, expected schedule, maximum age with the advised rhythm, copy off the machine, copies elsewhere, archive, remove). The « Archived sets » page and the « ⋯ » menu of the rows are gone. « By machine » comes first and shows its copies as chips and its sets as a count; the local backup folders and the cron lines no set claims move to a new Settings page, « To link », no longer folded.

### Fixed
- **New services: what a connector already reads is no longer proposed**: Services › New services listed the ports of a tool set as a connector (Wazuh's 55000, 1514, 1515 and its indexer's 9200). A service at a connector's address, or a container of one of its type's images on that machine, is now left out.
- **Wazuh connector, clearer errors on a wrong address**: the address of the dashboard (the one a reverse proxy publishes) gave a bare « HTTP 404 », an `http://` address a « Remote end closed connection »; both now say that the API answers on port 55000, over https (`https://<IP>:55000`).
- **Fail2ban « sudo rule missing » when Fail2ban was only stopped**: when `fail2ban-client` fails, the check now asks sudo whether the rule exists (`sudo -n -l`, nothing run); with the rule in place the page says « does not answer (service stopped?) ».
- **« Invalid Date » on the page of a machine** (« On the network since… »): some MynetworK versions send an empty object instead of the first and last seen dates; the connector now keeps a date only when it is one, and the page hides a date it cannot read.

## v0.20.1 (2026-10-23)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Machines → Agents lists every agent**, not only the revoked ones: figures on top (active, silent, pending, to update), a table (machine, type, state, version, last report), one button to update the late agents, the revoked ones below. « Set » opens the agent's own settings page (`#settings/machines/agents/<ip>`) with its gestures: automatic or immediate update, new token, revocation, host name to confirm.
- **The page of a machine is split in two**: `#machines/<ip>` shows what MyServices knows of it (state, health, software, backups, availability, ports, guests) with a « Settings › » button; `#machines/<ip>/settings` holds its settings alone (identity, options, access), with a way back. Old `#machines/<ip>/access` links open the settings on the Access tab.
- **Machines → SSH connections**, a new sub-page: every machine read over SSH with the account and address it uses (`account@address:port`) and whether its last read went through, was refused or has not happened yet, the ones turned off by hand. « Set » opens the SSH settings of that machine alone, on a page of its own (`#settings/machines/ssh/<ip>`), without the other tabs of the machine.

## v0.20.0 (2026-10-23)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Navigation: one menu on the left**: the tab bar, the « Inventory » menu and the Settings gear give way to a side menu in four groups (Overview, Inventory, Protection, Administration), always visible, folded to icons on demand (kept by the browser, folded by default under 1280 px) and opened as a drawer on a phone. An entry without a source is left out, and so is an empty group; the alert dots stay on the entries. History is its own entry.
- **Fail2ban: its own page**, listed under Security in the menu when a Fail2ban is read; Security keeps its other sub-tabs, and its open sub-tab is now in the address (`#security/certs`), so « back » and links work.
- **Sub-pages in the menu, no more tabs inside the pages**: the views of a page are listed under its entry, all shown while it is open, a chevron folds them by hand; folded to icons, they open in a small panel, on hover or on a click (Profile → Appearance → Folded menu). « To watch » is the first view of Network, Services, Backups and Security, opened by default when something is to watch; Network's UniFi, Freebox, Scan, Devices and Diagnostic, Backups' « All sets » and « By machine », Services' « All services » are views of their own, each in the address (`#network/unifi`, `#backups/all`).
- **Settings spread over the menu**: the Settings page and its own menu are gone. Its sections sit under the topic they set (Machines, Network → Discovery, Backups, Alerts) or in Administration: Connectors (my connectors, available, found to link), Accounts and access (accounts and sessions, API and MCP tokens, the app's SSH key, now a page of its own), Application (tasks, updates, e-mail, export and import, requests, audit log, logs, information). « Information » and About are one page. Old `#settings/...` links still lead to the right page.
- **Machines: three sub-pages**: all the machines, devices not followed, agents; adding a machine is a page opened by the « Add a machine » button of the list (the separate window is gone). The warning of a machine refusing the app's key moves to the SSH key page. The menu shows a count next to Network → Discovery (what is left to do) and next to each Security sub-page (its findings).
- **Settings windows become pages**: each service has its page (`#services/item/…`), opened from its row, with its settings on a page of their own (`#services/edit/…`); « Declare a service » is a sub-page of Services; the form of a found connector opens in the « Found, to link » page. The windows of the start assistant stay (a guided path).
- **Settings of a topic in the menu too**: Backups → Settings is five sub-pages (followed sets, add backups, copies elsewhere, searched places, archived sets) and Network → Discovery five (mode and to do, machines on the network, apps to enable, other suggestions, stopped and forgotten); their folded blocks become pages. « To watch » leaves the menu when nothing is to watch, and the page opens on its main view (by machine for Backups, all services for Services). The logo and the name sit at the top of the menu (the logo alone when folded); the version stays in the header.
- **Alerts in five sub-pages**: channels (with the alerts' state), alert rules, my notifications, examples, and one « Last sent » page for both alerts and notifications; the two former tabs and their duplicate texts are gone.
- **Home and History in the menu**: Home → overview, statistics; History → events, availability (each in the address); the small menu of the home page and the switch of History are gone. Tasks and schedules also lists the schedules set elsewhere (the update check, each notification report) with a link to where each is set. About no longer repeats the updates block: the check lives in Application → Updates.
- **Figures on top of Availability and the network scan**: Availability opens on a row of figures (average per kind over the period, down now, under 95 %); the scan's counters become the same figures and its view no longer folds. In the menu, a category's name opens or closes its sub-pages instead of opening a page; « View », « Discovery » and « Settings » are headings over their pages that open the first one shown.
- **Statistics, rearranged**: a row of key figures on top (machines reachable, services online, health, backups up to date, connectors answering, and the average availability over 7 days), then the counters of each topic in a grid of two columns (three on a very wide screen) instead of one long column, the schedules below.
- **Machines, Services and DNS sub-pages reworked**: « Add and detect » leaves the Machines menu: « All machines » has the « Add a machine » and « Redetect » buttons, each opening its page; devices not followed are shown directly, no longer folded. Services gets a « New services » sub-page (admins) for the services found these 7 days, shown directly. DNS has three sub-pages: « To watch » (left out when nothing is to watch, like the other pages), « Servers » and « Details » (the former folded « See all »); a row of « To watch » opens the sub-page of its section.
- **Connectors: « Already read over SSH or by an agent » is a sub-page** of its own (it was a folded block in « My connectors »), and « Found, to link » shows its list directly, no longer folded.
- **Always full width**: the « Page width » setting of the profile is removed; the pages follow the screen.
- **Header**: the scan animation and its text sit alone in the centre; the gear is gone (Settings is in the menu and in the account menu).

### Fixed
- **Leaving a page with sub-pages**: from History, Services, Network, Backups or Security, a link of the menu or the logo could bring back to the page just left (it rewrote the address to its default view while closing); it now only does so while the page is still the one asked for. The old `#fail2ban` link opens Security → Fail2ban.

## v0.19.1 (2026-10-23)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Veeam: what each job backs up, on the machines**: the job settings give each VM (or computer) with the host it runs on, its size (Veeam writes it as text in the server's language: « 129,7 GB », « 1.5 TB ») and its restore points. A VM goes to the machine of the same name; the machine window shows « Backed up by Veeam » (job, host, repository, age, VM size, points) and a hypervisor lists the « VMs backed up here », the ones with no machine flagged « not linked ».
- **Veeam wizard: the machine of each VM**: under each job, its VMs with the machine found by name, another one or « no machine » chosen in a menu; « Change the machines » on a followed job keeps its name and threshold. The choice wins over the name.
- **Veeam: backups without a job**: Veeam B&R 12.0 leaves computers backed up by Veeam Agent out of its job list; their backup is now read as a job (date of the newest restore point, result of its last session when there is one). Imported backups are left out. Job contents, backups and restore points are optional reads, kept 30 min when a cache is available.

### Security
- **certifi 2026.10.19** (Dependabot alert, critical): the CA bundle no longer trusts the emSign roots whose intermediate keys were compromised.

### Fixed
- **Menu paths brought up to date**: the agent of a machine lives in its window (« Access » tab), not in a Settings → Agents page any more (README EN and FR, the « computer name changed » message of an agent); e-mail settings are in Settings → Backup and info; a task run by hand is logged under « Tasks and schedules ».
- **Veeam: « (inactive) » no longer shown after the last result**: Veeam 12 writes the state in lower case (« inactive », « disabled »); a disabled job is recognised whatever its case.

## v0.19.0 (2026-10-22)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Services and storage checks on Linux machines** (SSH and Linux agent, no sudo needed), in the machine window and in « To watch »: PM2 (daemons, `pm2-<user>` units, saved apps and whether they run), software RAID (degraded, rebuilding), ZFS pools, network shares (NFS, SMB, SSHFS: not answering, in error, or in `/etc/fstab` but not mounted), clock synchronisation, systemd timers whose last run failed, automatic updates (unattended-upgrades: errors, last run too old), snaps waiting for an update, open sessions, and Docker containers restarting in a loop.
- **Services to restart after an update (needrestart) and Fail2ban bans**, each read through one exact read-only sudo rule (`needrestart -b -r l`, list mode, never restarts anything; `fail2ban-client banned`, every jail in one command). Without the rule the machine window says « not read » and gives the exact rule to add for the SSH account.
- **Web servers of a machine** (machine window, « Software and services »): one line per web server found (Nginx Proxy Manager, Anubis, Apache, nginx, Caddy, Traefik, HAProxy, lighttpd) with how it runs (Docker container, systemd service, or binary listening without either), the ports it listens on and what it forwards to. Only known web server binaries are listed; any other process is left out.
- **Site paths**: for each domain served by the machine, NPM → the service it reaches (an Anubis relay…) → what runs behind it (container, Apache vhost, process), a stopped step in red.
- **Every container of the machine**, even the ones no service points to (databases, watchtower, stopped ones), folded by default.
- **Containers in host network are recognised by their port**: Anubis is read from its `BIND` and `TARGET`, other apps from `PORT`. Only these variables are read, filtered on the machine itself: the others (passwords, tokens) never leave it. Ports published on the loopback (`127.0.0.1:3011`) are kept to name what a relay of the same machine forwards to.
- **Backups section in the machine window**: the sets the machine produces (schedule, age of the last archive, size, copies elsewhere, 🔒 when encrypted, « no copy » in orange), the backup folders that hold them, and the replication (each place the copies go, how: rsync, pulled by another machine, vzdump, encrypted or not, and how old). From the Backups page data, nothing new is read on the machines; untracked folders and cron lines stay on the Backups page.
- Anubis icon in the Servers column, with one tooltip line per instance (port, how it runs, what it forwards to).
- **PM2 is never started by MyServices**: it is read from its processes and files, never through the `pm2` command (any `pm2` command starts its daemon again when it is down).

- **Veeam: history of each job**: the last 10 runs are read (optional, like the repositories); a Veeam set says how many recent runs failed (in its detail only, its level is unchanged), gets an observed rhythm (so the threshold suggestion works for Veeam too) and names the repository the job writes to.
- **Veeam: a Backup Copy job attached to the job it copies**: Veeam does not say which job a copy job copies, so the Veeam wizard asks (« copy of »). The copy job then becomes a copy of that job's set, judged like any copy, instead of a set of its own.
- **Veeam Agent and Windows Server Backup as backup sets**: in the Veeam wizard, « Veeam Agent for Windows (MyServices agents) » lists the last run each Windows agent saw and follows the chosen ones, with no account to enter. The set belongs to the PC (it shows in its machine window); a failure is critical; the agent does not say where the backup is written, so no copy elsewhere is required.
- **Linux agent version 4, the same inventory as over SSH**: it also sends the machine info, the Docker containers and networks and the listening ports, read on the server with the same code as an SSH session, so a machine looks the same whichever way it is followed (the machine window says « MyServices agent » as the source).
- **`MSV_SUDO=1` for the Linux agent installer**: exact sudo rules for the three read-only commands that need root (needrestart in list mode, Fail2ban bans, `ss -tlnpH` for the process names behind the ports), in one sudoers file with `MSV_SMART`. As root, or with the rules, the agent reads them; without, the machine window gives the rule to add.

### Changed
- **One SSH connection per machine for the whole health collection** instead of one per command: about 20 connections per machine and per pass become 3 (access check, every command, SMART for all the disks). Each command keeps its own time limit, and the outputs are read exactly as before.
- **Fewer requests to the machines**: every SSH read of a pass (health, listening ports, Docker, machine info, hypervisors, NPM, AdGuard, backups) shares one connection per machine (ControlMaster, 60 s); the listening ports are read every other collection (30 min); an agent report re-reads only its own machine, from the report, with no SSH and no new API call, even when its level changed (before: a full health pass of every machine).
- The Servers column of the Machines table comes from the same web server list: one icon per kind of server, a red frame when an instance is stopped.
- The Services page shows what a relay forwards to (« → apache2 · rss.example.fr »).
- An agent report sent too soon after the last one is answered « already received » (200) instead of 429: the agent no longer retries it and its scheduled task no longer runs again.
- Linux agent version 2 (the new checks; it updates itself when automatic updates are on). A report may carry commands up to 4000 characters long.
- **Linux agent version 3, lighter**: `apt list` and the search for big log files run at most once per hour, SMART every 6 h (their last output is kept in `cache.json` next to the agent and sent again in between); the report is sent gzip-compressed, and when it is still too big the longest outputs are cut rather than the whole report being refused.
- **Windows agent version 9, lighter**: hardware, physical disks and running services are read every 6 h (the server keeps the last ones in between); one query for stopped and running services; failed logons are counted up to 1000 instead of reading them all; the system name and boot time come from the report instead of two more queries.
- **Agents still need a click to get the new version**: automatic update is off by default, so use « Update now » (or turn automatic update on) in Settings → Agents. Older agents keep sending their reports and are read as before.
- Agent reports are handled in a worker thread (the server keeps answering meanwhile); the health level of the last report is kept in the database instead of parsing the previous report again at each one; the agents list no longer loads every report.

### Fixed
- **A Windows PC read over SSH could not answer** when its OpenSSH shell is cmd.exe (the default): the health script, passed on the command line, was 12 462 characters long, over cmd.exe's 8191 limit. It now goes through stdin behind a short loader, and the Windows Update titles are reused for an hour instead of searching at every read.
- Home Assistant in advanced mode (ha-mcp) failed on every read with « internal connector error (AttributeError: 'HomeAssistantAPI' object has no attribute 'cached') »: the slow ha-mcp calls now go through the connector cache as intended.
- A service whose target changed (an NPM host moved from Apache to an Anubis relay) no longer keeps the name of what ran there before (« apache2 · rss »): the name is only kept when the target is the same, and a « changed recently » badge (date and previous target in its tooltip) is shown for 7 days.
- An NPM host pointing at the Docker bridge of its own machine now finds the container listening on that port (published, or in host network) before looking for a service of the host.
- « To watch » showed « Docker : [object Object] » instead of the containers in trouble: it now names each one with its status.

## v0.18.4 (2026-10-22)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Security
- **Node.js 22.23.4 in the image instead of Debian's Node 20.19.2** (CVE-2026-111497, out-of-bounds write in the Brotli decoder, possible remote code execution; Node 20 is end of life and will not be fixed). Node is only used to draw the infrastructure map with Archify (`server.py` runs `node archify.mjs`): the image no longer installs the Debian `nodejs` package and copies the official `node` binary from the `node:22-trixie-slim` build stage (same trixie base and glibc). npm is not needed and not shipped.

## v0.18.3 (2026-10-21)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Services: one line per service on several ports**: the ports of the same container (by its name on the machine) or the same process (by its name, except generic ones such as python3 or node, which may be different programs) make one line in the list, grouped by machine or not, with one chip per port in the colour of its state (on one line while the address and the ports fit the Target column, 4 ports at most, else they wrap); the Domain column is a little narrower and the Target column wider, a long redirect target is cut with its full text on hover; the line shows its worst port, a chip opens that port's detail. The top figures still count each port.
- **Services: the detail shows the ports and what goes with the service**: the ports of the service as chips, and the NPM host and the container or process behind it, in both directions (same machine, same service name or a target on one of its ports), each opening its own detail.
- **Services: the State column has one badge per piece of information** (« OK » and « redirige » instead of « OK · redirige »), the state first, then where it is read (« Proxy NPM », Apache, nginx, Docker…), then the other pieces (« redirige », « protégé »…), then the access icons one gap apart; the 🌐 « declared domains » icon is kept for a machine's services only (an NPM host always has its domain). In the « by machine » view the state lines up under the server icon of the group.
- **Audit log and Logs moved into Settings**: they leave the account menu and join Requests in Settings → Application → « Requests and logs », as three sub-tabs (Requests, Audit log, Logs). The old addresses (`#audit`, `#logs`, `#settings/audit`, `#settings/logs`) open the matching sub-tab.
- **Percentages on one line, unit smaller**: in Backups › By machine, on a machine page (Health, Share) and in the Machines table (CPU, memory, disk, GPU), the value keeps its « % » or « °C » on the same line, the unit smaller than the value; the free space no longer wraps.
- **Machines table: a load bar for each GPU**, under its name, the same width as the CPU and memory bars.
- **DNS: a domain row names the name that fails**: an NPM host with several names showed its first one (which resolved) with « does not resolve »; the row now says which name, e.g. « does not resolve : way.example.info », in « To watch » and in the domains table.
- **Page titles carry badges, as on Network**: DNS, Security, Backups and Services show their counts (blue), the tools read (green), the time of the reading and « read only » as badges next to the title, instead of a grey sentence.
- **« To watch » hidden when empty**: on Network, DNS, Backups, Services, Security and a machine page, a « To watch » frame with nothing in it is no longer shown.
- **Home: « To deal with now » folds**: a click on its header or chevron folds it to its title and count; the choice is kept in the browser.
- **Network: one sub-tab per source**: UniFi (first, the cards now titled « UniFi »), Freebox (its card, when a Freebox is linked), Scan (the network scan, moved out of « Cards »), then Devices and Diagnostic unchanged. A sub-tab whose source is gone leaves the bar and the page opens on the first one there; a Freebox notice in « To watch » opens the Freebox sub-tab.
- **Network › Diagnostic: SFP modules and port errors**: every transceiver UniFi reports (through MynetworK) is listed with its sensors (temperature, light received and sent, supply voltage, laser current), and a finding is raised for a loss of signal, a transmit fault, a hot module (from 75 °C, to fix from 85 °C), weak or blinding received light, or a supply outside 3.13 to 3.47 V. A 10GBASE-T copper module has no light figures. A « Port errors » frame lists the ports with receive or send errors and dropped packets (MynetworK passes these counters in card-devices), errors first; a rise of at least 10 errors against a reading taken 10 min to 2 h earlier is a finding (to fix from 1,000), dropped packets alone raise nothing.
- **Services › New services on the machines**: a lower one-line header, the hint right after the title, and a clearer hint: they are already followed, « Don't follow » pauses them (it read as if they were not followed yet).
- **Services: « Public site on purpose » from the page**: an NPM host without access list nor LAN guard can be declared public on purpose in one click, from its « To watch » row (globe icon) or its detail (where it can be taken back); written under its domain in services-meta.json (« public »), the page follows at once. Its badge now reads « ⚠ public? » (to confirm) instead of « ⚠ open? ». The detail button of a « To watch » row is a magnifier icon.
- **Services: edit a service (pencil)**: a pencil at the end of each row of the full list and « Edit » in the detail header open one window for the hand-set fields: category (one of the existing ones: the rules of services-meta.json and the ones already given), description, tags, kind of interface (automatic, web page, API, no web), public on purpose, direct access on purpose, pause. The form starts from the service's own services-meta.json entry, so « automatic » stays automatic; saved in that entry (else a new one under its first domain) and in the page at once.
- **SFP modules: « this is normal, stop reporting »**, as on the findings: the button of a module accepts (or reports again) all its findings at once; an accepted module shows « accepted » and leaves the counts.
- **Services: hide a service from « To watch »**: an admin can hide a service there; it also leaves the dot of the Services tab and the home page, until its problem changes (another state, label or point to check brings it back by itself). « Show hidden » lists them again, greyed, with the date and a button to show them back; the full list keeps their real state with a « hidden » badge, and the top figures still count everything. Kept on the server (state/services-watch-hidden.json, part of the configuration export).

- **Machines table: lighter columns**: in Health, the « to watch » badge is gone when the cause pills follow it (they already say it; it stays for a machine without any pill); in Services, the total is followed by **+N in red** (down) and **+N in orange** (a problem), without a frame, which ones in the tooltip; a virtual machine has its cube before its name and its name underlined with dashes, in the table and the cards.
- **Services hidden from « To watch » leave the Machines page too**: they no longer count in the Health pill « services down », the colour dot of the cards, the « worst first » sort nor the +N; the tooltip of the count says how many are hidden.
- **Tooltips: what a click does, in a strip**: a tooltip on something clickable ends with a strip « Click: ... » (mouse icon), so nobody tries to click the bubble itself; tooltips show a little faster (150 ms) and are narrower. Used on the Machines page (health pills, services count, machine name).
- **Machine page: Open ports**: each port shows its service icon (the same as in Services), a state dot, the service then its kind (Docker, Apache...) then `:port`; an exposed port shows its domains as short chips that open the site, « LAN » is discreet; a known port not seen open by the last scan is faded; an unknown port shows « ? » and what usually listens there (a guess, said so); the scan date sits once in the header.
- **Home: « What changed since yesterday »**: the name chips are no longer bold nor white, on a darker background.
- **One way to search everywhere**: the Audit log, the Logs, the machine icon picker and the connector picker now search word by word like the lists (every word typed must appear, in any order, without accents nor case); before, the first three looked for the whole phrase as typed. The Audit log and the Logs have the same search field as the lists, with « N of M ».

### Fixed
- **Zombie processes filled the container**: `server.py` ran as PID 1 and never reaped the orphaned `ssh` processes of the tasks; after about a day they reached the container's process limit and the server could no longer start a thread (« can't start new thread »). The image now runs `tini` as PID 1.
- **A failed pass of the connector readers no longer re-reads every connector every 10 s**: the attempt is noted before the reading, and a reading that cannot start is an ordinary failure. Before, a pass that broke before the end left the state untouched, so every connector was due again at the next tick.
- **Home Assistant with ha-mcp**: the system health (`ha_get_system_health`) is read once an hour instead of at every reading. Each call makes Home Assistant test whether GitHub answers, which counts against the GitHub quota of the whole public IP (60 requests an hour without a token) and could block other tools on the network.
- **Glances: a plugin switched off is no longer asked at every pass**: a route answering 400 or 404 (« Unknown plugin », such as `sensors` without sensors) is asked again after an hour instead of every 5 minutes.
- **Beszel: one sign-in per token, not one per pass**: the hub token is kept in memory until shortly before it expires (read from the token), and a kept token that is refused signs in again once. A changed password signs in again at once.

## v0.18.2 (2026-10-19)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Settings › Requests**: the request counters of the connectors (0.18.1) are now a section of Settings on every build, measured in real conditions, with « Copy the reading » (JSON, to paste for analysis) and « Reset » (`POST /api/v1/connectors/requests/reset`, admin) buttons; the folded block under the connector cards and the one that sat under the network diagnostic are gone, and `GET /api/v1/connectors/requests` answers on a released image too (admin).
- **A connector saved, turned on or off, or removed is read at once**: the running configuration is read again in place and the cached readings of the former set go; before, the readers, the machine sheets and the UniFi cards ignored a connector turned back on until a restart.
- Home, « What changed since yesterday »: every row on one shared grid (mark and label, names, time aligned); History: the Events / Availability switch in the middle of the period row of both views, the three home sub-pages start at the same height; Network: the title line as tags; « To watch » at zero shows a green zero and stays shut; the collection step of the header orb is translated; a « Settings » entry in the account menu (admin).

### Fixed
- Two React warnings: whitespace text nodes before JSX comments inside table rows (Machines and others), duplicate uplink port choices on the UniFi cards.

## v0.18.1 (2026-10-19)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Request counters (development builds only)**: the server counts every HTTP call of the connectors per route (calls over the last minute and the last hour, total, last and mean duration, last code, 429 answers with their Retry-After, last error) and the readings served by its caches; a folded « Requests (debugging) » panel under each connector card (Settings › Connectors) and under Network › Diagnostic shows them, with what is to watch (a route near a limit known on the service, a 429 received in the last hour). Route `GET /api/v1/connectors/requests` (admin), 404 on a released image; counters in memory, reset at restart.

### Changed
- **MynetworK, limits per API token** (MynetworK 0.11.3: 300 calls per minute, 30 on `ip-details` and `top-traffic` in live mode): a 429 answer is now told apart (`RateLimited`, with the delay asked by Retry-After) and written in the log; the detail sheets of the followed machines are read thirty per pass, a minute at least between two passes, each sheet read again after its period; a 429 ends the pass until the delay given, the sheets already read stay and an address in error keeps its last sheet. More than thirty followed machines no longer hit the limit.
- MynetworK: the Freebox hosts are read in the compact form (`?compact=1`, ignored by older versions) since only their number and the active ones are used; the inventory pagination relies on the real total given by MynetworK since its fix.

## v0.18.0 (2026-10-19)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **« + Service »** in the Services tab (admin): declare a service the detection does not see (a page on a machine without SSH or agent, a device, a port to watch) with a name, a followed machine or a free IP, a port and a scheme (http, https, or tcp for a port alone); « Try » probes it without saving, « Follow » writes it to the inventory and it is probed at each reading like any other service. The detail of a declared service offers « Edit » and « Remove ». A service detected later at the same address replaces the declared row. API: `/api/services/manual` (list, add, edit, remove) and `/api/services/manual/try`.
- DNS is a tab of the bar (after Network); the Inventory menu keeps Infra, Virtualization and Diagrams, opens under the bar flush with its button, square on top.
- **DNS tab in « state » mode, always shown**: without AdGuard the server asks the resolvers of the container itself (resolv.conf) for every NPM domain, so the page works on any network; the name of each followed machine is asked too (as is, then with the search domains). The page: a title line (resolver or tools wired, domains checked, machine names, reading time), four figures (resolution, DNS servers, sync, rewrites), **« To watch »** (an instance silent, the sync failing, a domain that does not resolve or resolves elsewhere, a machine name pointing elsewhere, rewrites differing between instances or orphaned), the synchronisation and instance cards kept (the same frame will serve another local DNS cluster), and **« See all »**, folded, with the detail tables and the machine names.
- Tab bar: the « Inventory » menu opens right under the bar, flush with its button; every dropdown now starts at the bottom edge of its button.
- **State pages**: the « To watch » frame of the Backups, Security, Services and Network tabs folds and unfolds on a click of its header, the choice kept in the browser.
- **Network tab in « state » mode** (fourth step of the ergonomics plan, last page): a title line (gateways, switches, access points, devices, sources, reading time), five figures above the sub-menu (Internet access with a fact of the box or firewall, equipment online with the updates available, clients, devices online with the ones not followed, sources), then **« To watch »**: a network source failing or a piece of equipment offline in red, then what the box or firewall reports, firmware updates and weak Wi-Fi links (under -75 dBm) in orange, each with a button to its sub-tab or to the machine. The « Overview » sub-tab becomes « Cards » (scan statistics and UniFi cards, its former tiles replaced by the figures above); the other sub-tabs do not change.
- **Services tab in « state » mode** (fourth step of the ergonomics plan): a title line (services, with a domain, local, machines, reading time), four figures (online, down, warning with its reasons, to check with the points met), then **« To watch »**: the services down, in warning or with a point to check, worst first (service, machine, access, state, a Detail button to the detail window). The « new services seen » card (follow or ignore) moves from the home page to this tab. **« See all »**, folded, holds the former page as it was (search, filter chips, sorting, « By machine », cards on a phone); it opens unfolded when the tab is reached with a filter.
- **Security tab in « state » mode** (fourth step of the ergonomics plan): a title line naming the tools read (Fail2ban by LogviewR, Nginx Proxy Manager, SSH, MynetworK) and the reading time; six figures on the same tile as the Backups tab (public sites, Fail2ban in 24 h, SSH access, certificates, sensitive ports, access to MyServices); then **« To watch »**, one row per problem, worst first: the public sites sharing a gap make one row (« No HSTS, 5 sites ») with the advice for that gap, the machines whose SSH server has the same weak setting make one row, a row unfolds into the things it covers (a machine opens its page) and the way to its sub-tab. The sub-menu (Fail2ban, public sites, SSH access, access to MyServices, network ports, certificates) sits under it, without « Overview »; each sub-tab keeps its page.
- **Settings › Backups in three blocks** (fourth step of the ergonomics plan, from the mock validated by the author): **« My followed sets »** is one table for every source (set with its machine icon, source, machine, expected schedule and maximum age typed in the row and saved as you leave the field, « copy required » switch with the copies elsewhere unfolding under the row, state badge, a « ⋯ » menu to rename, change the folder, open the copies, archive or remove), with filter chips by source and « Flagged »; **« Add backups »** shows the sources as tiles, the wired ones first, a greyed tile naming the missing connector, and opens the existing wizard of the clicked source under the tiles, one at a time, plus a **« By hand »** tile to declare a folder the search did not see; **« Rules »**, folded, holds the copies elsewhere search, the searched locations (default folder, common and per-machine locations) and the **archived sets** (unarchive, remove). API: `PATCH /api/backups/settings/<id>` also takes `archived`, `schedule` and `path` (folder sets only); the settings list returns `archived` and `schedule` for each set.
- **Backups tab in « state » mode** (fourth step of the ergonomics plan, first page): four figures (up to date with the copies elsewhere, late, missing or failing, latest archive produced), then **« To watch »**: the sets that are not ok, worst first (set, machine, expected, latest archive, state); a row unfolds into what the server holds against the set, every place (source or copy, folder, latest archive, size, state), the cron line that produces it when recognised, « Set up this set » and « Open <machine> ». Folded under it: **« See all »** (every set, with sizes) and **« By machine »** (the former page: filters, disks, latest local backup, copies, sets produced, local backup folders) plus the backup-looking cron lines that no followed set claims.
- **Page of a machine** (`#machines/<ip>`, third step of the ergonomics plan): a row of the Machines tab now opens a full page instead of a window: the detail sections (identity, system, access, software, backups, health, updates, UniFi or Freebox), the availability of the machine over 30 days (one cell per day, from the availability history) and, for an administrator, its settings (identity, options, access with SSH, agent and connectors) in the page, saved as you go. `#machines/<ip>/access` lands on the Access settings; the old `#settings/machines/<ip>` and `#settings/agents/<ip>` links redirect there. « Add a machine » (the same four-step assistant as in Settings) is also offered from the Machines tab. On the home page, a machine that no longer answers leads straight to its page.
- Machine page, two more cards: **Open ports** (the ports seen open by the scan and those of the known services, each with its service and the NPM domains that expose it; an unknown port is told so) and **Virtual machines** (the guests of a machine that is a hypervisor host, running first, a guest followed as a machine opens its page).

### Changed
- **Fewer options** (fifth step of the ergonomics plan, one commit each): the « health read first by » choice of a machine is gone (the automatic order serves); the integrated health is always on, its switch and route are gone (an external health-watcher still replaces it); one switch « Services outside Docker » in the SSH frame instead of two; the header notice of a new version follows the automatic check; « Hosts NPM » is no longer an option of a machine, the collection sets it. Settings › Tasks and schedules reads as a list (task, schedule in words, last and next run): the schedule fields, the networks walked by the search, the discreet mode and the live checks sit behind « Edit the schedules ». Settings › Backups › Rules: the per-machine searched locations sit behind « Advanced ».
- **Second step of the ergonomics plan: tab bar, account menu and Settings.** The tab bar now has six tabs (Home, Machines, Services, Network, Backups, Security) plus an « Inventory ▾ » menu for the less-visited full lists (Infra, Virtualization, DNS, Diagrams), each with a short hint; it shows « Inventory · <page> » when one of those is open. Settings leaves the bar: a gear button next to the avatar (admins) opens it, at the last section visited.
- Account menu reordered: Profile, Theme, then a « View » group (Audit log and Logs for admins, Help, About, GitHub project), then « Review the setup assistant » (admins), then Sign out.
- Audit log, Logs, Help and About are now pages apart like Profile (a Back link, no tab bar), opened from the account menu or `#audit` / `#logs` / `#help` / `#about`; Audit log and Logs stay admin-only.
- Settings: four groups, ten sections (down from sixteen): Sources (Machines and access, Connectors, Network discovery, Backups), Alerts (Notifications), Accounts and access (Accounts, Keys and API), Application (Backup and info, Tasks and schedules, Updates). The SSH key moved into « Keys and API », above the API and MCP tokens.
- **Home page rebuilt around three blocks** (first step of the ergonomics plan: Watch / Inventory / Configure). « To deal with now » lists every alert, red first, each with a button that opens its tab already filtered on what it talks about (« See the machine », « See the set »…), 8 lines then « See all ». « What changed since yesterday » lists the events of the last 24 h (the chart stays in History). « Missing » (administrators) names the sources that would unlock a page or a follow-up: machines online without agent or SSH, Backups / Network / DNS pages hidden for lack of a source, no notification channel; each line leads to the setting that fixes it. The header line says how many machines, services and backup sets are followed.
- History is a sub-tab of the home page (« Overview / History »); the `#history` link still works.

### Fixed
- Machines: a health badge « warn » or « crit » always says why. The server publishes the level of each control with the host (`checks`: disk, systemd, docker, kernel, load, ssh_auth, smart, temp, memory) and the page uses the same thresholds (Windows instant CPU, exited containers, load average at 1.5 and 3 times the CPUs, 1 and 3 failing systemd services, 20 and 100 refused SSH logins); a control flagged by the server that the page cannot detail gets a general sentence instead of a mute badge. In the Machines list the reasons stay in the tooltips of the badge and of the icons; in the machine page the « Level » row of the Health section says why (words and tooltip).
- Home page: the counters (machines, NPM, services, health, AdGuard, backups, connectors, network, upkeep, virtualization) are back as a « Statistics » sub-tab (`#stats`), next to Overview and History.

### Removed
- Backups tab: the « Attention points » table (its lines are the « To watch » rows and their detail) and the volume tiles (the sizes are in « See all »).
- Settings → Machines and access no longer lists the machines (their settings live in their page): it keeps adding a machine, redetection, the key to authorize, the devices seen by your tools and the agents, with a link to the Machines tab.
- The Settings entry from the account menu (replaced by the header gear button); the « SSH key », « Audit log », « Logs », « Help » and « About » entries from the Settings menu (moved as described above).
- Home page: the counters column, the grouping of alerts by category, the « rows to show » setting. The « machines without usable SSH access » orange alert moves to « Missing ».

## v0.17.0 (2026-10-19)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **One reader per connector** (tier 4 of the request plan): the server reads every configured connector at its own period, in parallel, and keeps the reading in the shared state; the collection, the health check and the live picture (`live.json`) reuse it instead of calling the service again. Each connector can have its own period (« Read every », minutes, in its card); the default is « Connector readings » in Settings → System (formerly « Fast connectors », 0 = off: every task reads by itself, as before). NPM and the per-machine SSH readings stay with the collection.
- Machines table: the CPU, Memory, Disk and GPU columns sort (the busiest first, unread machines last).

### Changed
- Connectors page: the explanation sentence is gone, « Already read over SSH » sits folded under the title, the cards of « My connectors » are inside their frame, two columns on wide screens, on the mid background.
- Machines table: no alert dot on the machine icon any more (the « To watch » column says it); the percentages of the meters are smaller than the data.
- « Seen by your tools, not followed here » moved from the Machines tab to Settings → Machines (folded under the machine cards; « Follow » adds the machine and the list reloads).

### Technical
- `readers.py` (server loop every 10 s, due connectors read with up to 8 workers, 60 s each); `connectors/base.py`: `period()`, `status_of()`, `merge_state()` (only the entries just read are written: the server and the collection share `connectors.json`), state entries carry `message`, `duration_s`, `found`, `tried`; `fast.py` derives `live.json` from the state (MynetworK detail sheets apart); common connector field `every` (1 to 1440 minutes); `components/UnlinkedDevices.tsx`.

## v0.16.1 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Backups: « Attention points » and Settings → Backups are linked both ways. Each attention point about a followed set carries the set id; its row has a small gear that opens Settings → Backups on that set (unfolded and framed). In the settings, a set listed in the attention points shows a badge with its level (late, critical, unreachable) and the texts in the tooltip, its source row shows the same badge, and the « Followed backups » heading counts the sets to check. Attention points about a machine (full disk, unreachable, Syncthing) carry the host id and have no gear.

## v0.16.0 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

## v0.15.9 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

## v0.15.8 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- API `GET stream`: an event stream for the page (server-sent events). The server sends the current state when the stream opens, then « manifest » when a produced file moved, « status » when the collector's state changed and « tasks » when a task started or ended, with a heartbeat every 25 s. The page reads nothing at rest any more: the home page, the scan bar, the schedule card and the discovery panels wait for these events, and keep a slow safety read (1 to 2 minutes) only while the stream is down. The browser reconnects by itself.
- Settings, Machines, SSH access: the SSH address can differ from the machine's IP (a DNS name, another network); `POST machines/ssh-alias` takes `host`, and the alias of a machine is found through its settings, not only through its IP.
- Listening ports with a non-root SSH account: the collection tries `sudo -n ss -tlnpH` first; the machine window gives the one-line sudoers rule to allow it (read only), behind a discreet « How to set it up on the machine? » link.
- API `GET manifest`: the stamp (modification time and size) of every produced file the page reads (data, pulse, live, events, health, backups). The page asks this small document every 15 s and reads a file again only when its stamp moved; at rest the home page makes one small request per 15 s instead of a dozen revalidations per minute. Without the route (older server), the page reads everything as before.

### Changed

- Settings, Machines: the SSH section of a machine window is redone. One « Connection parameters » block (SSH address, port, account, « Save and test » with the result lines), a collapsible « App key to authorize on the machine » with the command for the typed account (open when the connection is refused or at the first activation), then the connection state. The first activation opens the parameters in place instead of a separate guide. The « Listening ports » switch is no longer greyed for a non-root account. The same block serves the add frame.
- Page: one refresh loop every 15 s guided by the manifest replaces the three loops (full load every 60 s, live every 15 s, fast window after a change); the account is read again every 5 minutes; coming back on the browser tab reads at once.
- Collection and fast loop: every connector instance of every kind (status, network, security, containers, virtualization, and the light reads) is read at the same time, so a pass lasts as long as the slowest service instead of the sum of them all.
- Connectors: the version of a service is asked once, then reused from the connector state for 6 hours (one request less per connector and per pass).
- API `GET system`: folder sizes and the key fingerprint are kept 5 minutes (several panels read this route).
- Page: after a change, the data is read again every 15 s for 1 minute (was every 5 s for 2 min 30); the scan bar still reloads when the pass started by the change ends. The assistant's own progress, a detection proposal and « read this machine again » no longer trigger a reload. The live tick skips its turn right after a full load (the two no longer coincide every minute). The schedule card asks the tasks every 15 s at rest (1.5 s while one runs). The scan bar and the check after an import stop reading while the browser tab is hidden, and the latter stops for good once the chained tasks ended. The discovery panels share one read when several mount at once. Saving a machine setting reloads the data once, not three times.

## v0.15.7 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- API: `POST machines/ssh-alias/test` checks the SSH access of a machine not declared yet (the alias prepared for it), and `DELETE machines/ssh-alias/{ip}` removes an alias the page wrote when the add is cancelled. A hand-written alias, or one used by a declared machine, is never removed.
- Settings, Machines: a « Custom SSH access » block (account and port) in the SSH section of a machine, for a server outside the local network or on a non-standard port (the network search never sees it). It writes the account and the port into the application's SSH config for that address and tests the access.

### Changed

- Settings, Machines: « Add a machine » is redone as one frame in four steps, one open at a time (target and detection; what was found, with the web services to follow; access as a three-button choice, SSH, agent or none, with account, port, the key to authorize and a connection test before the add; identity and options as one flat list of switches, the detected ones pre-checked). Nothing is written before « Add the machine »; the SSH alias prepared for the test is removed again on cancel. The same frame serves the assistant. Neutral colours: the current step number, the state badges and the main button only.
- Settings, Machines: the Agent and Connectors sections of a machine window open by themselves when there is an active agent or a connector reading the machine, and stay closed when empty.

## v0.15.6 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Backups: a machine declared in the backups with an SSH alias this installation does not define (a declaration brought from another install: « Could not resolve hostname », « Host key verification failed », or the wrong port) is now reached through the SSH access of the followed machine that has the same address, port included. A machine declared as « local » is no longer read inside the container, where its folders do not exist (« source: folder absent »). Nothing to edit by hand in the SSH config.

## v0.15.5 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Machines: the machine window shows the front panel of the UniFi switch a wired machine is plugged into, with its port framed (`mark_port` option added to the vendored card, noted in `VENDOR.md`).
- Machines: GPU load, temperature, memory and power from `nvidia-smi` and `rocm-smi`, read over SSH and by the Linux agent with the same command (`GPU_CMD`); GpuViewR stays first, then these tools, then the `lspci` names. Existing Linux agents need an update to report it.
- Settings, Backup and info: after an import, a banner says the collection, the watch and the health are still reading the imported data, then that it is up to date.
- Machines: the « N service(s) down » notice lists which services are down and why, in the health column tooltip and in the machine window.

### Fixed

- Settings, Connectors: a test made from the page is kept by the server and shown on the card at once (version, what was read, or the failure); the Beszel card shows its version and the number of systems after a scan instead of nothing.
- Backups: a missing copy folder says which path to create and on which machine.
- Linux agent: the uninstall also clears the failed state of its removed unit, so `systemctl --failed` no longer lists `myservices-agent.service`.

## v0.15.4 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- MynetworK failed its whole reading (« timed out », sometimes for several collections in a row) when the UniFi controller behind it was slow: its three UniFi routes took 20 to 30 seconds each, one after the other, against a delay of 20 seconds. They are now read at the same time with a delay of 60 seconds, and if UniFi still does not answer, MynetworK stays read with its inventory and the test says « UniFi indisponible ».
- Settings, Connectors: a connector read only by the light reading (Beszel) said « not read yet, next collection at … » after every collection, because the full collection never lists it. Its state now comes from the light reading (every 5 minutes).
- Turning a connector on waits for a connection test that can last up to a minute with a slow source: the switch now shows « Testing the connection… » and is disabled until the answer, instead of looking frozen.
- The message after an action that failed now opens in a window over the page, wherever you are on it, and stays as a red line under the form once closed. For a connector that cannot be turned on because its test failed, the message is in the connector's own card (it used to be at the very bottom of the page) and the window carries the « Turn on anyway » button.
- A connector turned off could not be turned on again while its source did not answer: the safety test before the collection failed and the switch stayed off. The message now offers « Turn on anyway (without a test) ».
- Warnings about a connector (home, machines, services…) waited for the next full collection (15 minutes) to go away after the source was back. A newer light reading (every 5 minutes) that read the source fine now clears them.
- MynetworK was asked too often when the Network tab was open: the UniFi cards were read every 10 seconds (server pause 8 s), and each reading makes MynetworK query the UniFi controller, which could end in « timed out ». They are now read every 30 seconds (server pause 30 s), the live traffic every 20 seconds, and after a failed reading the source is left alone for 2 minutes.

## v0.15.3 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- After an import, the settings are read again without restarting the container (the imported schedules apply at once), and the collection, the watch and the health run one after the other. A restart is still asked for the encryption key, or when the settings file could not be read.

### Fixed

- UniFi device cards (Network tab) showed only text: the page's Content-Security-Policy (`style-src 'self'`) blocked the inline styles the card builds its face plate with. The React front now allows inline styles; scripts stay strict, and the sign-in page stays fully strict.
- Import: the SSH part no longer replaces this installation's own key (`myservices*`) when it differs from the archive's, unless asked with a tick box: the machines that authorized that key refused the new one. The page says which files were kept, and warns when the SSH aliases and the machine list are not imported together.
- Settings, Machines: the machine cards keep one height; the roles are limited to three on one line (long names cut short, the others behind a « +N » with their names in the tooltip), so that the cards stay aligned.
- SSH « key refused » in a Docker install now names the account and the key file the machine's alias really uses (an alias can carry a key of its own, not the app's), and shows that public key to authorize. Before, only the app's own key was suggested, which cannot work for such an alias.

## v0.15.2 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- E-mail: the Profile page warns when e-mail sending is not set up (and links to the setting); the settings test no longer shows the postfix help when your profile has no address (it says so and links to Profile); a full SMTP setup gets its own help with examples (OVH, Gmail, Brevo, Mailgun: server, port, security, account); the profile also warns when the latest sending failed or when there is no address to send to. The import result lists the imported parts, asks for a collection and offers a reload button.

- UniFi cards (Network tab) can now be read straight from the controller, without MynetworK: a UniFi connector set up with a local account (e.g. a Docker controller) gives the ports, speeds, PoE and traffic; secrets are cut. MynetworK stays the first source. An API key (UniFi OS console) cannot give ports, so it is not used for the cards. Not tried on real hardware yet.
- In English, the fixed error messages, connector messages and event labels written by the server are now translated too (a message built with a value in it stays in French for now). A test fails when a new fixed message is added without its English text.

## v0.15.1 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Fail2ban statistics were empty with LogviewR: the week of ban history was asked with a limit above the 1000 LogviewR accepts. The attacked domains were
  never found either, because the log search was filled by Fail2ban's own log; it now looks only in the Nginx Proxy Manager and Apache logs.

### Changed

- README: two screenshots (home page and history tab, names and addresses blurred) and the note that the release notes are in English.
- Clicking at random in the menus and table headers no longer leaves a focus ring or a text selection behind (the keyboard keeps its ring).
- The Fail2ban card and the certificates of the Security page are foldable panels.
- A new SSH key gets its own comment (`myservices@<machine>-<date>`), so two installations are no longer indistinguishable in `authorized_keys`.
- The start guide shows the scheduled tasks at a glance (when each runs, and why one is off).
- The backup scan also reads `/etc/cron.hourly|daily|weekly|monthly`, `/etc/anacrontab` and the account's systemd timers.
- **Security page, access to MyServices** (admins only, new sub-tab and part of "To handle first"): the accounts, the API and MCP tokens and the agents with when each
  was last used, and a flag for an account never used after a month or silent for 90 days, a token that is expired but not revoked, never used or unused for 90 days,
  and an agent that went silent, was never installed, or whose host name changed. The most banned Fail2ban addresses now show their country and the owner's
  name (read from LogviewR, cleaned of anything but plain text).
- **AI model to service**: on a machine's sheet, the AI model read by GpuViewR links to the service it runs in (the service of that machine on the model's port,
  else the one named after its runtime, also when it is declared in NPM), which opens the machine's services. vLLM, LocalAI and KoboldCpp join the
  recognised AI applications (Ollama, llama.cpp, LM Studio and Open WebUI already were).
- **Two new alerts**: "Image to update" (a container whose image has a newer version, read from Dockhand, Dozzle, Portainer…: one event per container, the first reading is the
  reference) and "Jail going up" (a Fail2ban jail with at least 20 bans in 24 hours and 3 times its usual daily number, from the LogviewR statistics). Both
  can be picked in the alert rules; by default they join "Connectors and collection" and "Security and DNS".
- Reads of the API that run at the same time share one network call (two panels of one screen loading the same data); a write empties them.
- Home page: the attention card is sorted into categories (machines, services, health, DNS, backups, connectors), the categories with red points first and
  the red lines before the orange ones in each; a click on a category header folds it (kept in the browser).

## v0.15.0 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Security overview: a threat card (« one address attacks several services ») now names the domains those addresses went after (searched in the web logs LogviewR reads, at most 6 extra searches per reading). In the Fail2ban tab the jail, domain and address panels start folded; the choice of each visitor is remembered.
- Security, Fail2ban: « By jail » and « Targeted domains » now sit side by side, each with a list / pie chart switch (like MynetworK's analytics). Security overview: one tile per area (points to handle, a fact, a click opens the sub-tab).
- Security, Fail2ban: a « Biggest logs » table from LogviewR (`log_list_files`: size and date only, never the content), largest first, over 1 GB flagged. Older LogviewR versions without the tool simply show nothing.
- Machine sheet: a « Biggest logs » row (files over 10 MB under `/var/log`, and the systemd journal size), read over SSH or by the Linux agent with the same read-only command; sizes over 1 GB are flagged.

- **Import and export of the configuration** (Settings -> Backup and info): export everything or pick the parts (settings and connectors, machines and
  services, followed backups, remembered decisions, accounts and history (the database, without current sign-ins), encryption key, SSH keys) as a standard **ZIP**; import a ZIP (or an older `.tar.gz`) in two steps, a preview that reads it without changing anything (parts,
  problems, whether the passwords of its settings open with the key that will be in place), then the parts you tick. Both ask for your password.
  The archive is checked before anything is written (no path outside `config/`, no link, size limits, valid JSON and key), a replaced file is kept
  as `<name>.avant-import`, and importing settings or the key asks for a restart. New routes `GET /system/config-parts`, `POST /system/export`
  (now takes `parts`), `POST /system/import/preview` and `POST /system/import`.

- **E-mail in one field**: Settings -> E-mail asks only for the host's mail relay (postfix, sendmail, exim… reached on port 25, the container's gateway is
  suggested); the sender and the page address are worked out, and the full SMTP form stays under "Advanced settings". Readable errors when the relay
  refuses or does not answer, and a help block with copyable commands (check, install postfix, allow or relay) that opens by itself after a failure.
  "Test" tries what is typed before anything is saved. The profile has a "Send a test e-mail" button for admins. The Export and Import cards are
  folded by default, and the Information card is regrouped (application, access and security, storage).
- Import: the parts that need the encryption key are flagged, and importing the key alone (which would lock the current passwords out) is refused.

- **Security page, redone** (public: the Security tab is no longer reserved to development builds; it replaces the former page): an overview that lists what needs a look,
  worst first, each with its source and what to do, then one sub-tab per category (Fail2ban, exposed sites, SSH access, network ports, certificates),
  each tab showing how many points it holds. The Fail2ban tab has statistics: bans per hour (24 h) and per day (7 days), per jail, the addresses banned
  most and those that came back, failed logins behind the bans, and **the domains attacked** (LogviewR's log search ties an address to the NPM host or
  Apache vhost it went after; only that field is used, never the log text). The LogviewR connector now reads 7 days of ban history and sends the
  aggregates only. Fail2ban's own words are kept ("jail", not translated). Tables are striped and the aligned columns are rebalanced.

### Changed

- **Home page**: the counters column is wider and gains four groups, Network (UniFi equipment online or offline, Diagnostic findings to fix or to check),
  Connectors and agents, Virtualisation (guests running or stopped, nodes down) and Updates and certificates (machines to update or restart, certificates
  expiring soon or invalid). The left side keeps the attention card and a redesigned **last 24 hours** card (an hour by hour chart, one row per kind of
  event with the machines concerned and when it last happened). The four per-tab paragraphs that repeated the counters are gone; the facts no counter
  tells (restart requested, orphan AdGuard rewrites) moved into the attention card.
- Card headers: a click on the header of a foldable card opens or closes it, except on a link, button or field placed in it (`lib/foldHeader.ts`); the
  long lists of the Security page are foldable panels (`FoldPanel`).
- Informative texts (the explanation under a title, the hint under a field, a caution) now share one look: an icon in front and a tinted band with a coloured
  edge (`InfoNote`), so they read apart from the page's own data.
- Settings -> Tasks and schedules redesigned: a header with the scheduler heartbeat and a live summary, three grouped cards with dark title bands
  (collection and watching, network discovery, backups and health), a state badge per task, a shorter "Run" button, and a help window with suggested
  schedules (what each task costs the network and the machines' logs).
- **New default schedules** (installations that saved their own keep them): collection every 15 minutes (was twice an hour), watcher 5 minutes after,
  health every 2 hours (was 6), backups checked 4 times a day (was 2); the "data is late" threshold drops from 75 to 45 minutes. `install.sh` follows.
- Header: one text per scan (the orb from the medium width up, the bar below), titled by scan type (collection or network search).
- A box or a gateway (Freebox, router) is no longer reported as "without SSH" or "SSH refused": it has its own state, "Network equipment" (home page, counters, machine window).
- UniFi cards: the "See an example" button is gone, and the badge next to the title says what happens (MynetworK, unavailable with the reason in its tooltip, or unreadable) instead of "no source".
- Network tab: the sub-menu is now at the top and the counters show on the first sub-page only.
- Settings: Discovery is first in the Monitoring group and Notifications last.
- SonarCloud cleanup of the 0.14.0 code (diagnostic and statistics functions split, no nested ternaries, read-only props).

## v0.14.0 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Network tab is public** (it was shown on development builds only), with a sub-menu: an overview (stats, network scan, UniFi cards) and the list of
  equipment, clients and devices with its search bar and filters.
- Network tab: **UniFi front-panel cards** for switches, gateways and access points (ports, link speed, PoE, live traffic LEDs, uplink
  selector, hardware view), built on the MIT-licensed [unifi-device-card](https://github.com/bluenazgul/unifi-device-card) through MynetworK's
  `/api/plugins/unifi/card-devices` (MynetworK 0.11.1+). The cards can be reordered by drag and drop and resized with the mouse (width, height, both);
  the layout is kept in the browser. The frame can be folded, and a sample preview shows the cards when no source answers.
- Network tab: a **"Network scan"** frame read through MynetworK: counters (its own from 0.11.2, else counted from its inventory), addresses offline
  with their last reading, worst latencies, and the data volume per client (live in bits per second with a download / upload arrow, today, all time;
  from MynetworK 0.11.2). Foldable.
- While a collection or a network search runs: the progress bar at the top has flowing stripes and a pulsing head, and a **searching orb** (the MIT-licensed
  [thinking-orbs](https://libraries.dev/orbs.html) package, loaded only when something runs) sits in the middle of the header with the current step.
- Network tab, **Diagnostic** sub-page: ports that negotiated below their maximum (from the port type: 100 Mb/s, 1, 2.5, 10 Gb/s; two UniFi devices linked
  together are judged at the slower end), a device or a WAN link down, firmware updates, overloaded or hot devices, devices restarted a few minutes ago,
  an access point linked by radio, weak Wi-Fi signals, an address seen with two MAC addresses, high latencies. The machines' own network cards are checked
  too (half duplex, forced speed, card negotiating below what it can do or differently from its switch port): read over SSH (sysfs, `ethtool` when
  installed) and by the Windows agent (`Get-NetAdapter`, read-only).
- Diagnostic: an admin can mark a finding as normal (check mark on its row); it is remembered server side (`diagnostic-accepted.json` in the state
  folder), leaves the counters, and can be shown again from "Show the accepted findings". A followed machine whose card, or whose switch port, runs at
  100 Mb/s or less is reported even when its maximum is unknown (connected objects are left alone).
- Settings: Discovery is first in the Monitoring group and Notifications last. `scripts/release.py` now writes the release notes' title and date in English.
- An address-sheet and Beszel-status overlay on the Machines tab, and the pulse follow-ups of 0.13.0.

### Fixed

- Settings -> Updates: the "latest published" version was older than the installed one when a tag had no GitHub release; the highest tag now stands
  in, and an answer kept older than the installed version is checked again at once.

## v0.13.0 (2026-10-18)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Machines tab, health: a notice with messages behind it (kernel errors) shows them in its tooltip, and a click on its badge opens the machine
  window at the right row, which flashes. Kernel errors have their own block in the window (time and message in a log, copy button, "Ignore" until
  a more recent message appears, kept in the browser only). The kernel window is 12 h (it was 24 h) and the 8 most recent lines are kept (the oldest were).
- Machines tab: a coloured dot on the machine icon (red, yellow, blue) follows its worst notice; the warning badge of the tab is now a button that
  filters the table on the machines with a notice (new "Alerts" filter).
- Machines table: a **GPU** column (only when some machine has one): name, load, temperature, memory, power, last 24 h and AI models from GpuViewR
  in a tooltip; without GpuViewR, the adapters read by `lspci` over SSH (Linux, Proxmox; integrated graphics included, virtual adapters skipped)
  or the names listed by the Windows agent. A **VM** cube beside the name of a virtual machine. The **Uptime** column is compact (`12j 4h`) and
  Home Assistant now has one (from its last boot time).
- Machine window of a UniFi device, like the Freebox's (reading, UniFi info, firmware in Updates); a Docker container list with service logos;
  the "Services" and "N NPM" counts open the Services tab already filtered.
- Machine window of Home Assistant (advanced mode): its backups with where each is copied, apps (running, stopped), integrations (failing ones),
  configuration check and repairs, and its updates by kind (Home Assistant, apps, HACS and others).
- Machine window of a box, NAS or server that receives copies: a **Share** section (copies hosted, free space, age of each copy), in console style.
- Backups tab: a summary card (sets OK, late, critical, without copy outside the machine, source volume, free space of the storage machines,
  where the copies go, time of the reading).

- Backups: **Synology Hyper Backup** tasks can be followed (Settings -> Backups -> Synology, with the account of the Synology DSM connector, read-only):
  last run, result, next run, volume usage; a failed or interrupted run is critical, a cloud or remote target counts as a copy outside the machine.
  Tested against a fake DSM only; to confirm on a real NAS.
- README (EN, FR): how to follow the backups of a box or NAS, either through a share mounted on the host and read **read-only** by the container
  (one compose volume line, `compose.yaml` shows it commented) or with an account typed in the page (FTP, FTPS, Samba).

- **Live checks**: a pulse pings every followed machine every 30 s (2 in a row to confirm, so one lost packet is not an outage) and writes
  `pulse.json`; the page reads it every 15 s and the watcher takes the machine up / down events from it, started at once (they used to wait for
  the next collection, 35 to 65 minutes). The health of a machine that moved is read again alone, and so is the health of a machine that
  answers the ping while its health says "unreachable". A **fast connector tier** reads MynetworK (devices, ports, date of their last scan; the
  address sheet when MynetworK 0.10.74+ allows it), Proxmox by API and the Beszel status every 5 minutes into `live.json`. Settings -> Tasks
  and schedules has a "Live checks" row (pulse period, pulses to confirm, fast connectors period; 0 turns a tier off). The watcher runs right
  after each collection and never counts the same collection twice.
- Proxmox: a strip under each node with the load, I/O wait, swap, system disk, kernel, CPU model and guests allocation; the CPU temperature
  and the fans when `lm-sensors` answers on the host (SSH only). The same figures without temperature for hosts read with an API token. The
  Proxmox version is in the machine window. The Virtualisation tab has a "Hide stopped" toggle and greys the stopped guests.
- Machine window, from MynetworK's address sheet: where UniFi sees the address plugged (switch and port, or Wi-Fi access point), its name in
  UniFi, the Freebox lease and port redirections; the UniFi clients list keeps the switch name and IP. Our own agent is listed as a source of
  the machine it reports for.

### Changed

- Backups: the observed rhythm of a folder is read on its 8 most recent runs and the last 120 days only (a forgotten old file no longer stretches
  it to months); the settings page also advises to tighten a threshold that is much looser than the rhythm.
- DNS: the AdGuard sync state is judged at the time of the collection, not against the clock of the browser (it showed "sync late" a few minutes
  after each collection although the sync ran every 5 minutes).
- Services tab: the columns are "Domain" and "Service" (they were swapped in meaning), the service logos are bigger, the rows are striped and
  lower, and the machine groups are open when you arrive with a filter. Machines, Services and Backups tables are striped; the local backup
  folders frame is a foldable table (folded at start); the search and filters of Backups sit in the stats frame on one line (they fold behind
  the Filters button beyond 10 chips or when too wide), and the History hide toggles are on the search line.
- The settings icon is now a set of sliders everywhere; the "to watch" level badge is outline only; tooltips have a dark heading strip like the card
  headers; the Infra, Network and Security tabs are shown only on development builds until they are finished.

### Fixed

- MynetworK: the open ports were all dropped (the scanner now sends them as `{port, protocol}`); they are read again, with the date of their
  last scan.
- A machine marked "often off" that Beszel sees up is read from Beszel, and a machine no longer read loses its stale "unreachable" health row;
  the Beszel badge follows its current status instead of the one of the last full collection.

## v0.12.0 (2026-10-17)

> **Still in development: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- The Health tab is gone: machine health (level, CPU, memory, disks, updates flag) lives in the **Machines** tab and a summary stays on the
  home page, whose links now open Machines (with the health filter). The service and container cards that sat under the Health table have
  their own **Infra** tab.
- Machines: a click on a row opens the details in a window (width follows the administrator's setting) instead of unfolding it; settings
  (identity, options, access with SSH, agent and connectors) open in a window with tabs, from Settings -> Machines or from the gear of the
  Machines table (administrators). The "SSH & Agents" sub-tab is merged into that window. The Sources column lists every source in its tooltip.

### Added

- Linux agent: a Python 3 script (3.6+) and a `install.sh` installer (systemd timer, dedicated read-only account). It runs the same
  commands as the SSH collectors and the server replays the outputs through the existing parsers, so there is no second set of rules.
  Settings -> Agents lets you pick Windows or Linux when creating an agent and shows the matching one-line command; Linux machines
  with no SSH and no API are now offered in "Without agent". Each agent type has its own version, checksum and update path.

- Home Assistant connector, optional advanced mode: paste the address of the community **ha-mcp** add-on (not Home Assistant's native MCP)
  to read the real list of backups (date, size, encrypted, where each is copied: a backup copied elsewhere is now observed, not
  assumed), Repairs, the configuration check, add-ons and failing integrations. Six fixed read calls only, a guard test forbids any
  write action; the mixed tools are only ever called with `action = list`.

- Setup assistant at `#assistant` (administrators): six steps, one decision at a time, each one skippable and revisitable, with a summary at
  the end and a banner on the home page until it is finished. 1 Welcome, 2 This machine (read without SSH), 3 The network (search and a
  short list of machines worth following; cameras and other ping-only devices are not listed and can be added later from Settings ->
  Discovery), 4 Read each machine (the recommended method, why, and what to do; machines to finish first, then those to optimize, then those
  already in place; "That is enough" keeps the current method), 5 Connect your tools (recognized tools not yet connected), 6 Get notified (an
  alert channel with a test message). Nothing is changed on your machines. The progress is kept on the server (`GET` and `PUT
  /api/v1/assistant`), so you can resume from another browser.
- Reading method recommendation for each machine, shared by the assistant: SSH for a Linux machine you administer, an agent where SSH is
  not possible (Windows or Linux), the connector for a box, a gateway or Home Assistant OS (never an agent), ping only otherwise.
  "To optimize" appears only when the recommended method gathers more than what already reads the machine. `GET /api/v1/machines/advice`
  (administrators).
- Every setting opened from the assistant (SSH access, agent installation, connector, alert channel, adding a machine) opens in a window, so
  you never leave the page. The windows reuse the existing forms; the agent installation is now one component shared with Settings -> Agents.

### Added (late in 0.12.0)

- Machine window of a UniFi device, like the Freebox's: model photo and kind, UniFi OS and UniFi Network versions, a "Reading" section (read by
  MynetworK through the UniFi API, address, MAC, state), an "UniFi info" section (clients, devices by kind, wired / Wi-Fi clients, Wi-Fi
  networks) and the firmware in the Updates section. Shown only for a device read through UniFi alone (no SSH, no agent).
- Machine window: the Docker containers behind the services of a machine, each with its service logo, name, image and state; the
  "Services" and "N NPM" counts open the Services tab filtered on that machine (and on NPM).
- Settings -> Machines: the "Machine access" guide opens from an info button under the title.

### Changed (late in 0.12.0)

- The Infra, Network and Security tabs are shown only on development builds until they are finished.
- Card header strips are dark on the Machines cards and on the Settings -> Machines cards; the settings icon moved to the bottom right.

### Changed

- Machines page and Settings -> Machines: the "State" column is now "Sources", one short badge per source that reads the machine
  (SSH, agent, each connector), green when it works and another colour when it does not, with an explaining tooltip. The SSH
  connection column is gone from the table (the detail keeps it), and the folded settings card no longer shows the SSH details.
- Settings -> Agents explains when to use SSH, an agent or a connector; boxes and gateways (Freebox, UniFi) are never offered an agent,
  and a connector badge opens that connector's card, highlighted.
- The "Machine followed" and "Often off" switches sit at the top of a machine's settings card and are never greyed out. A SSH security
  notice (root login or password allowed) is now a blue shield badge saying what is allowed, not an orange "sshd" badge that looked like a fault.
- Dialog windows now have a nearly opaque blurred backdrop and open near the top of the page.
- The setup assistant replaces the "Premiers pas" card on the home page and the old `#setup` installation page (the old address redirects to
  the assistant). On a fresh install, with no other machine followed and the assistant never used, it opens by itself once per browser
  session; otherwise a banner on the home page offers it until it is finished or closed. "Review the setup assistant" (account menu and
  Settings -> Discovery) restarts it from the first step. The automatic mode switch stays in Settings -> Discovery.

## v0.11.13 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Connector cards: « Test », « Edit » and « Delete » are icon buttons with an explaining tooltip (also read by screen readers);
  the test shows a spinner while it runs.
- Settings → Machines: « Remove » is an icon button with an explaining tooltip.
- Discovery: « Apps to link » becomes « Apps to switch on », like the « Switch on » button of every tile (it said « Configure »);
  « Machines found on the network » becomes « Machines on the network ».
- Discovery: « Search again » sits next to « Search settings »; the header shows the automatic mode and what is left to do as two short lists.
- Discovery: the network search (frequency, last and next run, its settings) sits at the top of « Machines on the network », which it fills; the header keeps the overall state and the automatic mode.
- One name for the network search everywhere (Discovery, first steps, found machines): « Search now », then « Search again »; « scan » is gone from the texts.
- Discovery: « Apps to link » holds only the apps that run; stopped containers and everything forgotten move to a separate
  « Stopped and forgotten » frame, grouped by category (stopped containers, forgotten apps, other forgotten suggestions).
- Detected apps (Discovery, Connectors): the « running » and « stopped » badges explain themselves in a tooltip (what it means, Docker's state).
- Connectors, « Detected services not set up »: the « optional » badge on every line is replaced by what the service would bring
  (containers, machine health, virtualization, service status…) and « new » (nobody reads that yet) or « already read by SSH,
  Dockhand… » (it would only add to it); the new ones come first.

## v0.11.12 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Nextcloud connector help: real commands to create and set the serverinfo token, in a block with a copy button, for Nextcloud
  without Docker, the official Docker image, All-in-One and linuxserver.io. Any connector help step can now carry a command block.
- Nextcloud help, when the install is known (found by the scan, or the app at the address typed): its exact command comes first,
  with the container's name and the right form for its image, or the site's folder and the owner of `config.php` for an install
  without Docker; the other installs stay folded below.
- Connector forms: « Need help getting this access? » is folded by default, also when adding; one click opens it.
- Command blocks (SSH key, connector help…): the copy button is an icon inside the block, top right; the command gets the whole width.
- Security (code scanning): SVG avatars are read with `defusedxml` (no DTD, entity or outside file); saving a connector whose test
  fails no longer puts the error text in its answer, the page asks the test route for the reason.
- SonarCloud: tests for mail sending and the mail routes; simpler connector functions (Arcane, Pulse, Netdata, Dozzle); e-mail
  addresses checked without a regular expression; the bell panel is a `<dialog>`, menu separators are `<hr>`.

## v0.11.11 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Forgotten password by e-mail**: a « Forgot your password? » link on the sign-in page sends a one-time link, valid 30 minutes,
  to the address of the account (by its name or its address; the answer is the same whether the account exists or not, and
  requests are limited). The link opens « choose a new password » with the usual rules; every session of the account is closed.
  Only a hash of the link is kept.
- **E-mail address** in Profile, used only for that link.
- **Avatar** in Profile: PNG, JPEG, WebP, GIF (animated kept) or SVG, 512 KB at most, shown in the header, the account menu and
  Profile. A photo is cropped square and shrunk to 256 px in the browser (its EXIF data goes). An SVG is kept only when it is
  plain drawing (no script, entity, `on…` attribute or outside link) and is served with a sandbox policy; formats are recognised
  by their content, never by the name.
- **Settings → System → E-mail**: SMTP server (STARTTLS, SSL or none), account, password (encrypted at rest), sender and the page
  address put in the links (never taken from the request), with « Send a test e-mail » to one's own address.
- Beszel connector: « Verify HTTPS certificate » setting (on by default), to reach a hub behind a self-signed certificate.
- Arcane connector is now a container source, like Dockhand and Dozzle: each environment with its containers (running, stopped,
  unhealthy) and image updates, matched to its machine; an offline environment is flagged « offline » on the card.
- Glances connector also reads the machine it runs on for the Health tab (processor, memory, load, real disks, hottest core): a
  machine without SSH, agent or Beszel gets a health reading « read by Glances ». A Glances in a container names a disk after its device.
- Portainer connector is now a container source too (environments online or not, containers running, stopped, unhealthy), from the
  snapshot Portainer already keeps: one call, nothing per container.
- Beszel connector reads more of what its agents send: running containers per machine (health check, image update), every
  temperature sensor and the swap. In the Health tab, a machine read by Beszel gets its Docker part (containers, unhealthy ones,
  busiest, image updates) and its sensors on the temperature badge.
  A machine read by SSH also gets Beszel's sensors on its temperature badge.
- Netdata connector also reads the machine it runs on for the Health tab (processor, memory, load, disks, hottest sensor), all
  current values in one call (`allmetrics`).
- GpuViewR connector: in each machine's detail (Machines tab), its GPUs (model, temperature, load, memory, power, last 24 h) and
  the AI models running (model, runtime, port, idle or busy, memory). With GpuViewR 0.13, machines are matched by the LAN
  addresses its agents send and the 24 h of every GPU come in one call; with an older GpuViewR, by name and one call per GPU.
  GpuViewR's own update is shown when one is out.
- Pulse connector is now a source of the Virtualization tab: Proxmox nodes, VMs and LXC containers with their load (a reading
  Pulse does not have stays empty, never 0), plus what Pulse says needs attention. Not tried against a real Pulse yet.
- The health task reuses a connector result read less than 10 minutes ago (Glances, Home Assistant) instead of calling it again.
- AdGuard Home (API mode), Uptime Kuma and Web-Check connectors: « Verify HTTPS certificate » setting, for a self-signed certificate.
- Connectors: « Save without collection » button, to set up a service that is down or not ready yet: settings kept, no test,
  collection off.

### Changed

- Connectors: the collection is never switched on with untested settings. Saving tests the saved settings first: when the test
  fails, they are kept but the collection stays off, with the reason. Switching the collection on runs the same test and is refused
  when it fails.
- Beszel connector: the account field asks for the e-mail (the hub signs in by e-mail only); a user name gets a clear message.
- Forms: the red « * » (required field) stays on the same line as its label.
- A connector saved from a detected service takes it off every list at once (Connectors' detected services, Discovery's
  « Apps to link », the bell, first steps), without waiting for the next collection.
- Discovery, « Apps to link »: the buttons sit on the card's top line, on the right.
- Account menu (header) redone: initial, name and e-mail at the top, then Profile, Settings, first steps, theme, GitHub, sign out;
  the diagram links are gone (they stay in the Diagrams tab). The account menu and the bell share one dropdown (look, closing).
- Security (code scanning): a connector's internal error no longer shows its exception name on the page (logged in the container
  instead); Settings opens only its own sections from the address (a forged `#settings/constructor` no longer breaks the page).
- Dozzle connector reads its hosts and agents through the API of its page: containers (running, stopped, unhealthy) and image
  updates found by Dozzle, shown like Dockhand's environments (Health card, machine matching, Virtualization). Optional account
  for Dozzle's simple login; without one behind its login, links only as before. « Verify HTTPS certificate » setting.

## v0.11.10 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Freebox through MynetworK: « Active devices » no longer reads « 1/127 » behind another router (the Freebox keeps every device it
  ever saw): it shows the active ones and the rest as history. The fan speed is shown, and the internal disk when it is not active.
- MynetworK 0.10.68+ (read as soon as it answers, nothing changes before): the UniFi system summary
  (`/api/plugins/unifi/system`) gives the gateway its LAN address (it is matched to its machine by that address), its temperature,
  memory size and firmware update, and the versions of UniFi OS and of the UniFi Network application with its update waiting
  (« System » of the gateway; both updates in its updates list and arrow). Only the fields named are kept. The Freebox card shows
  the firmware update it offers (`latest_firmware`, `update_available`).
- Freebox as a machine: a followed machine whose name contains « Freebox » (no SSH) takes the Freebox read by MynetworK, which gives
  no address for it: its health (line up, temperatures), model, line and firmware, and the firmware update it offers. The
  « Freebox Player » is never matched.

### Fixed

- MynetworK: an optional route answering 503 (UniFi not plugged in: `UNIFI_UNAVAILABLE`) is read as « no UniFi » like 403 and 404,
  instead of failing the whole MynetworK reading (scanner and Freebox included).

## v0.11.9 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Settings → Updates (Application group): the version installed and the latest published on GitHub with its notes, « Check
  now », an automatic check (the scheduler asks at most every 6 h, one anonymous request; `update_check`) and the notice in the
  header (`update_header`). The header shows a « vX.Y.Z available » pill that opens this page; its cross hides it for that
  version only.

### Changed

- Machines and Health in card view: compact cards, one more column on wide screens. Each card shows who it is (icon, name, IP,
  state), the system and uptime, a strip of figures (services, CPU, memory, fullest disk) and, for machines, the servers and what to
  watch; a coloured left edge marks a machine to look at. Health cards list the first three problems, the rest under « Details ».

- Home Assistant: the add-ons installed are listed with their icon and version (an update waiting in orange), on its card and in
  the unfolded detail of its machine. Read from the update entities, so no admin right is needed; the icons are read by the server
  with the token (`GET /api/v1/ha/<instance>/addon-icon/<slug>`) and kept a week in the cache.
  Folded, the list shows its first seven icons and « +N » for the others.
- Machines, card view: « Details » unfolds a card on the same full detail as the table (identity, system, access, software, health),
  the card then taking the whole row; both details start with « See its services » (the Services tab filtered on the machine). The
  card of the Home Assistant machine shows its add-on icons and « +N » on its servers line (instead of a lone « - »).
- Machines: the updates waiting have their own « Updates » part in the detail (card or table), the list folded by default: the apt packages with their new
  version on Linux, the Windows updates for a PC with the agent, up to 30 named (the count stays exact beyond). A folded card
  shows an orange arrow with their number (and the reboot sign), names on hover.
- Machines, card view: opening a card closes the one open before.
- Machines and Health tables: CPU, memory and disk are meters of the same width in every row (value, then a thin bar; the memory
  size and the fullest disk next to the value). The services column shows the count and, when some are down, a red count whose
  tooltip lists them with their problem (instead of « · 1 down »).
- Machines table, health column: a machine without health says why, « off » (switched off on purpose), « offline » (no ping) or
  « not followed » (no SSH, agent, Beszel or Home Assistant), or « waiting for its reading » when it has a health source but the
  Health task has not read it yet, instead of « not applicable ».
- Machines seen by one of the tools (MynetworK, UniFi, Beszel, Proxmox…) without SSH: state « via MynetworK » (the tool named)
  instead of « online, no SSH ». A UniFi device relayed by MynetworK (the gateway too, matched as the machine set as gateway)
  gives its health (OK, busy at 90 % CPU or memory, down when not connected), its CPU and memory meters, its uptime, and its model
  and firmware on the card and in « System »; its update waiting is shown when MynetworK passes it on.
- Home: the schedule box lines up (task, time, countdown in columns, soonest first, « in 2 h 58 » past an hour), styled like the
  counters above it; its title opens Tasks and schedules.
- Home Assistant machine: its system is read from Home Assistant (installation method, Core, Supervisor and Operating System
  versions) and shown in « System » and on its card, where it was empty.
- Machines, table view: the « Expand all » button is gone.
- Virtualization: each node is its own section with its gauges (CPU, RAM) on a fixed grid, its storage gauges in aligned columns
  and its own guests under it (a host without nodes, or ESXi datastores, get one section); the totals moved to the title line,
  and a running guest shows its CPU as a gauge like its memory.

### Fixed

- Home Assistant: a HACS card whose update entity starts with « home_assistant_ » (plant…) was taken for Home Assistant itself.
- Health: the machines that are off follow the search like the others (accents and case ignored) and the « System » and « Access »
  filters, instead of disappearing as soon as any filter was on.
- Health: with « Hide the machines without trouble » on and every machine fine, the page said nothing (the table or cards looked
  broken); it now says so, with a « Show them » button.

## v0.11.8 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Dev image header: the release in prod, the git branch and commit it was built from (with the commits since the last tag and
  uncommitted changes) and the planned version. `scripts/git-rev.sh` gives the git state, `scripts/dev.sh --build` passes it.

### Security

- SonarCloud and CodeQL review of the blocker and critical findings. Fixed: the SSH account of a machine found on the network is
  checked with a full match (`$` let a final newline through into the SSH config), the Proxmox VM id of a crontab read through the
  guest agent must be digits and its alias may not start with « - », the UrBackup login marks its MD5 as protocol-only
  (`usedforsecurity=False`). Reviewed and marked `NOSONAR` with the reason: file writes whose path comes from the config or the
  environment (never from a request), the self-signed certificate option chosen per connector, the container listening on all
  interfaces, a same-site redirect, a JSON answer seen as HTML, a slice seen as an index.
- Front: buttons get an explicit `type`, the alert days are sorted as numbers.
- SonarCloud: each analysis now carries the project version, so the Quality Gate judges the code changed since the last release
  instead of the whole project counted as new; the Windows agent (PowerShell) and the old static page are left out of coverage.
  Command-line tools (import, map) marked for the paths their operator types; `scripts/dev.sh` uses `[[`.
- SonarCloud coverage: the React screens (tabs, components) are left out of coverage on purpose, the logic (Python, `front/src/lib`)
  stays measured; new tests for the import command end to end, the Proxmox crontab guards and the commit guard placeholders. Plain
  http to the apps of the LAN is declared once, for the connectors and install tools (rule S5332), instead of 104 findings.

## v0.11.7 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- « Forget » and « Recall » everywhere something is suggested: apps to link and other suggestions in Discovery (forgotten ones
  leave every list for a folded « Forgotten » frame at the bottom, with « Recall »), detected services in Connectors (« Forget »
  next to « Activate », a « Forgotten » line with « Recall »; one choice shared with Discovery), and the machines found on the
  network (« Forget » / « Recall » instead of an eye icon and « Resume »). Replaces « Don't remind me again ».
- Discovery → machines found: « Skip » on a machine whose access is not set becomes « Forget », kept on the server (no longer in
  the browser only): the frame goes away for good, its « SSH key to authorise » reminder too, and « Recall » in « machines already
  added » brings it back. The orange « accesses skipped » banner is gone.
- Discovery → « What runs by itself »: one aligned row per item (icon, what it is, mode, last and next time, button).
- Apps found in Docker over SSH carry their container state (`docker ps -a` lists stopped ones too): a running container wins over
  a stopped one for the same app on a machine, a stopped one is no longer suggested (Discovery shows it folded under « Stopped
  containers »), and the detected services in Connectors have a « State » column (running first, stopped dimmed).
- « What runs by itself » merged into Settings → Tasks and schedules: each task now says what it also finds (collection: services
  and ports, new services, apps to link; network search: network machines; backups: backup cron jobs), and only the searches no
  schedule covers stay in a frame of their own, « By hand or once » (redetect the machines, /home/backup once, other backup
  folders), one clean row each.
- The network search settings left Discovery for good: frequency, networks to search and discreet mode are all on the
  « Network search » row of Settings → Tasks and schedules. Discovery keeps a « Search settings » button to it.
- Discovery: « Apps to link » is a folding frame (open by default).
- Discovery → machines found: the scan summary fits in two lines, the scan and what changed since the one before, then the tags.

### Fixed

- Settings followed a link to another of its sections only when opened: a link from one section to another (Discovery to Tasks
  and schedules) did nothing. It follows the address now.
- Discovery: « Forget » (and « Recall ») now shows at once, without reloading the page. A reload asked while another one was under
  way was dropped, so the page kept the old answer.

## v0.11.6 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Connectors: « Already read over SSH » moved just under « Detected services not set up », folded by default.
- Settings → Discovery redone as one page read from top to bottom, without sub-tabs nor colored frames inside colored frames:
  a header (state in one line, automatic mode switch, network search with its last and next run and « Search now »), « To do »
  when there is something, the machines found on the network (folded), the apps to link as tiles in alphabetical order, other
  suggestions, what runs by itself (folded), and the search settings (frequency, networks, discreet mode) in one frame.
- Settings → Backups: after « Search my machines », each machine is folded, its summary giving the folders found, those already
  followed and those ticked.
- Settings → Backups: each followed backup is folded by default; its title keeps the alert threshold, the « off-machine copy
  required » switch and « Remove », so the common changes need no unfolding.
- Settings → Tasks and schedules redone: one row per task with its icon and what it does, the schedule checked while typing and
  written in plain words (« every hour, at :10, :40 »), a « Next run » column (time and countdown), and « Run now » instead of
  « Run » / « Run again ». The network search is listed too, its frequency editable here (the same setting as Discovery) and
  runnable. The header tells whether the scheduler is alive (like a crontab: last turn under 90 s), how many tasks are active
  and how many failed. The health switch now says « on » or « off ».
- Tasks: the last run of each task is kept in `tasks-last.json` (state folder), so a restart of the container no longer shows
  every task as « not run yet ».

### Fixed

- The server module was loaded twice (once as the started script, once by `import server` in the API): the scheduler ran in one
  copy and the pages read the other, so the tasks page never saw the scheduled runs, and a run started from the page did not share
  the scheduler lock. One module now, under both names. When the scheduler is really stopped, the tasks page says so in a red
  note with what to do (restart the container, then look at the logs).

- Settings → Machines → SSH & Agents: machine icons now use the machine's role and chosen icon, like the Machines tab (the UniFi
  gateway had no logo there).

## v0.11.5 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Connectors for AI services: Hermes Agent (version, gateway and its platforms, no key), Ollama (version, installed and loaded
  models, GPU memory) and llama.cpp (build, model, context, slots); recognized on the machines, with their icons.
- Connector picker: a search field.
- AdGuard Home is a full connector: added from the Connectors page, read by its API (account of its web interface) or over SSH
  (AdGuardHome.yaml), the DNS server address taken from the interface address. The AdGuards a machine already declares are listed
  under « Already read over SSH », with their state and version: nothing to add for them. Hypervisors read over SSH (Proxmox
  by pvesh, ESXi, KVM, Incus, VirtualBox) are listed there too, and the picker says « already read over SSH » on their card.
- Dozzle tagged « Docker · logs ».
- « Detected services not set up » no longer proposes what is already covered: a service read over SSH (Proxmox by pvesh: its
  connector would read the same), a connector whose address is a name served by NPM, and the other Dozzle servers once one is set
  (one Dozzle shows the logs of every host).

### Changed

- « My connectors » sorted alphabetically, like the picker.
- The machine's own SSH (OpenSSH) is no longer proposed in « New services on the machines »: it is followed with the machine.
- Icons drawn only in black (Hermes Agent, Rybbit, Umami, VictoriaMetrics, Wallabag) turn white on the dark theme.

### Fixed

- AdGuard Home read over SSH shows its version (label of its container image).
- Dozzle card shows how many containers got a « logs » link.

### Fixed

- App version on more connector cards: when the API gives none, the version of the container behind the connector address
  (image label, found over SSH) is shown (Web-Check, Dozzle…). Dozzle also reads its version from its own page.
- Dockhand card shows its version, taken from the changelog bundled with each Dockhand build (`/api/changelog`, first entry):
  Dockhand has no version route.
- Dozzle connector card had no state: Dozzle is now checked at each collection (reachable, version).
- A connector not read yet shows when the next collection runs (« next collection at 09:10 (in 4 min) »), or that it is running.

## v0.11.4 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- MynetworK card shows the app version (read from `/api/health`, given since MynetworK 0.10.67).
- LogviewR version was always marked « not tested » (orange): its tested prefix « 0. » never matched. Prefixes ending with a
  dot now match like the others.

## v0.11.3 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Connectors: the « add » picker is sorted alphabetically, with one filter chip per category (Monitoring, Media, Network / DNS,
  Backups…) and its count.
- Home page: « New services on the machines ». Containers and processes that appeared in the last 7 days are proposed:
  Follow (nothing changes, no longer proposed) or Don't follow (paused: no probe, no alert). A paused service shows why in its
  detail in Services, with a « Resume following » button.

### Fixed

- Changes show at once: after any change the page reads its data again, then every 5 seconds for 2 minutes 30 so the collection
  it starts shows up when it ends. The connector list also reads again when a collection ends. No more F5.
- Deleting a connector while its form was open left « Add a connector » greyed out.

## v0.11.2 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Health tab shows only the machines that need a look, under a one-line summary (« 2 machine(s) to look at: nas (disk /data
  91 % full), … » or « 12 machine(s), all healthy »). One click shows the healthy ones too (choice kept in the browser); a search
  or a filter always shows everything it finds.

## v0.11.1 (2026-10-13)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Connectors: editing a connector could send an old token back. Browsers filled the token field with a remembered value;
  secret fields now refuse browser and password manager autofill.
- Connector cards show the app version for every connector that reports one (most status connectors found it but never
  showed it). LogviewR no longer shows « 1.0.0 », the fixed version of its MCP server, and NUT no longer shows the UPS model
  as a version (now a « Model » line).

### Changed

- Editing a connector happens inside its card: no inner blue frame, no second logo and title.

## v0.11.0 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- **Network tab**, shown only when a network source answers: summary tiles; Internet access and gateways (Freebox card and a
  UniFi card: gateway, version, uptime, equipment online, Wi-Fi and wired clients, updates, built from MynetworK alone or from
  the UniFi connector); network equipment; clients per access point or switch; devices of the network. Same search and filters
  as the other tabs (type, state, followed, access point or switch, vendor, source). Freebox and UniFi cards move there from Health.
- Status connectors: Pulse, Arcane, Glances, GpuViewR (its read-only API, `gvk_` token; its favicon as logo), Speedtest Tracker,
  NetAlertX, Wazuh, Umami, Rybbit, Tautulli, Webmin (version only), qBittorrent, Transmission, Bazarr, Overseerr / Jellyseerr;
  Whisparr in the *arr connector.
- Backups shown as status cards: Backrest, borgmatic (over SSH), UrBackup, Veeam Backup for Microsoft 365; Synology Hyper Backup;
  TrueNAS replications and cloud sync. The Windows agent (version 7) reads Veeam Agent and Windows Server Backup.
- Virtualization: Unraid and Proxmox Datacenter Manager connectors; KVM / libvirt, Incus / LXD and VirtualBox read over SSH when
  found on a machine; Hyper-V read by the Windows agent; TrueNAS SCALE VMs and apps; Synology Virtual Machine Manager.
- Known apps: agents (Dozzle, Beszel, Arcane, Hawser, Portainer, Pulse, GpuViewR, Wazuh, Zabbix, Checkmk, Komodo…) have no page
  and never propose a connector; the service sheet says which hub they report to. The Dozzle agent shares the Dozzle image and is
  told apart by its container port. Processes read over SSH are recognized by name. About forty more apps and their icons.
- History: an "Event" filter; fail2ban threats, connectors back within an hour and devices found by the scan are hidden by default
  (kept in the browser, one click shows them); the list groups the threats of a day per jail and the outages of a connector.

### Changed

- Home Assistant card in Health redone: state and core update at the top, gauges of the host machine (System Monitor), entities,
  unavailable entities and automations on, folded lists of low batteries, unavailable entities and updates.
- Saving or switching on a connector runs the collection at once; the page says "being read again" instead of keeping the error
  of the old settings until the next run (a saved token looked refused for up to 30 minutes).
- App categories all exist in the default list (`IA / LLM` and `Sauvegardes` did not).

## v0.10.25 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- UniFi Network connector, two ways in: an API key on a UniFi OS console (UCG, UDM, UX, Cloud Key, UniFi OS Server), or a
  read-only local account on the self-hosted controller (Docker, port 8443), which has no API key. It reports devices online or
  not, devices with a firmware update and the client count. A detected UniFi container proposes the local account mode.
- UniFi clients and devices read by this connector feed the matching layer (IP, MAC), without MynetworK; a machine seen by both
  keeps a single UniFi badge.
- "Freebox (via MynetworK)" card in Health: the MynetworK connector also reads the Freebox it relays (active LAN hosts; line
  state, rates, temperature and uptime once MynetworK serves `/api/connection/summary`). No card when MynetworK has no Freebox.

## v0.10.24 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Icons for the Healthchecks, CrowdSec, Technitium DNS and NUT (UPS) connectors (Settings -> Connectors, Health cards), also
  offered for machines, with Nextcloud.

## v0.10.23 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Alert "Nextcloud to look at": once when a point appears (Nextcloud or app update, public links without password, free space
  under 10 GiB, debug mode), not when its figures change; the first reading is the reference. New example rule "Nextcloud
  (updates, public links, space)".

### Changed

- Health no longer shows the Proxmox, ESXi, vCenter and Proxmox Backup cards: they are in the Virtualization tab. Health keeps
  Dockhand and the services read through their API.

## v0.10.22 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Security tab, replacing the Fail2ban tab (the old #fail2ban link opens it), read only, no exposure score: summary tiles (bans
  over 24 h, active threats, public sites to harden, machines with SSH root or password login, devices with a sensitive port);
  Fail2ban with LogviewR's active threats in detail (one IP across jails, or a campaign from one AS: IPs, jails, bans); sites
  exposed to the Internet (active NPM hosts without an access list) with what is missing (HTTPS not forced, no HSTS, Block
  exploits off, certificate soon expired, weak security headers); certificates (moved here from History -> Availability); SSH
  access of each machine (PermitRootLogin, PasswordAuthentication, refused logins over 24 h); sensitive ports seen by MynetworK.
- Alert "new threat" (LogviewR), once per cluster, the first reading taken as the reference; in the security example rules.
  LogviewR's threats are kept with safe fields only (IPs, jails, numbers, AS number; no whois text).

### Fixed

- sshd values read with "(défaut)" appended ("prohibit-password (défaut)", the safe default) were shown as risky.

## v0.10.21 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- LogviewR: connecting with a token failed with "f2b_get_active_threats : unreadable answer". That tool answers with an
  "UNTRUSTED DATA" notice, then the JSON in a second block; the connector read only the first. It now takes the first block
  that parses as JSON.
- Auto mode: a machine removed by hand in Settings -> Machines came back at the next network search unless the auto mode had
  added it. Removing a machine now also puts it in the ignored list of Settings -> Discovery (one click brings it back).

### Changed

- Settings -> Machines hides the machines whose "Followed machine" switch is off, like the Machines tab; a "Not followed (N)"
  button shows them.

## v0.10.20 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Virtualization tab: Dockhand cards were shown under "Proxmox backups and containers" (and the tab appeared with Dockhand
  alone), meaningless on a setup with a vCenter and no Proxmox. Dockhand manages Docker only: its cards stay in Health. The tab
  shows only with a hypervisor (Proxmox, ESXi, vCenter) or a Proxmox Backup Server; a VM's own Docker containers stay in its row.

## v0.10.19 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Appearance (theme, header logo, language, page width) moved from Settings -> Application to the user profile, so read-only
  accounts can set it too; the old #settings/look link opens the profile. Wider profile page: password and sessions on the
  left, appearance on the right on large screens.

## v0.10.18 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- Check (Settings -> Machines) warned "docker inaccessible ... usermod -aG docker" on VMware ESXi and on hosts without Docker,
  while the collection showed them fine. When SSH works but docker ps fails, the check now asks the host: ESXi is said as such
  (no Docker is normal, its VMs are read by vim-cmd), a host without Docker is fine, and only a refused docker gets the group
  advice. The machine card shows "no Docker" in grey instead of a green tick.
- SSH errors name their cause: connection refused (SSH server off, with where to turn it on for ESXi), host unreachable, too
  many keys tried, no common algorithm, connection closed by the host.

## v0.10.17 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- nextcloud connector, read only, through the monitoring route of the serverinfo app shipped with Nextcloud, with the token of
  that app (`occ config:app:set serverinfo token --value <token>`, sent as NC-Token): no account is given to MyServices. Status
  card in Health: version and the newer one, active users over 24 h, files, free space, database, PHP, apps and their updates,
  public links. To look at: Nextcloud or app updates, public links without password, free space under 10 GiB, debug mode. A
  Nextcloud container found on a machine proposes the connector. Tested against a fake server only.

## v0.10.16 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed

- VMware ESXi refused the app's SSH key even at the right place: ESXi 8 runs sshd in FIPS mode and refuses ed25519 keys. The app
  now also has an ECDSA P-256 key (created once at start-up), offered after the ed25519 one by every SSH alias it writes (older
  aliases updated at start-up, others untouched). The command to authorize the key for root puts the ECDSA key in
  /etc/ssh/keys-root/authorized_keys on ESXi; Settings -> SSH key shows it too.

## v0.10.15 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- History tab, Availability view (switch Events / Availability, choice kept): uptime of each service (backend answers),
  followed machine (ping) and Uptime Kuma monitor, sampled at each collection; 24 h, 7, 30 or 90 days, one coloured cell per
  hour or per day, mean response time, worst first, filters by type, uptime band and machine, average per type. Below, the
  certificates read by Web-Check and Uptime Kuma, closest to expiry first. Things off on purpose (disabled, paused, machine
  off, Kuma maintenance) are not counted as downtime; a service whose machine is down is counted once, on the machine.
- availability.py and GET /api/v1/availability?days=N: samples kept 14 days, a daily roll-up kept a year, older rows purged at
  each collection.

### Changed

- Machines table: the badges of the tools that see a machine are no longer in the folded Machine column (there can be many);
  they stay in the unfolded detail ("Seen by").

### Fixed

- The command to authorize the app's key for root now works on VMware ESXi: ESXi ignores ~/.ssh/authorized_keys and reads
  /etc/ssh/keys-root/authorized_keys. The single command detects ESXi, writes there without touching the file's mode (what keeps
  it across reboots) and saves it at once with auto-backup.sh; elsewhere it writes /root/.ssh as before.

## v0.10.14 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Virtualization tab (shown when a hypervisor or Dockhand is there): each host with its CPU, memory and storages, and a table of
  its VMs and containers: state, resources, uptime, the followed machine they are, the age of their followed vzdump backup and
  their Docker containers (SSH count, Dockhand environment and pending image updates). Proxmox Backup Server and Dockhand cards
  below.
- Proxmox VE read by SSH (pvesh, read only) at each collection, without an API token; a host already read by the proxmox
  connector is left to it.
- VMware ESXi read by SSH (vim-cmd and esxcli, read only): host CPU and memory, datastores, each VM with its guest OS and the IP
  and hostname given by VMware Tools. Its health skips the Linux checks. The SSH guide gives the command for root's key on ESXi.
- vcenter connector (REST API, Read-only account; vCenter 7 U2+ and the older /rest API of 6.7 / 7.0): hosts, VMs per host,
  guest identity, datastores. The session is closed after each reading. An ESXi already listed by a vCenter is not read twice.
- Backups: Proxmox VE dumps (vzdump without Proxmox Backup Server) followed per VM or container, in Settings -> Backups. The
  dump folders of the backup storages are found by SSH; .log and .notes files are left aside; a dump on a network storage
  counts as off the machine; copies made by rsync to a NAS are declared or found with "Find the copies".
- Machines tab: a Follow button on each device seen by MynetworK and not followed; the detail shows its open ports, first and
  last sighting and ping.
- Alerts: "new device on the network" (MynetworK, keyed by MAC, the first reading taken as the reference), "VM or container
  stopped" / started again and "storage nearly full" (90 %), confirmed on two runs. Added to the inventory and offline
  example rules of new installs.
- Icons: VMware ESXi, vCenter, Free, Freebox, Western Digital, a NAS icon (instead of a plain drive), Plex redrawn.

### Fixed

- Settings -> Machines: a role tag added or removed showed again the old tags after closing the card or changing tab, until the
  next collection or a page reload. The server now publishes the name and tags at once and the page re-reads them.

## v0.10.13 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added

- Auto mode (on by default), one switch in Settings -> Discovery and at the end of the first steps: after each network search,
  machines worth following (SSH, recognised app or useful service) are added by themselves, then collected; SSH turns on by
  itself when the key works. A machine added this way and removed by hand is never added again. Manual mode adds nothing.
  Turning it on also turns the automatic network search and the /home/backup follow-up back on.

### Changed

- SSH access shown as in the first version of the page, on one line: SSH logo, account, IP and port pills (port filled when not
  22). Machines tab column (alias in the unfolded detail), machine card and its SSH frame in Settings -> Machines.
- Machines tab, unfolded detail: each section (identity, system, access, software, health) has its own colour band, tint and
  tinted label column.
- Services and Health, unfolded detail: the same coloured sections as Machines (shared component), the health source in the
  title band.
- Machines, Services and Health: an unfolded row or card gets a full blue frame.
- Settings menu: a category frame glows blue on hover instead of losing its border; the grey card border no longer
  vanishes on hover for frames without a hover colour of their own.
- Machines tab, Servers column: two icons at most, then a "+N" pill; all of them in the unfolded detail.
- Settings -> Machines: a refused save shows its reason next to the field instead of only at the bottom of the card.

### Fixed

- A machine left without any role tag made the collection fail.

## v0.10.12 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed

- Grey border on uncoloured cards on every page (Home, Machines, Services, Health, DNS, History, Fail2ban, Profile), set once
  for the whole app; cards with a coloured status stripe keep their colour.

## v0.10.11 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Task scripts run by hand switch to the app account**: `myservices.py`, `health.py`, `watcher.py` and `backups.py` started with `docker compose exec` (as root since 0.10.6) now drop to the account 10001 like `setup.py` and `manage.py`, so they use the app's SSH configuration and leave no root-owned file in `/data`.
- **Grey border on cards without a colour of their own**, as in Settings, now also on the Diagrams and Backups pages (one shared rule, `GREY_CARDS`).

## v0.10.10 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed
- **SSH switch turned on by itself when the key works**: a machine whose switch was never set, with an access for its address in the SSH configuration and a successful key login during the collection, gets its SSH access saved by itself (log line "SSH activé tout seul…"). Turning the switch off is now kept as an explicit choice (`ssh: false`): the machine is then no longer read over SSH at all (before, the collection kept reading it with the alias found in the SSH configuration), and it is never turned on again by itself.
- **SSH & Agents put a machine read over SSH under "No access: to set"** when its switch was off but the collection still read it (badge "SSH OK"). Groups now follow what the collection really does; the machine page explains that the switch will turn on at the next run, with "Turn on now".

## v0.10.9 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Settings → Connectors**: the form being filled (new connector or edit) has a blue frame, and so does the card being edited; the cards of the "Add a connector" list get a grey border and a darker background for contrast, and the cards of the connectors already set get the same grey border.
- **Settings → Machines**: same look: each machine card has a grey border, and a blue frame while it is open; the forms to add machines have the blue frame of the connector form. The frames inside a machine (SSH access, identity, option groups) and the cards of SSH & Agents get the same grey border; the card being opened is framed in blue.
- **Settings → Machines → SSH & Agents**: empty categories are no longer shown.
- **Settings, every page**: each card or frame without a colour of its own (neutral border) now has the same grey border, for contrast; coloured ones (ok, warning, error, blue) are unchanged, and the hover colour still applies.

## v0.10.8 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Fixed
- **"Authorize the key" command** (Getting started, Discovery, Settings -> Machines, adding a machine): it now targets the real folder of the chosen account (`/root/.ssh` or `/home/<account>/.ssh`), creates `.ssh` when missing, adds the key only once, and gives `.ssh` back to the account with modes 700 / 600. It can be run as root for another account: before, a key written by root was left owned by root, and sshd refused it.
- **Settings → Machines → SSH & Agents**: a machine already read by a connector's API (Home Assistant…) is no longer listed under "No access: to set" with an SSH warning; it has its own group, "Read by their API, without SSH". Every card now shows the same access badge as the Machines tab (SSH OK, Agent active, API, SSH refused, online without SSH…).
- **Settings → Connectors, "Detected services not configured"**: now a folded frame, marked optional (blue, not orange), like the suggestions of the Discovery page: open it when you want to link those apps.

## v0.10.7 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Settings → Logs** (Application group, before Help): what the container prints (the same text as `docker compose logs myservices`): the server and the output of each task, since the container started, last 3000 lines. Filter by origin (server, collection, watch, health, backups), errors and warnings only, text search; follows new lines every 5 s (pause on scroll), download as `.txt`. Route `GET /api/v1/system/logs?after=N` (admin). `applog.py` keeps the lines in memory; nothing is written to disk.
- **Eye on secret fields** (passwords, tokens of connectors, also when opened from a machine; NPM script and Veeam passwords): shows what is typed. For a value already saved (never sent to the page), the eye asks the account password, then fetches it: `POST /api/v1/connectors/settings/{type}/{name}/reveal` (admin session, password checked with the same failure limit as sign-in, recorded as "secret affiché" in the audit log).

### Fixed
- **Network search found 0 device on some hosts**: where unprivileged ping is turned off (`net.ipv4.ping_group_range` = `1 0`, the kernel default kept by some NAS and distributions), ping was refused to the app and every address looked down, with no message. The app now keeps `NET_RAW` alone (and nothing else) when the compose gives it: add `NET_RAW` to `cap_add` (done in `deploy/compose.example.yaml`). Without it, the search now says why instead of showing 0 device.

## v0.10.6 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **No more exited `init` container**: the image now has an entrypoint (`deploy/entrypoint.sh`). Started as root (`user: "0:0"` in the example compose), it gives `/config` and `/data` to the account 10001, locks `/config` (700 / 600), then runs the app as 10001 through `setpriv`, with no capability left. The example compose drops the `init` (busybox) service and adds only `CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID` for that start. `setup.py` and `manage.py` run through `docker compose exec` switch to 10001 the same way, so what they write stays readable by the app. **To update an existing install**: remove the `init` service and its `depends_on`, add `user: "0:0"` and the `cap_add` line from `deploy/compose.example.yaml`, then `docker compose up -d --remove-orphans`. An unchanged compose keeps working (the image still defaults to 10001).
- **Example compose rewritten** (`deploy/compose.example.yaml`): English only, one service, shorter comments, the test-phase warning on top, and the `MYSERVICES_NETSCAN_EVERY` setting listed.

## v0.10.5 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Discovery page (Settings → Discovery)**: what is needed is now kept apart from what is optional. "To do" only lists what MyServices needs to see everything (a refused SSH key, an agent never installed, a late collection); connectors to link, hosts found but not followed and backup folders never searched become "Suggestions (optional)", shown as compact rows; automatic items are folded at the bottom. A one-line summary sits at the top, and family tabs show the to-do count in orange or the suggestion count in blue. The API returns a `suggest` count next to `todo`.
- **Header bell**: opens a panel listing what is still to do, each with its button, then the number of optional suggestions and a link to the Discovery page. Its badge only counts what is needed; the bell turns grey when only suggestions are left.
- **First network scan is automatic**: it starts within a minute of startup, then every `netscan_every` hours (0 still turns it off). A try without a result (no local network found) waits for the interval instead of retrying every minute.
- No em dash left in the interface or the code; empty values show "-".

### Fixed
- **"Run the search" on the network discovery did nothing** when the Discovery page was already open: it now launches the scan (the same route as the scan card), then scrolls to that card, highlights it and shows the scan running.

## v0.10.4 (2026-10-12)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Added
- **Backups, "copied elsewhere"**: a followed folder can now be given its copies from the page (Settings → Backups → each set → "Add a copy": machine, then folder typed or picked from the search). MyServices compares each copy with the source at every run, as it already did for hand-written sets. "Find the copies" looks on every machine read by SSH, **network shares (NAS in CIFS / NFS) included**, for the last five archives of each followed folder and proposes where they are copied, in one click ("Link"); nothing is linked on its own. A copy on a network share counts as off-machine even when it is seen from the machine that makes the backup. A copy on another machine turns "off-machine copy required" on; removing the last one turns it off.
- **Backups, custom alert threshold**: besides 2 / 8 / 15 / 31 days, an "other…" pill takes any value from 0.1 to 365 days (Enter or leaving the field saves it).
- **Settings → Backups**: each followed set and each machine of the folder search has a darker title strip with the machine's system or app icon; the folder is no longer repeated under a name that already says it.
- **Backups, observed rhythm**: when archives arrive about every N days and the alert threshold is shorter, the set shows "observed rhythm ~N d: switch to X d" (one click).
- **One dev launcher (`scripts/dev.sh`, or `npm run dev:all`)**: starts the backend container if needed, waits for it, then the front with hot reload; Ctrl+C stops both (`--keep` leaves the backend, `--build` rebuilds the image first, `--stop` stops it). Local settings in `.dev.env` (ignored by git).

### Added
- **Matching layer (`matching.py`)**: each collection ties a machine to what the other tools say about it: MynetworK and UniFi (by IP, then MAC when the IP changed), Beszel, Proxmox VE nodes and guests, Proxmox Backup and Dockhand environments (by address, or by short name when exactly one machine has it, flagged as weaker). Each machine of `data.json` gets `links` (MAC, vendor, other names, one entry per tool with how it was matched, the Proxmox guest or node); `unlinked` lists what the tools see but MyServices does not follow. Beszel is read from the connectors' last result: no extra call. 12 tests.
- **Machines tab**: one badge per tool that sees the machine, under its name and in its detail ("Seen by", dashed when matched by name only), its other names and its Proxmox VM / node. The "Seen by MynetworK, not followed here" box becomes "Seen by your tools, not followed here", grouped by tool (MynetworK, Proxmox, Dockhand, Beszel).

## v0.10.3 (2026-10-11)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **Getting started is now a standalone full-size page (`/#setup`)**: no tabs or dashboard header, only the steps, a bigger type size and a "Dashboard" link. The home page shows a single "Getting started n/6, Continue" banner instead of the whole card; a fresh install lands on the setup page once per session; "Review the first steps" opens it again.
- **Getting started**: the badges of the network scan summary all share the same dark look.

## v0.10.2 (2026-10-11)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **The app is now at the root of the site: `http://<IP>:8090/`** instead of `http://<IP>:8090/myservices/v2/`. The page, the API (`/api/v1/`, docs at `/api/v1/docs`), the MCP server (`/mcp`), the agent scripts (`/agent/`), the sign-in page, the produced files (`/data.json`, health, backups, events) and the diagrams all sit at the root; the session cookie is set for `/`. The old addresses keep working, so nothing already deployed breaks: **pages and files under `/myservices/…` (including `/myservices/v2/`) redirect to the same address at the root, while API, MCP and agent paths under `/myservices/…` are answered in place** (the path is rewritten before the access checks, so agents already installed on Windows PCs, API tokens and MCP clients keep working untouched and the access rules are the same). The redirect always keeps a single leading slash and refuses backslashes, so `/myservices//evil.com` can never send a visitor to another site (tested). Sign in once again after updating (the cookie path changed). The compiled front is served from `web/v2/` in the image; the Vite dev server now proxies the container's routes at the root.
- **Getting started**: the "Follow my backups" card is titled "My backups" (it fitted on two lines).

### Changed
- **Getting started, after the proposed connectors**: a **folded frame "All available connectors"** (with the count, and a note on how to open and close it) lists every tool MyServices can read with its logo; one click opens its form. It says why it is there (a tool can run on another machine than this one, so nothing recognised here does not mean nothing to link) and that **nothing is mandatory now: it can all be done later in Settings -> Connectors**. The former "Next" button row became a **"What next?" block of four cards** (link my tools, get notified, follow my backups, read the help), each with a line on what it brings, under a reminder that none of it is mandatory.
- **The version shown by an image built from a branch is now meaningful.** The header used to read `docker · 660b74c` for a branch image (the `:docker` tag the example compose pulled), which looked like a wrong version. It now reads **`v0.10.1+ · main · 660b74c`** (the last release written in that build's changelog, `+` = built from the branch after it); an image of a release tag still reads `v0.10.1`, and a local development build is unchanged (`dev`, git state, planned version). `GET /me` and the About page expose `released`. The example compose now pulls **`:latest`** (the last release) instead of the branch image, and the READMEs and compose point to the `main` branch (the `docker` branch is no longer updated); `:main` is the branch image.
- **One "Skip" button everywhere** (Getting started steps, network search, machine cards): a shared bordered pill with an icon, with a lighter variant when it sits on an already dark or tinted area so it stays readable.
- **Less alarming progress text during a collection**: step 6 of 8 no longer reads "2nd try of the failed probes" (which sounded like something was broken). It is a normal confirmation pass that always runs (slow or failed probes are asked again, less in parallel, to avoid false alerts) and now says so; step 5 says "1st pass". The "Skip" buttons of the Getting started steps are bordered pills with an icon, and "Resume" is a pill too.
- **Getting started, "Host machine detected"**: the machine, the number of services found, the apps and Docker (logo and name, no more "present on the host" text) all sit on one line.
- **Sign-in and first admin account page**: an **eye button** on each password field shows or hides what you typed. When the second password differs from the first, the **second field gets a red frame** with the message "The two passwords are not the same" and the matching rule turns red (nothing red while it is still empty). The disabled "Create the admin account" button is now clearly unavailable (flat grey, dashed edge, "not allowed" cursor) with a line saying when it becomes active, and the enabled button is a clear blue with a light shadow.

### Changed
- **"Getting started" card redone** (look and logic): a header strip with a rocket icon, a **progress bar and counter** (steps done out of 6), and a vertical timeline where each step has a round state marker (done, to do now, running, later) and an orange or blue tinted card for the active one. The texts are brought up to date: the "all good" message no longer promises steps "coming with application detection", the hard-coded list of 7 readable apps is replaced by the real count and the first connectors read from the connector list (with a link to all of them), a "See everything in Settings -> Connectors" link sits under the proposed connectors, and a new **"Next" row** links to linking tools, alerts, backups and the Help page.
- **Example compose: the port is easy to change.** `MYSERVICES_PORT` now reads `${MYSERVICES_PORT:-8090}`, so a port already taken on the host is fixed with a one-line `.env` file (`MYSERVICES_PORT=8095`, example in `deploy/env.example`) instead of editing the compose file; a comment at the top of the compose explains that the container uses the host network, so a `ports:` mapping would not work. The quick start now saves the file as **`docker-compose.yaml`** (the name most people expect, and the only one the old `docker-compose` v1 tool finds) and downloads the example `.env` in a second `curl`. Both READMEs now state in bold that the app listens on port **8090** and that it can be changed. The option is also visible in the compose itself: a `>>> PORT` comment right above the `MYSERVICES_PORT` line says which number to change.
- **README: open `http://<IP>:8090/`** (the root redirects to the sign-in page, then to the app) instead of the long `/myservices/v2/` address.

## v0.10.1 (2026-10-11)

> **Live but early-stage: expect rough edges, and keep a copy of `config/` and `data/` before updating.**

### Changed
- **One card style across the app** (Settings and the other tabs): every card title that opens a card, alone or on a row with its buttons, is now a header strip across the card (same look as the new table cards, card grids and DNS cards), instead of a title with a blue bar; cards that need attention (detected services not configured, alerts off, authorise the key) tint the strip and the frame orange, finished ones green. Cards get a light shadow.
- **Every card title now has an icon** (Theme, Language, Accounts, Session duration, Add an account, My password, Authorise the key, Machines, Channels, Rules, My notifications, Latest sends, Audit log, Tokens, MCP tools, Updates, Changelog, Network search…), so the header strips read the same everywhere.
- **Backups tab, "To check" card redone**: coloured header strip with the count in a bubble (red if something is critical, orange, or green), then a table (state, backup set, what is wrong) and the read time in a footer. The table card is now a shared component (`TableCard`) also used by the DNS tab.
- **Health tab**: SSH, agent, Beszel and API machines are now **one single table** with a light separator row per category (name and count); card view keeps a thin titled divider per category. The table is the default view (your stored choice still wins).
- **Health tab, services and infrastructure in one card grid**: virtualisation (Proxmox), backups (Proxmox Backup), containers (Dockhand) and the services read through their API (Home Assistant, Frigate, Prometheus…) share one section and one card shape (coloured header strip with logo, name, kind, state and version). The Dockhand card now lists its environments in an aligned table (running / total, what to report) with the image updates under a fold.
- **DNS tab, synchronisation and AdGuard server cards redone**: a coloured header strip (icon, name, address, state badge) and label/value rows aligned in two columns between thin lines.
- **DNS tab lists redone as aligned tables**: each list (present on one instance only, rewrites to NPM without an active NPM host, invalid rewrites, direct rewrites, NPM domains to check) is a card with a coloured header (red, orange, grey or green, with the count in a round bubble) and a table with fixed columns and headers (domain, answer, why / only on / what to check) instead of free-flowing lines; the "NPM domains to check" card shows each issue as a badge and a green "all resolve the same" line when there is nothing to fix.
- **Backups tab**: the stat tiles (sets up to date, late, critical, without off-machine copy, undeclared copy, volume, machines) now sit on one single row (scrolls sideways on a narrow screen).
- **Diagrams tab shows the creation progress**: while a diagram is being built a banner says "Creating · for N s" with how long the last build took, the page re-reads every 2 s until the diagram appears, and the last build time and the next collection are shown otherwise. Fixes the **HTTP 500 when creating (or rebuilding) a diagram** (`threading` was not imported in `api.py`); a request made while a build is running now queues one more pass instead of being lost.
- **README rewritten**: logo built on the app's own 3x3 favicon grid (same squares and colours, kept as is), in a dark and a light variant picked by the reader's theme, shipped as **SVG and PNG** (`docs/logo-light|dark.svg|png`, plus `docs/icon.png`; the READMEs use the PNGs), a short "At a glance" and quick start, then **collapsible sections** for the big blocks (tabs, how machines are read, the 29 connectors, backups, alerts, diagrams, security, configuration, API and MCP, develop). English and French.
- **Wording follows the real stage of the project**: MyServices is *live but early-stage* (`0.x`), no longer presented as "testing phase, do not use in production". README badges and banner, release notes, the About page and the Help page now say so; the safety advice stays (keep a copy of `config/` and `data/`, keep it on your local network).

## v0.10.0 (2026-10-11)

### Changed
- **Home**: the attention card ("N points need your attention") shows **12 rows by default** with a row selector (12, 25, 50, All) remembered in the browser; the attention card and the "To do to complete the discovery" frame can both be **folded** (click its header; the badge keeps the count, the choice is remembered).
- **"Machine access" diagram redone**: besides the access methods (SSH, agent, **connector**, no access), every machine is now drawn under its method, inside a frame, with its health level, account and port (extra ways to read it are added to the detail, e.g. "+ agent, Beszel"). Up to 12 machines per method are drawn; the rest is listed in a card below. Checked with Archify 3.0.1 (no crossings) up to 35 machines.
- **Diagrams to create with a click** (Diagrams tab, "Diagrams to create"): four new diagrams built on demand from what MyServices already knows, each with a "Create this diagram" button (greyed with "nothing to show yet" when the data is missing): **network equipment and devices** (gateway, switches and Wi-Fi access points with the devices plugged into each, read by MynetworK and UniFi), **services per machine**, **domains and their path** (grouped under each NPM, with the machine and service targeted, and under each machine's Apache vhosts) and **virtual machines and containers** (Proxmox). Created ones join the list and can be removed; the choice is kept in `diagrams_extra`. New `PUT /diagrams/{id}`.
- **"Machine access" and the new diagrams share one layout** (groups on a row, their items inside a frame below, extras in a card), checked with Archify 3.0.1 with no crossings. **The "Who reads what (connectors)" diagram is removed**: it only showed connector types, not machines or what they read, so it added nothing next to Settings -> Connectors and the other diagrams; its old files are deleted at the next build.
- **Counts in card titles are round bubbles** everywhere (machines, connectors, followed backups, channels, rules, notifications, sessions, audit log, tokens…), tinted when it matters (orange for things to do). **Settings -> Machines**: collapsed machine cards all have the same height and width (two equal columns whatever the content) (long names and many badges are clipped, not wrapped), so the two columns line up row by row until you open one.
- **Filters work as toggles on every page**: a filter that was on stays as a pill after you turn it off (struck through, "+"); one click turns it off, another turns it back on, and several filters can be on together (several values of one filter combine with OR, different filters with AND). The filter panel is now a **grid of fixed-width columns, one per category, showing every pill** (no more "+2 others" hiding some roles). The **"Filters" button is always the rightmost item of the filter line** on every page, and on the Machines page "Show disabled" now lives inside the filters (Display row, counted on the button). The "Filters" button has a blue border and text, and a count badge. **Services opens on "State: OK" by default**, one click removes it; a filter coming from elsewhere (home counter, machine) is kept as is.
- **Home counters open the tab already filtered**: a click on a counter in the right-hand column (e.g. NPM "to fix", Health "critical", Machines "to set up") opens the right tab with only what that counter counts (Services, Machines, Health); the title still opens the tab unfiltered. The filter is applied once and cleared when you change tab by hand. Backups counters open the tab filtered by state (the tab lists machines while the counters count backup sets, so the numbers can differ; "no copy" just opens the tab). AdGuard counters scroll to the matching block (domains to check, orphan rewrites, unreachable servers) and outline it in blue for a moment.
- **Home notification frame redone**: the "to do to complete the discovery" frame is now a notification card with a bell and a **count badge**, then one row per item (system logo, **App** found on **Machine**, why) with its button and "Stop reminding me". The attention card shows its count in a coloured badge too.
- **Home page body redone** (the right-hand counters and schedule column are untouched): the counters are no longer repeated inside each card, so they only live on the right. Each section is a card with a header strip (icon tile, title, an "Open" link-pill whose arrow moves on hover), the attention card has a coloured status strip with dot-marked rows, and sentences get a soft bullet.

> **Testing phase: do not use in production.**

## v0.9.9 (2026-10-11)

### Added
- **4 more connectors** (kind "status", read-only, written from each service's documentation, **tried against fake servers only**): **Prometheus** (targets down, firing alerts), **Healthchecks** (failed and late jobs, read-only API key), **Netdata** (critical and warning alarms) and **Jellyfin** (playbacks, devices, pending restart or update). Detected containers propose them; logos for Prometheus, Netdata and Jellyfin.

### Changed
- **Settings -> Connectors**: the "Activation" sub-tab is gone. Each connector card has its own **Collection** switch (right of the version line); the Connectors tab only shows connectors.
- **Removed the "display" switches** (NPM, AdGuard, Apache) and the `sources` setting with its `GET /sources` / `PUT /sources/{name}` routes: what is detected or connected is always read and shown. An old `sources` key in `config.json` is ignored. To stop reading a connector, switch its Collection off.
- **Settings -> Machines has two sub-tabs**: "Machines" and **"SSH & Agents"** (how each machine is read); "SSH Agent Actif" (was "Read by SSH or by the agent") now sits at the bottom of the "Machines" sub-tab, folded by default, moved out of Connectors because it is about machines. Old `#settings/agents/<ip>` links open it.
- **"Detected services not configured" table** at the top of Settings -> Connectors: recognised apps that have a connector but no access set yet (Home Assistant, NPM, AdGuard, Frigate…), with their machine and an orange "To activate" state. Click the service: an **overlay** opens with the connector form already filled (address found). Apps already connected are not listed, and the card disappears when nothing is left. `data.json` gets `detected_apps` (same shape as `proposals`, plus `linked`).
- **Card titles stand out everywhere** (larger, extra bold, thin accent bar on the left, icon in the link colour; the blue mark of the active menu entry and sub-tab is thinner too) and **Settings -> Tasks and schedules is aligned like a table**: task, editable schedule (field, Save and reset buttons at the same height) and the run button in fixed columns.
- **Proxmox Backup Server joins the Backups tab**: Settings -> Backups -> "Proxmox Backup Server" lists the backup groups (a VM, container or host per datastore) read with the existing `proxmox-backup` connector's token (no account re-entered), you tick the ones to follow and set the alert age, like Veeam jobs. Datastore usage appears as disks. Read-only, written from the API documentation and **tried against a fake server only**.
- **Veeam wizard reuses the connector**: when a Veeam connector exists (set in Connectors, whatever its name), the wizard shows its account and only asks for it again on "Change the account".
- **Settings -> Backups: a "Backup sources" table** (folders on my machines, Veeam, Proxmox Backup Server, Home Assistant) with a state per source (green when followed, orange when to set up). Click a source and its fields unfold under it, one at a time; the list of followed backups stays above.
- **Settings -> Backups, "Followed backups" redone as cards** like the sources: logo or icon of the origin (folder, Veeam, Proxmox Backup, Home Assistant), name and path, an origin badge, then the alert age, the off-machine copy switch and "Remove" on a second line.
- **Settings -> Notifications reorganised**: "Alerts" and "Notifications" are sub-tabs like the other pages; channels, rules and notifications are cards with an icon, name and details on the left, state badges, then their buttons aligned on the right (same order on every row).
- **Language buttons show a flag** (French, British), drawn as SVG so they also show on Windows.
- **Settings -> Machines**: the last sub-tab you opened is remembered (a link to a machine still opens the right one), and the machine cards sit in **two independent columns** (all borders are now 1 px, with a thin 2 px accent on the left of the detail blocks; an unfolded machine or agent card gets the blue frame): opening a card no longer stretches or shifts the card next to it. SSH key page: "Machines using this key" is now an aligned table (machine with icon and address, account, port, state).
- **New "Help" page** in Settings (Application group, above "About"): where to start in six steps with direct links, how MyServices reads the network (SSH, agent, connector, network search), good habits, and what to do when something does not work.
- **History opens on the last 24 h, as bars**; the period and chart style you pick last are remembered in the browser.
- **Fewer duplicate calls from the page**: the discoveries list is fetched once and shared by the bell, the home reminder, the Settings menu and the Discovery page (one call every 30 s instead of four); Settings → Discovery and Tasks re-read every 10 s only while a scan or task runs, every 60 s otherwise; Agents every 30 s (5 s while waiting for a first report); nothing is re-read while the browser tab is hidden, and the tab re-reads when you come back.
- **Responses are gzip-compressed** (above 1 KB): `data.json` is about 200 KB.
- **Unchanged files cost no body**: produced files (`data.json`, health, backups, events) are revalidated with their ETag and answer `304 Not Modified` when nothing changed; the page no longer adds a random `?t=` to them nor bypasses the browser cache.

> **Testing phase: do not use in production.**

## v0.9.8 (2026-10-11)

### Changed
- **Favicon and logo: the 3x3 grid is kept** (decided). The 4x4 test favicon and `logo-grid-4x4.svg` are removed.

### Changed
- **Discovery pages: coloured frames wherever an action is to do**: a card with something to do gets an orange frame, tint and left bar, and so does its foldable list; a family sub-tab with something to do is orange; the Settings menu entry "Discovery" is orange with the count.

### Changed
- **"View and choose the machines found" is folded by default** (it only opens when you follow its link, not on every page load).

### Fixed
- **Selection buttons showed "Add the selection (10)" with nothing ticked on screen**: the count included machines already added, ignored or hidden in a folded frame. Only ticked machines that are visible now count (and are added); the "other devices" frame must be open for its boxes to count.

### Fixed
- **Found machines list shown twice** in Settings → Discovery when the "machines found" reminder was switched off: the list is now only in its discovery card, and in a card of its own only when there is no such discovery.

### Changed
- **Found machines: the selection buttons sit under the list, inside its frame** (not in the card footer mixed with "Stop reminding me"). When the frame is folded, its header shows how many are ticked. The card's own "Choose" button is gone (the frame opens by itself).

### Changed
- **Main buttons are now solid** (accent fill, white text) so they are not mistaken for the foldable frames, which keep their accent border and tint. The few buttons that copied the frame look ("Review first steps", "Redo a scan", the agent update button) use the neutral button style.

### Changed
- **"Machines already added" frame is folded by default.**

### Changed
- **Settings → Discovery: the found machines live inside their discovery card** ("N machine(s) found, not followed yet"): a folded frame "View and choose the machines found" opens from the card (and from its "Choose" button), and the selection buttons ("Add the selection (n)", "Deselect all") sit in the card's footer next to its other buttons, only while something is ticked, even when the frame is folded. When there is no such discovery, the list stays in its own card.

### Changed
- **Found machines: selection buttons only when needed**: "Add the selection (n)" and "Deselect all" appear in a bar only while something is ticked (also when the frames are folded); "Select all" moved next to the "To look at" heading and hides once all are ticked.

### Changed
- **"Access passed, to set later" notice moved to the top** of "Machines found on the network", right under the search buttons.

### Changed
- **Foldable frames in the network step** ("machines already added", "other devices"): accent-coloured border and background, a chevron that turns when open, a larger header, so it is clear they open.

### Added
- **Ignored devices are listed in "other devices"** (Settings → Discovery → "Machines found on the network"), under their own "Ignored by hand" heading with a dashed row, an "ignored" badge and a "Take back" button. The sub-headings of that frame (web pages only, ping only, ignored) are now clear bars with an icon, a coloured edge and a count.

### Fixed
- **Found machines list no longer jumps when a box is ticked**: the name field and the "what happens after adding" hint now sit on their own line under the row (ticked rows get a light frame) instead of squeezing the row.

### Changed
- **Active secondary buttons are readable everywhere** (dark and light themes): text in the main colour, a visible border and a light background instead of faint grey; disabled ones stay faded. One shared style (`quiet`) covers all pages, plus the first-steps and network buttons and the connector test report's close button.

### Changed
- **Discovery cards**: the action button ("Search now"…) uses the active accent colour and "Stop reminding me" a visible bordered style, instead of the faint grey.

### Changed
- **Settings → Discovery in three sub-tabs** (Network and machines, Services and apps, Backups), each with its own cards (title, mode, what it does, last / next time, buttons) and a count of what is to do; the sub-tab opens on the first family with something to do. The network settings (found machines, search, networks, ignored devices) sit in the first sub-tab.
- **"Machines added: access to set" only lists machines whose access is still to set**; the ones that are fine move to "already added".

### Added
- **"Stop reminding me" on a discovery to do** (machines found, network search never run, backup search, apps to connect): it stops counting in the bell and on the home page but stays listed in Settings → Discovery with a "Show the reminder again" button (`discoveries_muted`, `PUT /discoveries/muted`). A refused SSH key or a missing agent cannot be muted.

### Fixed
- **The Discovery buttons still did nothing when arriving from another page**: the scroll ran before the page had loaded its data.

### Changed
- **Discovery titles**: the machine's system logo, then "**App** found on **Machine** (ip)" with only the app and the machine in bold (`app` and `machine` fields added to `GET /discoveries`).

### Fixed
- **Settings → Discovery: the "Choose" / "Search" buttons did nothing** (they linked to the page already open). "Machines found on the network" is now a card on that page (tick, name, add or ignore) and the buttons scroll to it or to the search card.

> **Testing phase: do not use in production.**

## v0.9.7 (2026-10-11)

### Added
- **Home counters (right column)**: each group shows the real app logo (Nginx Proxy Manager, Docker, AdGuard Home) or a theme icon (Machines, Health, Backups) instead of an emoji.
- **DNS tab header**: AdGuard Home logo and title above the cards, and an "AdGuard" badge on each card (the tab may later host other DNS sources: UniFi, ISP box…).
- **Settings → Connectors lists what is read over SSH or by the agent** (AdGuard, Docker, processes) in a read-only block "Read over SSH or by the agent", with the same read-count badges and a link to the machine settings. AdGuard read over SSH had no card there.
- **Each connector card shows what its last collection read** (badges such as `entities : 4593`), not only after pressing "Test".
- **Settings → Discovery redesigned**: "Important actions" first (everything still to do, with its button), then the other discoveries grouped by family (Network and machines, Services and apps, Backups); the network search, its frequency and the manual actions share one card, networks / discreet mode / ignored devices sit beside it.
- **Discovery items**: "never run" and "next" are now coloured badges (orange / blue).

> **Testing phase: do not use in production.**

## v0.9.6 (2026-10-11)

> **Testing phase: do not use in production.**

### Added
- **"Test" button on every connector card**, without opening the form: it reads with the saved settings and shows a green or red frame with the version and a badge per kind of information read (entities, hosts, containers…), proving the connector really reads something. The form's test shows the same report. The card button now only says "Edit".

### Fixed
- **Settings → Machines cards have the same height** in a row, and many badges wrap onto several lines instead of stretching the card.
- **A machine read through a connector's API (Home Assistant, Proxmox…) was still shown as "online, without SSH"**, and nothing from the connector reached the Machines page. Now a machine whose connector URL (or announced address) points at it shows state **API**, its detail lists the connector with its version, and a failing connector is flagged in "To watch".
- **Home Assistant now brings sensors for its host machine** (System Monitor integration and Supervisor sensors): processor, memory, disk, temperature. They feed the Health tab as a source named "Home Assistant" (group "API"), so the machine gets CPU / memory / disk columns and alerts like any other. The connector also counts unavailable entities and low batteries.

### Changed
- **Folded agent card** (Settings -> Connectors -> Agents and SSH): the header now shows a green icon when automatic update is on, an "out of date · vN" badge (or "update requested") when the agent is older than the served script, and a check mark when it is up to date, so you see it without unfolding.
- **Machines: agent state and summary.** A PC read by its agent now shows "Agent active" in the State column instead of "online, without SSH" (it is also filtered and sorted as such). The "To watch" column always shows every pill (they wrap, nothing is hidden), and each machine's detail starts with a foldable "To watch" summary: one line per subject with its icon, colour and full sentence, open when something is serious. The alert delay in Settings -> Notifications -> Alerts is now a row of buttons.
- **Machines tab: "To watch" column instead of "Stop following".** The per-row "Stop following" button is gone (the switch "Machine followed" stays in Settings -> Machines only). A new sortable **To watch** column shows one icon pill per subject, **red** (serious: unreachable, full disk, failed units, SMART, services down), **orange** (to look at: SSH key refused, updates, reboot required, Docker unhealthy, connector failing) or **blue** (to know: online without SSH or agent), most serious first, with the detail in the tooltip; a green check when there is nothing. The same list of health problems is now shared with the Health tab (`machineWatch.ts`).
- **Icon buttons instead of drop-down lists** where an icon makes sense: the token kind (MCP / API), the token validity (30 days, 90 days, 1 year, no end), the Home Assistant connector choice in Backups, and "Health read first by" (Automatic / SSH / Agent) in a machine's settings. Drop-down lists with many values or no meaningful icon (SSH alias, durations) are kept.
- **Agent and SSH cards**: the system logo (Windows 11, Debian, Ubuntu…) shows next to each machine; the "Automatic yes/no" switch and the "Update now" button are aligned, the state is a small pill.
- **Agent card** (Settings -> Connectors -> Agents and SSH): the details that were squeezed into one long line (last report, system, agent version, frequency, token) are now a small list that wraps on several lines; the system name is shortened ("Windows 11 Pro") and an outdated version is flagged.

## v0.9.5 (2026-10-11)

> **Testing phase: do not use in production.**

### Added
- **Agent updates from the page** (Settings -> Connectors -> Agents and SSH), modelled on GpuViewR: each agent card shows its version ("v5 -> v6 available"), an **Automatic** icon switch and an **Update now** button. The agent still pulls: at its next report the server tells it to fetch the new script (only when automatic update is on or an update was requested); the agent checks the script's SHA-256 and syntax, then replaces its own file. `PATCH /agents/{id}`, `POST /agents/{id}/update`. Nothing is pushed to the PC; Linux and macOS agents are not written (SSH stays the way to read them).
- **Windows agent v6: Docker and services.** The PowerShell agent now also reports the PC's Docker containers (when `docker.exe` is installed and reachable by the SYSTEM account) and its running Windows services. Containers appear like those read over SSH (ports, Services tab); services are matched against known apps (Plex, AdGuard Home, Jellyfin, Sonarr, Radarr, Syncthing, Grafana, Prometheus, Veeam, Portainer, Uptime Kuma, Frigate, CrowdSec…) and shown in the machine detail ("Apps"). Re-install the agent to benefit.
- **To-do notifications for detections that need a manual step.** Whenever MyServices recognises an app it cannot read without your input (an AdGuard Home service on a Windows PC, a Frigate container, a Pi-hole…), a notification says so ("AdGuard Home found on PC"), with a "Configure" button that opens the connector already filled in. Same for machines found by the network search but not followed, SSH keys to authorise (or a wrong port) and agents created but never installed. They are listed on the home page and in Settings -> Discovery, and a bell with a counter appears in the header (admins).
- **AdGuard Home is connected automatically**: when a machine read over SSH runs an AdGuard Home container, the AdGuard connector is switched on by itself after the next collection (once per machine; clearing the field in Settings -> Machines keeps it cleared), and the DNS tab appears. Previously only "Re-detect" did it.
- **12 new connectors** (kind "status", shown in Health -> "Service via API" with key figures and what needs attention), all read-only and written from each service's documentation, **tried against fake servers only**: **Frigate** (cameras, detectors, storage, events), **Sonarr / Radarr / Lidarr / Prowlarr** (`arr`: health warnings, queue, missing), **OPNsense** (gateways, firmware updates, reboot), **CrowdSec** (active decisions), **Pi-hole v6**, **Technitium DNS**, **TrueNAS** (pools, alerts), **Synology DSM** (volumes, disks, temperature), **UniFi Network** (devices, clients), **Tailscale / Headscale** (machines online, client updates), **NUT** (UPS: mains, battery, runtime, load) and **Portainer** (environments, containers). Secrets travel in headers or POST bodies, never in the address. Detected containers propose the matching connector (Frigate, *arr, Pi-hole, Portainer, UniFi, CrowdSec, Technitium, Headscale, NUT); a choice whose values have a logo (application, Tailscale or Headscale) is shown as icon buttons. Ideas for more: `docs/IDEES-CONNECTEURS.md`.
- Settings -> Connectors: the "Add a connector" button is a coloured button again (it looked greyed out) and the introduction text is shorter and clearer (the two bullet points were removed).

### Fixed
- **Settings -> Machines blank page** ("Rendered more hooks than during the previous render"): a React hook had been placed after an early `return` in the machines page. Fixed, and a unit test (`hooksOrder.test.ts`) now fails if any component calls a hook after an early return.
- **Warnings coming back after a fix**: after fixing the SSH port or authorising the key, the "wrong port" / "key refused" cards stayed (and came back "in a loop") until the next collection pass finished, because they read the last pass. A successful test now clears them at once; the next pass confirms.
- **Authorize-the-key card**: "Test" showed "unknown machine" because the card sent the connector name instead of the machine address; it now uses the IP everywhere, and one command per SSH account when several machines fail with different accounts (it no longer falls back to "root" when the machine was not found by name).
- **Wrong SSH port is no longer reported as a missing key**: a "Connection refused" is shown as such, the check counts it as a failure (it used to say the key was accepted), and when the network search saw sshd on another port than the alias uses (e.g. 22232 instead of 22), the machine card offers "Use port 22232". New SSH accesses prepared from a machine card use the port seen by the network search.
- **Settings -> Machines**: switching "Machine followed" back on left the machine card greyed ("not followed") until the page was reloaded; the card now follows the switch at once.
- **Backups: false alarms on folders followed from the page.** A set followed from Settings -> Backups (or automatically for `/home/backup`) used to be critical with "no up-to-date copy outside the machine" because no copy elsewhere had been declared, and critical on age because the threshold was always 2 days even for weekly backups. Now: a set from the page does not require an off-machine copy (`expect_offsite: false`; a switch per set in Settings -> Backups turns the requirement on), the Backups tab counts them as "copy elsewhere not declared" instead of "without copy", and the age threshold is suggested from the age seen at discovery (2, 8, 15 or 31 days, with a 25 % margin) and editable per set (`PATCH /backups/settings/{id}`). Hand-written sets keep requiring an off-machine copy.

## v0.9.4 (2026-10-11)

> **Testing phase: do not use in production.** Several items below were checked by tests and type-checking only, not yet by eye in a browser.

### Added
- **History page rebuilt**: four chart styles, remembered between visits: **Dots** (one dot per event at its exact time, one lane per family), **Bars** (stacked by family; step from 30 minutes on 24 h up to 3 days on one year; a click limits the list to that range), **Curve** (stacked area) and **Heat map** (weekday × hour). Vertical axis with round integer values and dashed guide lines (horizontal and vertical), same chart height for every style, a new 24 h period, search and filter chips also apply to the chart. Every entry carries badges: event type, detection method (ping, SSH, health, connector, HTTP probe…) and what read it (collection, NPM, Docker, AdGuard, a connector, health sources).
- **Home**: a card with the live date and clock plus the scheduled tasks (collect, watch, health, backups, automatic network search) with the running time or the next run and a countdown (`GET /tasks` now returns `label`, `at`, `next`); the counters are also repeated under each category paragraph (the right-hand column is kept for now); "Last 24 h" is a list, one line per event type.
- **Health page**: Cards or Table view (remembered), machines grouped by access (SSH, Agent, Beszel), a light one-line table with expandable rows ("Expand all"), a foldable "Details" sub-frame on cards, an OS icon and a filter by system and by access. The "Services read through their API" title becomes "Service via API".
- **Machines page**: one line per machine with no horizontal scrolling and an expandable detail in five sections (Identity, System, Access, Software and services, Health), each ending with its **source** (clickable badges linking to the matching setting). Cards or Table view (remembered); OS icon (distribution logo, or the family icon) and abbreviated OS name in the System column (full name in the tooltip); the Servers column shows icons (NPM, Apache, nginx, Docker) with counts in the tooltip; new filters (System, Access, Role).
- **Themed tooltips everywhere**: one component takes over every `title` attribute (hover and keyboard), dark or light with the theme, no duplicate native tooltip.
- **Filter chips** carry a colour dot, a logo or the family colour square (State, System, Source, App, Type…); new filters on Services (App) and History (Method, Read by).
- **Settings → Machines**: the icon choice shows only the icon in use (the auto-detected one when none is chosen); a click opens a panel with search and three families. **118 more icons**: 78 brand logos (systems and services, simple-icons, CC0, brand colour or a neutral grey when unreadable) and 40 object icons, plus five Windows styles (11, 10, classic, Server, monochrome). The machine card header updates as soon as an icon is picked.
- **Backups**: the default folder `/home/backup` is always searched and ticked by default when it exists; "Other locations" (absolute paths or `*` patterns, `PUT /backups/patterns`) to add more.
- **Services**: a dedicated icon column (recognised app, name or image, then Docker/Apache/nginx type).

- **Settings → SSH key** rebuilt: the public key and the authorisation command are **hidden by default** (an eye button shows them; "copy" works while hidden), badges for key type, fingerprint and known machines, a 3-step guide, and the list of machines using the key with their state.
- `scripts/release.py`: one command keeps the version consistent everywhere (`package.json`, lock file, both READMEs, CHANGELOG, release notes). `release.py` alone checks consistency; `release.py patch|minor|X.Y.Z [--dry-run]` applies a version, turns "Unreleased" into the dated section and reopens an empty one. It commits, tags and pushes nothing.

- **Unidentified services, HTTP fingerprint and port guess**: the web probe now keeps a fingerprint of each backend (Server / X-Powered-By headers, header and cookie *names* only, generator meta tag) and 34 more apps are recognised without SSH (Pi-hole, Nextcloud, Gitea, GitLab, Vaultwarden, Traefik, Transmission, Prowlarr, Node-RED, ESPHome, InfluxDB, Vault, Cockpit, OpenWrt, TrueNAS, pfSense…), plus nginx / Caddy / IIS / lighttpd / Kestrel by their `Server` header ("possible" only). A guessed app is no longer counted as unidentified and is shown with its confidence (sure / probable / possible). The favicon is not used.

- **History**: the event type and detection method badges now sit right of the time, before the dot and the service name; the "read by" badge no longer says Docker + Ports for every local service: it follows what really reads the row (Docker, ports over SSH, the agent for a Windows PC, Apache…), and "Collection" when the row has since disappeared.

- **Diagrams (Archify)**: three new generated diagrams next to the network map and the backups map: **Who reads what** (MyServices and one block per connector type, by SSH or API, dashed when down), **Machine access** (read over SSH, by the agent, or no access, with account and port in cards) and **Alert and notification chain** (collection -> history -> alerts / notifications -> Discord, Telegram, webhook). A diagram whose specification did not change is not regenerated. Each page gets a slim footer: back to MyServices, the other diagrams, and "Generated with Archify" (linked to the project).
- **Notifications** backend (`notifications.py`): custom messages next to alerts, on the same channels. *Reports* at fixed times and weekdays (chosen machines and sensors: CPU, memory, fullest disk, all disks, temperature, load, uptime, updates, reboot, failed units, Docker, SMART, refused SSH logins, ping) and *events* in live (kinds, machine, text, resolved events, delay between two sends; empty filter = everything). Six working examples (added disabled), "Send now" sends a real message. API: `/notifications`.
- **Discoveries overview** (`GET /discoveries`, Settings -> Discovery, and a reminder on the home page): which discoveries run by themselves, which need one manual start and which stay manual (network search, machine re-detection, backup folders, cron lines, connectors to link), with the last and next run.
- **Backups**: `/home/backup` is now followed automatically the first time a machine is read over SSH (`backups_auto`, once per machine; removing the set does not bring it back).
- **Settings -> About**: installed version, latest published version read from GitHub by the server (one anonymous request, kept 6 h; `update_check: false` turns it off), and the changelog with one version per button.

- **Diagrams tab and user menu**: a "Diagrams" tab lists every diagram with a short description, an inline preview, "Open" and "Regenerate now"; the account menu lists the available diagrams too ("All diagrams" plus one link each).
- **Settings -> Notifications** (was "Alerts"): two categories, **Alerts** (as before) and **Notifications** (new): reports and live events with a form built from buttons (report or events by icon, machines, sensors, times, weekdays, event kinds, delay, channels with their logos), six ready-to-use examples, "Send now", and the latest sends. The alerts status frame can be hidden (the choice is remembered; a one-line status stays).
- **Icon choices instead of drop-down lists** for new screens (`IconChoice`): channel type (Discord, Telegram, webhook logos), notification type and account role. **Accounts**: avatars, role as two buttons (no menu), counters, session length presets, and a duplicated "Session length" card removed. **Audit log**: period, action type and account as buttons with counts and colour dots, summary tiles.
- **Header**: the grid logo before the title (see Logo); on a development image ("dev") the git state it was built from (`--build-arg GIT_REV`) and the planned version (latest published + 1 when an "Unreleased" section exists) are shown next to it.

- **Logo**: the favicon is the original service **grid** again, now used everywhere (README logo and icon included); Settings -> Appearance -> "Header logo" switches the header icon between the favicon as is and the same grid without its dark square.

### Changed
- **Health keeps "often off" PCs**: a PC flagged as often switched off with no fresh report stays in Health as a greyed card ("off (intended)", or "on, waiting for the agent" when it answers ping) with the time of its last agent report, instead of disappearing; no alert and no event. A targeted ping every minute re-reads that machine as soon as its answer changes; every agent report refreshes that machine's card.
- Adding a machine (First steps, SSH test, key authorisation) now reads only that machine's collection and health right away instead of starting a full collection pass (several machines still start a full pass).
- **Windows agent v5**: retries the report for about 6 minutes after a boot (network not ready yet), scheduled task with a 30 s start delay, an extra trigger at logon, and a restart by Windows on failure. Re-install it on the PC to benefit.
- **Unidentified services**: a disabled, paused, switched-off-machine or unreachable-backend row shows its reason instead of "not identified"; when an enabled row's backend stops answering, the **last known identification** is kept and marked "last known".

### Fixed
- The OS name abbreviation handles accented editions ("Édition Familiale" → "Home").

## v0.9.3 (2026-10-11)

> **Testing phase: do not use in production.**

### Changed
- `setup.py --check` ends the connector tests with a summary ("connectors: N/M read") and reports connectors that failed or were stale at the last collection pass (read from `data.json`).
- `setup.py --check`: the SMART sudoers advice no longer breaks when a login banner (fastfetch in `~/.bashrc`) precedes the command output.

### Added
- The header shows the app version next to the title (e.g. `v0.9.2`; `dev` for a local build); `/me` returns it.

## v0.9.2 (2026-10-11)

> **Testing phase: do not use in production.** The new connectors have only been tried against fake servers.

### Added
- **MynetworK connector** (`mynetwork`, kind `network`): reads the LAN inventory (IP, MAC, hostname, vendor, online/offline, ping, open
  ports) and optional UniFi clients and devices through MynetworK's read-only REST API token (`mwk_api_…`, GET only). Routes that MynetworK
  does not expose (UniFi not linked) are skipped, not errors.
- **LogviewR connector** (`logviewr`, kind `security`): fail2ban jails, bans over 24 h, active threats, metrics and log sources through
  LogviewR's MCP endpoint (`POST /mcp`) with a read-only token. Only read tools are ever called; no free text from logs is kept.
- **Dockhand connector** (`dockhand`, kind `containers`): environments, container counters and pending image updates through Dockhand's
  REST API (`dh_…` token, or none when authentication is off).
- **Proxmox VE connector** (`proxmox`, kind `virtualization`): nodes, VMs, LXC containers, storage usage and last vzdump backup through an API token
  (`PVEAPIToken`, role PVEAuditor, read-only). **Proxmox Backup Server connector** (`proxmox-backup`): datastores, usage and age of the last backup
  (`PBSAPIToken`). Self-signed certificates are the default case ("Verify certificate" is off by default).
- Settings → Connectors → Agents and SSH: the four groups (With an agent, Without an agent, Linux read over SSH, No access) fold with a chevron, like the "Agent created" card; empty groups start folded and move to the bottom.
- Agents and SSH: "Revoked agents" becomes a foldable group (folded by default) of cards (who, when, last report), each with a "New agent" button (Windows PC) and a "Delete" button (with confirmation) that removes the revoked agent from the list for good (`DELETE /agents/{id}/purge`, revoked agents only).
- Agents and SSH: more space between the groups.
- Agents and SSH: each agent card (Gamer32…) folds with a chevron, keeping its header (machine, IP, state); it starts folded when the agent is fine (active) and open when something needs attention (silent, waiting for its first report).
- Settings → Connectors: the open sub-tab (Agents and SSH, Connectors, Activation) is remembered across page reloads (it defaults to Agents and SSH).
- Settings → Connectors: a connector that was read shows only the green check (no "OK" text); stale or failed shows its icon and message.
- Fix: connectors of kind `status` (Home Assistant) showed "pas encore lu" (not read yet) in Settings → Connectors although they were read: their state was added to `data.json` after the `connectors` list was copied. They are now read first.
- Icons for MynetworK, LogviewR, Dockhand, Veeam and Web-Check (Proxmox Backup Server reuses the Proxmox one), also selectable as machine icons.
- All of them are proposed when their Docker image, page or port is recognised, and tested against fake servers (`tests/test_connectors_reseau.py`).
- **Where the data shows**: the **Fail2ban tab** now exists and appears as soon as a LogviewR connector is linked (jails, bans in 24 h, active threats,
  latest bans); the **Health tab** gets a "Virtualization and containers" section (Proxmox, Proxmox Backup Server, Dockhand); the **Machines tab**
  shows MAC and vendor under each IP and lists devices seen by MynetworK but not followed. `data.json` gains `network`, `security`, `containers`
  and `virtualization`.

## v0.9.1 (2026-10-11)

> **Testing phase: do not use in production.**

### Changed
- README rewritten short and in English (French version in `README.fr.md`), with badges and a prominent "do not use in production" notice.
- New logo and icon (`docs/logo.svg`, `docs/icon.svg`, favicon). The outdated classic-install documentation was removed.
- `.claude/` is no longer tracked by git.

## v0.9.0 (2026-10-11): first numbered version (BETA)

> **Testing phase: do not use in production.**

Includes everything from the pre-releases below (alpha, beta, rc.1 to rc.3) and adds:

### Changed
- Settings → Connectors: the **Agents and SSH** sub-tab now comes before **Connectors**.
- Agents: the "MyServices address, as seen from the PC" field is no longer shown at the top of the page. It only appears when
  requesting a new agent ("Install the agent on…" card), prefilled with the address of the page; the browser no longer remembers it. It
  shows again in the "Agent created" card only if the typed address is invalid.

## v2.0.0-rc.3 (2026-10-11)

### Added
- **Nginx Proxy Manager connector in three modes**: direct API, API over SSH, or the `npm-api.sh` script. Fields adapted to each mode,
  required fields marked, path check with hints.
- **`npm-api.sh` v3.6.9 installed from MyServices**: SHA-256 fingerprint verified, `npm-api.conf` set to 600, password passed on standard
  input (never as an argument), script run over SSH on the chosen machine.
- Form header with the connector icon; only one form open at a time.

## v2.0.0-rc.2 (2026-10-11)

### Changed
- Docker image: `:latest` follows the latest pushed tag, pre-releases included. Checked for amd64 and arm64.
- README: BETA notice (badge, box on what is still being tested), `-beta.N` then `-rc.N` versioning rule.

## v2.0.0-rc.1 (2026-10-11)

### Added
- **Windows agent** (PowerShell, read-only), versions 2 to 4: system (Windows, build, uptime), listening TCP ports with their process,
  hardware (model, BIOS, CPU, memory, graphics, IPv4 network, domain, last update), shown in the Machines tab and in services. The first
  report, or a reinstall in another version, also triggers a collection.
- **Agents**: clicking a Windows PC prepares the agent and asks for confirmation before creating the token; the command to copy follows
  the "MyServices address" field (token kept in page memory); the "Agent created" card confirms the first report and the detected
  system; the page refreshes itself (5 s while waiting for a report, otherwise 10 s, paused when the browser tab is hidden).
- **Backups**: Veeam wizard (test, job discovery, tracking, encrypted password) and automatic Home Assistant backups.
- **Machines settings**: "Redetect" button (proposed differences, checkboxes, confirmation before writing), machine icon choice
  (applications, systems, objects; Auto by default), "Stop following" on each row of the Machines tab.
- **API v1**: typed read routes built on the common model (`GET machines`, `services`, `health`, `backups`), open to `read` tokens.
- **Merging of health sources** (SSH, agent, Beszel) by a priority settable per machine; common data model (`models.py`), connector
  cache (`ctx.cached`), "untested version" alert.
- **Single-machine refresh**: per-machine inventory cache, `health.py --only <ip>`, `POST machines/settings/<ip>/refresh`, called after
  a setting change, a successful access test or when a machine is added.
- **Home Assistant health**: updates split into core, modules and other devices.
- **Network discovery**: port 5000 identified by its page (Frigate…), name guessed without DNS (NetBIOS, HTTPS certificate), apps
  recognised by their ports (Proxmox VE 8006, Backup Server 8007, Ollama 11434, LM Studio 1234, Veeam 9419/9392/9401, llama.cpp,
  Home Assistant 8123/4357).
- Settings → Connectors as **sub-tabs** (Connectors, Agents and SSH, Activation); Activation as a table; Linux machines read over SSH
  are grouped with their state and a link to their settings, next to the Windows agents.
- CI: test coverage sent to SonarCloud (Python via `coverage`, front via `vitest`); Dependabot without automatic major bumps (Node stays
  on 22 LTS).

### Changed
- Machines: full `authorized_keys` path depending on the chosen account; rejected SSH key: the card tells which account and gives the
  command; a successful access test starts a collection; "Settings → SSH key" is a real link; connection state sits in the Access card,
  first; collapsed "Machine options" menu with active options shown outside.
- Login and files: the redirect destination is read back as a site address (under `/myservices/` only).
- Network discovery: certificate name read with TLS 1.2 minimum.

### Fixed
- Health: an agent report with malformed updates no longer crashes the page (PowerShell 5.1 turns a re-read array into `{value, Count}`).
- Agents: no more error when an agent's machine is not (yet) in the list; only Windows PCs get an agent.
- Network discovery: no more "port 5000" label without a recognised app.
- API 422 errors no longer echo the submitted value.

## v2.0.0-beta.1 (2026-10-10)

### Added
- First "beta" release (real GitHub release, image `2.0.0-beta.1` for amd64 and arm64).
- Machines: "Virtual machine" ticks itself when detection finds one (once per machine).

## v2.0.0-alpha.4 (2026-10-10)

### Added
- Weekly Dependabot (pip, npm, Docker, Actions, grouped); Code scanning enabled.
- Machines: the SSH access text moves into the "Add a machine" card.

### Changed
- SonarCloud: sources without duplicates, tests removed from sources.

## v2.0.0-alpha.3 (2026-10-10)

### Added
- **MyServices agent (Windows, no SSH)**: `msv_agent_` token bound to a machine, report-receiving route, merged into health;
  `agent.ps1` and `install.ps1` served by MyServices; Settings → Agents; health started on the first report.
- **Health over SSH**: CPU temperature (`k10temp`, `coretemp`, `cpu_thermal`, thresholds 85 / 95 °C), "VM" badge without sensors, CPU,
  memory and swap usage (read from `/proc`), bars in the detail card, CPU and Memory columns in Machines, memory alert at 90 / 97 %.
- **Profile** for every account: password, open sessions, sign out other devices, configurable session length (admin).
- **Audit log** with filters by type and by account, CSV export.
- **Network discovery**: networks of your choice (several /24), discreet mode (no TTL or MAC), ignored devices with "Resume".
- **Machines**: "Followed machine" switch (off: no ping, SSH, health or alert), SSH access as an Active / Inactive switch, icon of the
  detected system or hosted application (Proxmox, Home Assistant…), SSH access guide for Windows (OpenSSH, key, account) and Linux
  (key authorization command), "Unfinished" badge, gateway / NPM / VM ticked from detection.
- **Backups**: backup folder discovery over SSH and tracking from the page.
- **Home**: "Machines" counter group (SSH OK, to set up, off, unreachable) and warnings.
- **Tasks and schedules**: "Machine health" switch with an explanation when a task is off.
- **Connectors**: "+ Add" as mini cards, access and activation in two parts, "Read over SSH" card.

### Changed
- Settings reorganised in four groups (Monitoring, Access and security…); "Network search" became "Discovery"; "System" became
  "Backup and info"; the Sources section is gone (the display switch lives in the connector card).
- Missing Docker is no longer a failure ("no Docker on this machine"); port 139 alone no longer says "Windows".
- Demo screenshot removed from the repository.

### Fixed
- A login banner (fastfetch in `~/.bashrc`) no longer skews the reading of a Linux machine over SSH.
- Favicon: path under `/myservices/v2/` (the old path was doubled).

## v2.0.0-alpha.2 (2026-10-10)

### Added
- **Getting started** ("Premiers pas"): first-start wizard with network search, machine choice, SSH offered, Home Assistant through its
  REST API (token announced from the list), "Skip" button on each step, automatic scan, "Suggested connectors", icons of recognised
  applications, host machine detected with its Docker services.
- "Known app" table: recognises services and proposes connectors.
- Network scan: probable system (Windows, Linux, macOS, iPhone, network gear) from SSH banner, ports, TTL and MAC.
- UniFi: to be read later through the MynetworK API, SSH optional.

### Changed
- Home Assistant: a 5xx error names the path involved and points to the logs.

## v2.0.0-alpha.1 (2026-10-10)

### Added
- **MyServices v2**: Docker version (a single container: collection, watcher, health, backups), connectors, new front end
  (`/myservices/v2/`), "Getting started" card, scan bar. The old v1 page is removed from this branch.
- CI: a pre-release (`-alpha`, `-beta`, `-rc`) never published `latest` (rule changed in rc.2).

### Fixed
- Front-end Dependabot alerts (vitest 4, postcss-selector-parser 7).
