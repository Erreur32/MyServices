// Icônes des applis reconnues (copiées de MynetworK, public/svg) : seulement celles que le scan sait nommer.
// Les machines portent le nom lisible de l'appli (« Proxmox VE »), pas sa clé : la table part du nom.
const FILES: Record<string, string> = {
  "nginx proxy manager": "nginx-proxy-manager", "adguard home": "adguard-home", beszel: "beszel", "uptime kuma": "uptime-kuma",
  dozzle: "dozzle", apache: "apache", syncthing: "syncthing", grafana: "grafana", plex: "plex",
  "home assistant": "home-assistant", "proxmox ve": "proxmox", proxmox: "proxmox", unifi: "unifi",
};

/** Adresse de l'icône de la première appli reconnue qui en a une, sinon null */
export function appIcon(apps: readonly string[] | undefined): string | null {
  for (const a of apps ?? []) {
    const f = FILES[a.toLowerCase()];
    if (f) return `${import.meta.env.BASE_URL}icons/${f}.svg`;
  }
  return null;
}
