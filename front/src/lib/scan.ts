// État du passage de collecte en cours, partagé entre la barre du haut (ScanBar, qui interroge le serveur)
// et les étapes de « Premiers pas » : une seule interrogation, lue par plusieurs composants.
import { useSyncExternalStore } from "react";
import { send } from "../api";

export interface NetworkSummary { running: boolean; phase: string; done: number; total: number; up: number; described: number; found: number }

export interface ScanStatus {
  running: boolean;
  network?: NetworkSummary;
  progress: { step: number; steps: number; label: string; done: number | null; total: number | null } | null;
  tasks?: string[];   // the other scheduled tasks running now
}

const MIN_SHOWN_MS = 4_000;   // a task of a second would only flash in the header

let current: ScanStatus | null = null, latest: ScanStatus | null = null;
const shownSince = new Map<string, number>();
let hold: ReturnType<typeof setTimeout> | undefined;
let poller: (() => void) | null = null;
const subs = new Set<() => void>();

/** The running tasks, plus those just over that have not been shown long enough; asks to look again once they have */
function heldTasks(running: string[]): string[] {
  const now = Date.now();
  running.forEach((t) => { if (!shownSince.has(t)) shownSince.set(t, now); });
  for (const [t, since] of shownSince) if (!running.includes(t) && now - since >= MIN_SHOWN_MS) shownSince.delete(t);
  clearTimeout(hold);
  if (shownSince.size > running.length) hold = setTimeout(() => setScan(latest), 1_000);
  return [...shownSince.keys()];
}

export function setScan(s: ScanStatus | null): void {
  latest = s;
  current = s && { ...s, tasks: heldTasks(s.tasks ?? []) };
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
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => current);   // the last one: the state when rendered without a browser (tests)
}
