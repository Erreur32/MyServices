// The exact command to give a connector its access, built from how the app was found (container name and image, or the
// folder of a web server's site): shown first in the connector's help. null when the install is not known.
import type { Host, Service } from "../types";

export interface SetupCommand { title: string; code: string }

const NEXTCLOUD_SET = "config:app:set serverinfo token --value \"$TOKEN\"";

function nextcloud(svc: Service): SetupCommand | null {
  const name = svc.name ?? "", image = (svc.image ?? "").toLowerCase();
  const wrap = (title: string, occ: string) => ({ title, code: `TOKEN=$(openssl rand -hex 32)\n${occ} ${NEXTCLOUD_SET}\necho "$TOKEN"` });
  if (svc.kind === "docker" && name) {
    if (image.includes("linuxserver")) return wrap(`conteneur « ${name} » (image linuxserver.io)`, `docker exec ${name} occ`);
    if (image.includes("aio")) return wrap(`conteneur « ${name} » (Nextcloud All-in-One)`, `docker exec -u www-data ${name} php occ`);
    return wrap(`conteneur « ${name} »`, `docker exec -u www-data ${name} php occ`);
  }
  if (svc.docroot) {   // a web server's site (Apache, nginx): occ is in its folder, run as the owner of config.php
    const dir = svc.docroot.replace(/\/+$/, "");
    return wrap(`installé sans Docker dans ${dir}`, `sudo -u "$(stat -c %U ${dir}/config/config.php)" php ${dir}/occ`);
  }
  return null;
}

const BUILDERS: Record<string, (svc: Service) => SetupCommand | null> = { nextcloud };

export function setupCommand(connector: string, svc?: Service | null): SetupCommand | null {
  return svc && Object.hasOwn(BUILDERS, connector) ? BUILDERS[connector](svc) : null;
}

/** The app found at the address typed in the connector (same IP and port), when the collection saw it: its service */
export function serviceAt(url: unknown, hosts: Host[], connector: string): Service | undefined {
  let ip = "", port = 0;
  try {
    const u = new URL(String(url ?? ""));
    ip = u.hostname;
    port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  } catch {
    return undefined;
  }
  const same = hosts.filter((h) => h.ip === ip && h.port === port && h.service);
  return (same.find((h) => h.app?.connector === connector) ?? same[0])?.service;
}
