// Icône d'une machine : l'appli qu'elle héberge si on la reconnaît (Proxmox, Home Assistant, UniFi… d'après le scan ou le nom),
// sinon son système (relevé SSH, réglage « windows », scan, TTL du ping) ; rien si on ne sait pas.
import { Apple, Cpu, Monitor, Router, Smartphone, Terminal } from "lucide-react";
import { appIcon, appIconByText } from "../lib/appIcons";
import { osOfMachine, type OsKind } from "../lib/machines";
import type { Machine } from "../types";
import { chosenIcon } from "../lib/machineIcons";

const OS_ICON: Record<OsKind, typeof Terminal> = { linux: Terminal, windows: Monitor, macos: Apple, ios: Smartphone, network: Router, pi: Cpu };

interface Props {
  m: { name?: string; role?: string; os?: string; info?: Machine["info"]; ttl?: number | null; icon?: string | null };  // icon : choisie à la main
  /** ce que le dernier scan du réseau a vu de la machine (système probable, applis reconnues) */
  scan?: { os?: string; apps: string[]; ssh?: boolean };
  /** rien à montrer : garder la place, pour que les noms restent alignés d'une ligne à l'autre */
  reserve?: boolean;
}

export function MachineIcon({ m, scan, reserve }: Props) {
  const picked = chosenIcon(m.icon);  // choix de l'utilisateur : prioritaire sur la détection
  if (picked) {
    return "file" in picked
      ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2" title={picked.label}><img src={`${import.meta.env.BASE_URL}icons/${picked.file}.svg`} alt="" className="h-4 w-4" /></span>
      : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2 text-muted" title={picked.label}><picked.Icon size={14} aria-hidden /></span>;
  }
  const os = osOfMachine({ os: m.os, info: m.info, ttl: m.ttl }, scan?.os, scan?.ssh);
  const app = appIcon(scan?.apps) ?? appIconByText(m.name, m.role);
  if (app) return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2" title={os?.label}><img src={app} alt="" className="h-4 w-4" /></span>;
  if (!os) return reserve ? <span className="h-6 w-6 shrink-0" aria-hidden /> : null;
  const Icon = OS_ICON[os.kind];
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2 text-muted" title={os.label}><Icon size={14} aria-hidden /></span>;
}
