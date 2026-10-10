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

/** Accès encore à régler sur une machine déjà déclarée : Home Assistant sans connecteur, ou machine en SSH sans accès SSH.
 *  Déduit des données (pas de l'état du navigateur) : revient à chaque chargement jusqu'à ce que ce soit fait. */
export function needsLink(h: { ip: string; name?: string; title?: string | null; ssh_port?: number | null; apps: string[] },
                          machines: { ip: string; ssh?: unknown }[], connected: { connector: string; url?: string | null }[]): "ha" | "ssh" | null {
  if (viaMynetwork(h)) return null;  // UniFi : lu par l'API MynetworK, rien à régler ici
  if (h.apps.includes("Home Assistant"))
    return connected.some((s) => s.connector === "home-assistant" && (s.url ?? "").includes(h.ip)) ? null : "ha";
  return h.ssh_port && !machines.find((m) => m.ip === h.ip)?.ssh ? "ssh" : null;
}

export interface NetSummary {
  total: number;      // appareils qui ont répondu
  known: number;      // déjà ajoutés à MyServices
  candidates: number; // les autres : à ajouter ou non
  watch: number;      // à regarder (liste principale)
  ssh: number;
  apps: number;
  shares: number;     // partages (SMB), bureau à distance, Veeam…
  webOnly: number;    // replié : page web seule (caméras, box, objets connectés…)
  pingOnly: number;   // replié : répond au ping seulement
}

type Seen = { ip: string; ssh_port?: number | null; hints: string[]; apps: string[] };

/** Résultat d'un scan en chiffres. « À regarder » = SSH, appli reconnue ou service utile ; le reste est replié. */
export function summarize(found: Seen[], known: string[]): NetSummary {
  const cand = found.filter((h) => !known.includes(h.ip));
  const watch = cand.filter(interesting);
  const rest = cand.filter((h) => !interesting(h));
  return {
    total: found.length, known: found.length - cand.length, candidates: cand.length, watch: watch.length,
    ssh: watch.filter((h) => !!h.ssh_port).length, apps: watch.filter((h) => h.apps.length > 0).length,
    shares: watch.filter((h) => h.hints.some((x) => x === "partage SMB" || x.startsWith("Windows") || x.startsWith("Veeam"))).length,
    webOnly: rest.filter((h) => !quiet(h)).length, pingOnly: rest.filter(quiet).length,
  };
}

/** Équipement lu plus tard par l'API MynetworK (UniFi) : SSH n'est pas nécessaire à sa surveillance, il reste possible.
 *  Reconnu par l'appli, ou, pour un ancien résultat de scan, par son nom ou le titre de sa page. */
export function viaMynetwork(h: { name?: string; title?: string | null; apps: string[] }): boolean {
  return h.apps.includes("UniFi") || /^(unifi|udm|ucg|usg)/i.test(h.name ?? "") || /unifi/i.test(h.title ?? "");
}
