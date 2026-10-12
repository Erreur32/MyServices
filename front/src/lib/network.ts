// Réseau : ce qui alimente l'onglet, et quand il s'affiche (hors composant : lib/tabs.ts et Santé s'en servent aussi).
import type { Snapshot } from "../api";

/** Status cards shown in the Network tab rather than in Health */
export const NETWORK_CARDS = ["freebox", "unifi", "opnsense", "netalertx", "speedtest-tracker", "tailscale"];

/** Something to show: a network source that answers (or answered: stale), or devices already found */
export function hasNetwork(s: Snapshot): boolean {
  return (s.data.network ?? []).some((c) => (c.devices?.length ?? 0) > 0 || !!c.unifi)
    || (s.data.services_status ?? []).some((c) => NETWORK_CARDS.includes(c.connector) && (c.ok || c.stale));
}
