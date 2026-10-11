// Icônes des applis reconnues (copiées de MynetworK, public/svg) : seulement celles que le scan sait nommer.
// Les machines portent le nom lisible de l'appli (« Proxmox VE »), pas sa clé : la table part du nom.
const FILES: Record<string, string> = {
  "nginx proxy manager": "nginx-proxy-manager", "adguard home": "adguard-home", beszel: "beszel", "uptime kuma": "uptime-kuma",
  dozzle: "dozzle", docker: "docker", nginx: "nginx", apache: "apache", syncthing: "syncthing", grafana: "grafana", plex: "plex",
  "home assistant": "home-assistant", "proxmox ve": "proxmox", proxmox: "proxmox", unifi: "unifi",
  "proxmox backup server": "proxmox", "proxmox backup": "proxmox", dockhand: "dockhand", logviewr: "logviewr", mynetwork: "mynetwork",
  frigate: "frigate", opnsense: "opnsense", "pi-hole": "pihole", pihole: "pihole", portainer: "portainer", truenas: "truenas", "synology dsm": "synology", synology: "synology",
  "unifi network": "unifi", sonarr: "sonarr", radarr: "radarr", "sonarr / radarr / prowlarr…": "sonarr", tailscale: "tailscale", "tailscale / headscale": "tailscale",
  "web-check": "web-check", webcheck: "web-check", veeam: "veeam", "veeam backup & replication": "veeam",
};

/** Adresse de l'icône de la première appli reconnue qui en a une, sinon null */
export function appIcon(apps: readonly string[] | undefined): string | null {
  for (const a of apps ?? []) {
    const f = FILES[a.toLowerCase()];
    if (f) return `${import.meta.env.BASE_URL}icons/${f}.svg`;
  }
  return null;
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Icône d'après un texte libre (nom ou rôle d'une machine : « homeassistant », « Proxmox VE »…) ; null si rien ne correspond */
export function appIconByText(...texts: (string | undefined | null)[]): string | null {
  const hay = texts.filter(Boolean).map((t) => squash(t!)).join(" ");
  if (!hay) return null;
  for (const [name, file] of Object.entries(FILES)) if (hay.includes(squash(name))) return `${import.meta.env.BASE_URL}icons/${file}.svg`;
  return null;
}

const KIND_ICON: Record<string, string> = { docker: "docker", apache: "apache", nginx: "nginx" };

/** Logo du service d'une ligne : l'appli reconnue, sinon d'après le nom ou l'image (« jc21/nginx-proxy-manager »), sinon le type (Docker, Apache) ; null si aucun */
export function serviceIcon(r: { app?: { label: string } | null; service?: { name?: string; image?: string; kind?: string } | null }): string | null {
  const s = r.service;
  const kind = s?.kind && KIND_ICON[s.kind] ? `${import.meta.env.BASE_URL}icons/${KIND_ICON[s.kind]}.svg` : null;
  return appIcon(r.app ? [r.app.label] : undefined) ?? appIconByText(s?.name, s?.image) ?? kind;
}
