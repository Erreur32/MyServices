// Passage de « Premiers pas » vers Réglages -> Connecteurs : le connecteur proposé s'y ouvre déjà rempli
// (type, nom, adresse trouvée). Lu une seule fois par l'onglet Connecteurs.
const KEY = "myservices-connector-prefill";

export interface Prefill { type: string; name: string; url: string }

export function openConnector(p: Prefill): void {
  sessionStorage.setItem(KEY, JSON.stringify(p));
  location.hash = "settings/connectors";
}

export function takePrefill(): Prefill | null {
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  try { return raw ? (JSON.parse(raw) as Prefill) : null; } catch { return null; }
}
