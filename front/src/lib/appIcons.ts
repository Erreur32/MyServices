// Icônes des applis reconnues (copiées de MynetworK, public/svg) : seulement celles que le scan sait nommer.
// Les machines portent le nom lisible de l'appli (« Proxmox VE »), pas sa clé : la table part du nom.
const FILES: Record<string, string> = {
  "nginx proxy manager": "nginx-proxy-manager", "adguard home": "adguard-home", beszel: "beszel", "uptime kuma": "uptime-kuma",
  dozzle: "dozzle", docker: "docker", nginx: "nginx", apache: "apache", anubis: "anubis", caddy: "caddy", traefik: "traefik", syncthing: "syncthing", grafana: "grafana", plex: "plex",
  "home assistant": "home-assistant", "proxmox ve": "proxmox", proxmox: "proxmox", unifi: "unifi",
  "proxmox backup server": "proxmox", "proxmox backup": "proxmox", dockhand: "dockhand", logviewr: "logviewr", mynetwork: "mynetwork",
  frigate: "frigate", opnsense: "opnsense", "pi-hole": "pihole", pihole: "pihole", portainer: "portainer", truenas: "truenas", "synology dsm": "synology", synology: "synology",
  "unifi network": "unifi", sonarr: "sonarr", radarr: "radarr", "sonarr / radarr / prowlarr…": "sonarr", tailscale: "tailscale", "tailscale / headscale": "tailscale",
  jellyfin: "jellyfin", netatmo: "netatmo", netdata: "netdata", prometheus: "prometheus",
  "web-check": "web-check", webcheck: "web-check", veeam: "veeam", "veeam backup & replication": "veeam",
  "vmware vcenter": "vcenter", vcenter: "vcenter", "vmware esxi": "vmware-esxi", esxi: "vmware-esxi", vmware: "vmware-esxi",
  nextcloud: "nextcloud", freebox: "freebox", "box internet (upnp igd)": "upnp-box", "fritz!box": "fritzbox", "sfr box": "sfrbox", livebox: "livebox", "vodafone station": "vodafone-station", "sagemcom f@st": "sagemcom-fast", "bbox bouygues": "bbox", "swisscom internet-box": "swisscom-box", "compal connect box": "connect-box", "telekom speedport": "speedport", "passerelle technicolor (homeware)": "technicolor-gateway", "t-mobile home internet": "tmobile-home-internet", "hitron coda": "hitron-coda", "verizon fios router": "verizon-fios", "arris surfboard": "arris-surfboard", healthchecks: "healthchecks", crowdsec: "crowdsec", "technitium dns": "technitium", technitium: "technitium",
  "onduleur (nut)": "nut", nut: "nut", "network ups tools": "nut", "western digital": "wd", "wd my cloud": "wd", mycloud: "wd",
  pulse: "pulse", "pulse (agent)": "pulse", arcane: "arcane", "arcane (agent)": "arcane", glances: "glances", gpuviewr: "gpuviewr.png", "gpuviewr (agent)": "gpuviewr.png",   // GpuViewR's own favicon
  netalertx: "netalertx", "speedtest tracker": "speedtest-tracker", openspeedtest: "openspeedtest", umami: "umami", rybbit: "rybbit",
  wazuh: "wazuh", "wazuh (agent)": "wazuh", "wazuh (tableau de bord)": "wazuh", webmin: "webmin", tautulli: "tautulli", scrutiny: "scrutiny",
  zabbix: "zabbix", "zabbix (agent)": "zabbix", checkmk: "checkmk", "checkmk (agent)": "checkmk", searxng: "searxng", victoriametrics: "victoriametrics",
  wallabag: "wallabag", ntfy: "ntfy", myspeed: "myspeed", "dozzle (agent)": "dozzle", "beszel (agent)": "beszel", "portainer (agent)": "portainer",
  "hawser (agent dockhand)": "dockhand", "crowdsec (bouncer)": "crowdsec", "netdata (enfant)": "netdata",
  qbittorrent: "qbittorrent", transmission: "transmission", bazarr: "bazarr", "overseerr / jellyseerr": "overseerr", overseerr: "overseerr", jellyseerr: "jellyseerr", lidarr: "lidarr", prowlarr: "prowlarr",
  readarr: "readarr", whisparr: "whisparr", deluge: "deluge", sabnzbd: "sabnzbd", nzbget: "nzbget",
  backrest: "backrest", "borgmatic (borg)": "borg", borgmatic: "borg", borg: "borg", urbackup: "urbackup", duplicati: "duplicati", kopia: "kopia",
  "veeam backup for microsoft 365": "veeam", "veeam agent": "veeam", "sauvegarde windows server": "hyper-v",
  unraid: "unraid", "proxmox datacenter manager": "proxmox", "xen orchestra": "xen-orchestra", "kvm / libvirt": "kvm", libvirt: "kvm",
  incus: "incus", lxd: "lxd", virtualbox: "virtualbox", "hyper-v": "hyper-v",
  ollama: "ollama", "llama.cpp": "llama-cpp", "hermes agent": "hermes-agent", hermes: "hermes-agent",
  "open webui": "open-webui", vllm: "vllm", localai: "localai", "api compatible openai": "openai", "lm studio": "openai", litellm: "openai", koboldcpp: "openai",
  shinobi: "shinobi.png", go2rtc: "go2rtc.png", owncast: "owncast", zoneminder: "zoneminder.png", motioneye: "motioneye", "agent dvr": "agent-dvr.png",
  scrypted: "scrypted.png", "kerberos.io": "kerberos", kerberos: "kerberos", restreamer: "restreamer",
};

/** File of public/icons: SVG by default, or the given name when it has its own extension (a PNG favicon) */
const iconUrl = (f: string) => `${import.meta.env.BASE_URL}icons/${f.includes(".") ? f : `${f}.svg`}`;

/** Adresse de l'icône de la première appli reconnue qui en a une, sinon null */
export function appIcon(apps: readonly string[] | undefined): string | null {
  for (const a of apps ?? []) {
    const f = FILES[a.toLowerCase()];
    if (f) return iconUrl(f);
  }
  return null;
}

/** Photos of the devices MynetworK knows by model (copied from it): the Freebox Ultra, Pop and Revolution, and the UniFi access points.
 *  « Freebox v9 » is the Ultra and « v6 » the Revolution (the name MynetworK reads from the box); null when the model has no photo. */
const MODELS: [RegExp, string][] = [
  [/freebox.?(ultra|v9)/i, "freebox-ultra.png"], [/freebox.?(revolution|v6)/i, "freebox-revolution.png"], [/freebox.?pop/i, "freebox-pop.png"],
  [/\bunifi[\s-]?ap\b|\buap-|\bu[67][a-z0-9-]*\b|nanohd|nanolite/i, "unifi-ap.png"],
  // Without a photo of its own: the Pop is also « v8 », any other Freebox (Delta, « v7 ») gets the Freebox logo; the other UniFi devices
  // (gateways UDM / UCG / USG / UXG / UDR, switches USW, UNVR, UCK…) get the UniFi logo
  [/freebox.?v8/i, "freebox-pop.png"], [/freebox/i, "freebox.svg"],
  [/^(udm|ucg|usg|uxg|udr|usw|usp|unvr|uck|uacc|ucp)/i, "unifi.svg"],
];
export function modelIcon(model?: string | null): string | null {
  const hit = model ? MODELS.find(([rx]) => rx.test(model)) : undefined;
  return hit ? iconUrl(hit[1]) : null;
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Icône d'après un texte libre (nom ou rôle d'une machine : « homeassistant », « Proxmox VE »…) ; null si rien ne correspond */
export function appIconByText(...texts: (string | undefined | null)[]): string | null {
  const hay = texts.filter(Boolean).map((t) => squash(t!)).join(" ");
  if (!hay) return null;
  for (const [name, file] of Object.entries(FILES)) if (hay.includes(squash(name))) return iconUrl(file);
  return null;
}

const KIND_ICON: Record<string, string> = { docker: "docker", apache: "apache", nginx: "nginx" };

/** Logo du service d'une ligne : l'appli reconnue, sinon d'après le nom ou l'image (« jc21/nginx-proxy-manager »), sinon le type (Docker, Apache) ; null si aucun */
export function serviceIcon(r: { app?: { label: string } | null; service?: { name?: string; image?: string; kind?: string } | null }): string | null {
  const s = r.service;
  const kind = s?.kind && KIND_ICON[s.kind] ? `${import.meta.env.BASE_URL}icons/${KIND_ICON[s.kind]}.svg` : null;
  return appIcon(r.app ? [r.app.label] : undefined) ?? appIconByText(s?.name, s?.image) ?? kind;
}
