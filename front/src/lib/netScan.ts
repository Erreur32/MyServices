// Recherche réseau (netscan.py) côté page : état relu à chaque mise à jour de la barre du haut.
import { useCallback, useEffect, useState } from "react";
import { LOGIN, LoginRequired, read } from "../api";
import type { NetScan } from "../types";
import { tx } from "./i18n";
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
  return net?.phase === "ping" || net?.phase === "identify" ? "run" : net?.found.length ? "found" : "idle";
}

export interface Tag { label: string; kind: "ssh" | "app" | "port" }

/** Étiquettes d'une machine trouvée, sans doublon : l'appli reconnue passe avant l'indice de port qui porte le même
 *  nom (« Proxmox VE » remplace « Proxmox »), y compris dans un ancien résultat enregistré avant ce correctif. */
/** Rôle proposé à l'ajout d'une machine trouvée par la recherche : ce qui y tourne (applis reconnues), puis ses services (SSH, partages…). Texte libre, modifiable. */
export const roleOf = (h: { hints: string[]; apps?: string[] }): string => [...new Set([...(h.apps ?? []), ...h.hints])].join(", ");

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

const osLabel = (os: string): string | undefined =>
  ({ windows: "Windows", linux: "Linux", macos: "macOS", ios: tx("iPhone / iPad"), network: tx("Matériel réseau") } as Record<string, string>)[os];

/** Système probable d'une machine (suggestion du scan) : nom et indice, sans doublon avec une étiquette déjà là (« Windows (RDP) ») */
export function osOf(h: { os?: string | null; os_how?: string | null; hints: string[] }): { label: string; how: string } | null {
  const label = h.os ? osLabel(h.os) : undefined;
  if (!label || h.hints.some((x) => x.toLowerCase().startsWith(label.toLowerCase()))) return null;
  return { label, how: h.os_how ?? "" };
}

/** Machine à pré-sélectionner : répond en SSH, a une appli reconnue ou un service autre qu'une simple page web
 *  (partage, bureau à distance, Veeam…). Un objet connecté qui n'a qu'une page web ne l'est pas. */
export function interesting(h: { ssh_port?: number | null; hints: string[]; apps: string[] }): boolean {
  return !!h.ssh_port || h.apps.length > 0 || h.hints.some((x) => !x.startsWith("web") && !x.startsWith("port "));
}

/** Machine à proposer dans l'assistant : celle qui a un SSH, une appli reconnue ou un service utile, ou dont le système probable est un vrai ordinateur
 *  (Windows, Linux, macOS) même sans rien d'ouvert. Caméras, objets connectés, téléphones et matériel réseau (système « network », « ios » ou inconnu) sont écartés. */
export function worthFollowing(h: { ssh_port?: number | null; hints: string[]; apps: string[]; os?: string | null }): boolean {
  return interesting(h) || h.os === "windows" || h.os === "linux" || h.os === "macos";
}

/** Changements depuis la recherche d'avant : adresses nouvelles (absentes de la précédente) et disparues */
export function changes(net: { found: { ip: string }[]; previous?: string[]; gone?: string[] }): { fresh: Set<string>; gone: string[] } | null {
  if (!net.previous?.length) return null;
  const before = new Set(net.previous);
  return { fresh: new Set(net.found.filter((h) => !before.has(h.ip)).map((h) => h.ip)), gone: net.gone ?? [] };
}

/** Accès encore à régler sur une machine déjà déclarée : Home Assistant sans connecteur, ou machine en SSH sans accès SSH.
 *  Déduit des données (pas de l'état du navigateur) : revient à chaque chargement jusqu'à ce que ce soit fait. */
export function needsLink(h: { ip: string; name?: string; title?: string | null; ssh_port?: number | null; apps: string[] },
                          machines: { ip: string; ssh?: unknown }[], connected: { connector: string; url?: string | null }[]): "ha" | "ssh" | null {
  if (viaMynetwork(h)) return null;  // UniFi : lu par l'API MynetworK, rien à régler ici
  if (h.apps.includes("Home Assistant"))
    return connected.some((s) => s.connector === "home-assistant" && (s.url ?? "").includes(h.ip)) ? null : "ha";
  return h.ssh_port && !machines.find((m) => m.ip === h.ip)?.ssh ? "ssh" : null;
}

/** Équipement lu plus tard par l'API MynetworK (UniFi) : SSH n'est pas nécessaire à sa surveillance, il reste possible.
 *  Reconnu par l'appli, ou, pour un ancien résultat de scan, par son nom ou le titre de sa page. */
export function viaMynetwork(h: { name?: string; title?: string | null; apps: string[] }): boolean {
  return h.apps.includes("UniFi") || /^(unifi|udm|ucg|usg)/i.test(h.name ?? "") || /unifi/i.test(h.title ?? "");
}
