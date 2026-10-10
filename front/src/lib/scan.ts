// État du passage de collecte en cours, partagé entre la barre du haut (ScanBar, qui interroge le serveur)
// et les étapes de « Premiers pas » : une seule interrogation, lue par plusieurs composants.
import { useSyncExternalStore } from "react";

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

export function useScan(): ScanStatus | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
}
