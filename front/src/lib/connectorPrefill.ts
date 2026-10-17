// Passage de « Premiers pas » vers Réglages -> Connecteurs : le connecteur proposé s'y ouvre déjà rempli
// (type, nom, adresse trouvée). Lu une seule fois par l'onglet Connecteurs.
const KEY = "myservices-connector-prefill";

export interface Prefill { type: string; name: string; url: string }

export function openConnector(p: Prefill): void {
  sessionStorage.setItem(KEY, JSON.stringify(p));
  location.hash = "settings/connectors";
}

// Connecteur à mettre en évidence (cadre bleu, défilement jusqu'à sa carte) : « Réglages → Agents » y envoie depuis une machine lue par un connecteur
const FOCUS_KEY = "myservices-connector-focus";

export function focusConnector(type: string, name: string): void {
  try { sessionStorage.setItem(FOCUS_KEY, `${type}/${name}`); } catch { /* navigation privée : tant pis */ }
}

/** « type/nom » du connecteur à montrer, lu une seule fois */
export function takeFocus(): string {
  try { const v = sessionStorage.getItem(FOCUS_KEY) || ""; sessionStorage.removeItem(FOCUS_KEY); return v; } catch { return ""; }
}

export function takePrefill(): Prefill | null {
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  try { return raw ? (JSON.parse(raw) as Prefill) : null; } catch { return null; }
}
