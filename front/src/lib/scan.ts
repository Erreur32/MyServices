// État du passage de collecte en cours, partagé entre la barre du haut (ScanBar, qui interroge le serveur)
// et les étapes de « Premiers pas » : une seule interrogation, lue par plusieurs composants.
import { useSyncExternalStore } from "react";
import { send } from "../api";

export interface NetworkSummary { running: boolean; phase: string; done: number; total: number; up: number; described: number; found: number }

export interface ScanStatus {
  running: boolean;
  network?: NetworkSummary;
  progress: { step: number; steps: number; label: string; done: number | null; total: number | null } | null;
}

let current: ScanStatus | null = null;
let poller: (() => void) | null = null;
const subs = new Set<() => void>();

export function setScan(s: ScanStatus | null): void {
  current = s;
  subs.forEach((f) => f());
}

/** ScanBar enregistre sa fonction d'interrogation ; renvoie le retrait */
export function registerPoller(f: () => void): () => void {
  poller = f;
  return () => { if (poller === f) poller = null; };
}

/** Interroger tout de suite (après avoir lancé un passage) au lieu d'attendre le prochain tour */
export function pokeScan(): void {
  poller?.();
}

/** Après l'ajout ou la réparation d'accès de machines : une seule machine est relue seule (collecte + santé, route
 *  /refresh) ; plusieurs, un passage complet (un seul passage à la fois côté serveur, la route refuserait les suivantes). */
export async function rereadMachines(ips: string[]): Promise<void> {
  if (ips.length === 1) await send("POST", `machines/settings/${ips[0]}/refresh`);
  else if (ips.length > 1) await send("POST", "system/tasks/collect/run");
  pokeScan();
}

export function useScan(): ScanStatus | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
}
