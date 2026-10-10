// Recherche réseau (netscan.py) côté page : état relu à chaque mise à jour de la barre du haut.
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read } from "../api";
import type { NetScan } from "../types";
import { useScan } from "./scan";

export type NetState = "idle" | "run" | "found";

export function useNetScan(): { net: NetScan | null; reload: () => void } {
  const [net, setNet] = useState<NetScan | null>(null);
  const scan = useScan();
  const reload = useCallback(() => {
    read<NetScan>("network/scan").then(setNet).catch((e) => { if (e instanceof LoginRequired) location.replace(LOGIN); });
  }, []);
  useEffect(reload, [reload]);
  const n = scan?.network;
  useEffect(() => { if (n) reload(); }, [n?.running, n?.done, n?.found, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return { net, reload };
}

export function netState(net: NetScan | null): NetState {
  return net && (net.phase === "ping" || net.phase === "identify") ? "run" : net && net.found.length ? "found" : "idle";
}

export interface Tag { label: string; kind: "ssh" | "app" | "port" }

/** Étiquettes d'une machine trouvée, sans doublon : l'appli reconnue passe avant l'indice de port qui porte le même
 *  nom (« Proxmox VE » remplace « Proxmox »), y compris dans un ancien résultat enregistré avant ce correctif. */
export function tagsOf(h: { hints: string[]; apps: string[] }): Tag[] {
  const out: Tag[] = [];
  const known = (l: string) => out.some((t) => {
    const a = t.label.toLowerCase(), b = l.toLowerCase();
    return a === b || a.startsWith(b + " ") || b.startsWith(a + " ");
  });
  for (const a of h.apps) if (!known(a)) out.push({ label: a, kind: "app" });
  for (const x of h.hints) if (!known(x)) out.push({ label: x, kind: x === "SSH" ? "ssh" : "port" });
  return out;
}

/** Machine à pré-sélectionner : répond en SSH, a une appli reconnue ou un service autre qu'une simple page web
 *  (partage, bureau à distance, Veeam…). Un objet connecté qui n'a qu'une page web ne l'est pas. */
export function interesting(h: { ssh_port?: number | null; hints: string[]; apps: string[] }): boolean {
  return !!h.ssh_port || h.apps.length > 0 || h.hints.some((x) => !x.startsWith("web") && !x.startsWith("port "));
}

/** Changements depuis la recherche d'avant : adresses nouvelles (absentes de la précédente) et disparues */
export function changes(net: { found: { ip: string }[]; previous?: string[]; gone?: string[] }): { fresh: Set<string>; gone: string[] } | null {
  if (!net.previous?.length) return null;
  const before = new Set(net.previous);
  return { fresh: new Set(net.found.filter((h) => !before.has(h.ip)).map((h) => h.ip)), gone: net.gone ?? [] };
}

/** Appareils sans aucune information (ni port reconnu, ni titre de page) : rangés à part, décochés */
export const quiet = (h: { hints: string[]; apps: string[] }): boolean => tagsOf(h).length === 0;
