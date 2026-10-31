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

const POINT_KEY = "myservices-connectors-pointed";

/** What a page's connector button points at: its connector types, or its category */
export interface Pointed { types: string[]; category: string }

export function pointConnectors(types: string[] = [], category = ""): void {
  try { sessionStorage.setItem(POINT_KEY, JSON.stringify({ types, category })); } catch { /* navigation privée : tant pis */ }
}

/** Read once, like the two others */
export function takePointed(): Pointed {
  try { const v = sessionStorage.getItem(POINT_KEY); sessionStorage.removeItem(POINT_KEY); return v ? (JSON.parse(v) as Pointed) : { types: [], category: "" }; } catch { return { types: [], category: "" }; }
}

/** The instances a button points at: one is opened for editing, several are listed */
export function pointedHits<I extends { type: string }>(instances: I[], categories: { type: string; category?: string }[], p: Pointed): I[] {
  const of = (type: string) => categories.find((t) => t.type === type)?.category;
  return instances.filter((i) => p.types.includes(i.type) || (!!p.category && of(i.type) === p.category));
}

export function takePrefill(): Prefill | null {
  const raw = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  try { return raw ? (JSON.parse(raw) as Prefill) : null; } catch { return null; }
}
