// Icône d'une machine : l'appli qu'elle héberge si on la reconnaît (Proxmox, Home Assistant, UniFi… d'après le scan ou le nom),
// sinon son système (relevé SSH, réglage « windows », scan, TTL du ping) ; une icône générique si on ne sait pas.
import { appIcon, appIconByText, modelIcon } from "../lib/appIcons";
import { osOfMachine } from "../lib/machines";
import { distroIcon } from "../lib/osIcon";
import type { Machine } from "../types";
import { chosenIcon } from "../lib/machineIcons";

import { GENERIC_ICON, OS_ICON } from "./OsGlyph";

interface Props {
  m: { name?: string; role?: string; os?: string; osName?: string | null; info?: Machine["info"]; os_hint?: string | null; ttl?: number | null; icon?: string | null; model?: string | null };   // osName : nom complet du système (agent, SSH) pour le logo de la distribution  // icon : choisie à la main
  /** ce que le dernier scan du réseau a vu de la machine (système probable, applis reconnues) */
  scan?: { os?: string; apps: string[]; ssh?: boolean };
  /** conservé pour les appelants ; l'icône générique garde déjà la place alignée */
  reserve?: boolean;
  /** grande icône (aperçu dans le choix d'icône de Réglages → Machines) */
  large?: boolean;
  /** rendu à la place de l'icône générique quand rien n'est reconnu (choix d'icône « Auto ») */
  empty?: React.ReactNode;
}

export function MachineIcon({ m, scan, large, empty }: Readonly<Props>) {
  const box = large ? "h-9 w-9" : "h-6 w-6", img = large ? "h-6 w-6" : "h-4 w-4", glyph = large ? 20 : 14;
  const picked = chosenIcon(m.icon);  // choix de l'utilisateur : prioritaire sur la détection
  if (picked) {
    if ("url" in picked) return <span className={`grid ${box} shrink-0 place-items-center rounded-md bg-bg2`} title={picked.label}><img src={picked.url} alt="" className={`${img} object-contain`} /></span>;
    return "file" in picked
      ? <span className={`grid ${box} shrink-0 place-items-center rounded-md bg-bg2`} title={picked.label}><img src={`${import.meta.env.BASE_URL}icons/${picked.file}.svg`} alt="" className={img} /></span>
      : <span className={`grid ${box} shrink-0 place-items-center rounded-md bg-bg2 text-muted`} title={picked.label}><picked.Icon size={glyph} aria-hidden /></span>;
  }
  const os = osOfMachine({ os: m.os, info: m.info, ttl: m.ttl }, scan?.os, scan?.ssh);
  const app = appIcon(scan?.apps) ?? modelIcon(m.model) ?? appIconByText(m.name, m.role);
  if (app) return <span className={`grid ${box} shrink-0 place-items-center rounded-md bg-bg2`} title={os?.label}><img src={app} alt="" className={img} /></span>;
  const logo = distroIcon(m.osName || m.info?.os || m.os_hint);   // logo de la distribution ou de Windows quand le nom complet est connu
  if (logo) return <span className={`grid ${box} shrink-0 place-items-center rounded-md bg-bg2`} title={m.osName || m.info?.os || m.os_hint || os?.label}><img src={logo} alt="" className={img} /></span>;
  if (!os && empty) return <>{empty}</>;
  const Icon = os ? OS_ICON[os.kind] : GENERIC_ICON;   // système inconnu : icône générique, jamais de vide
  return <span className={`grid ${box} shrink-0 place-items-center rounded-md bg-bg2 text-muted`} title={os?.label}><Icon size={glyph} aria-hidden /></span>;
}
