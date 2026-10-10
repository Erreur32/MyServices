// Mémoire de la carte « Premiers pas » : ouverte ou fermée, par navigateur et par clé de l'app (une installation
// remise à zéro a une autre clé : la carte se rouvre). Hors du composant : le rechargement à chaud de Vite ne
// marche que sur un fichier qui n'exporte que des composants.
const STORE = "myservices-first-steps";
const REOPEN = "myservices-first-steps-reopen";
export const REOPEN_EVENT = "myservices:first-steps";

type Saved = Record<string, "open" | "closed">;

const all = (): Saved => {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}") as Saved; } catch { return {}; }
};

export const savedState = (fp: string): Saved[string] | undefined => all()[fp];
export const saveState = (fp: string, v: "open" | "closed"): void => localStorage.setItem(STORE, JSON.stringify({ ...all(), [fp]: v }));

/** Accès à régler fermés par « Passer » / « Terminé » (par navigateur) et cadres de machines ajoutées (par onglet) */
export const DISMISSED_KEY = "myservices-network-dismissed";
export const ADDED_KEY = "myservices-network-added";
export const LATER_HIDDEN_KEY = "myservices-network-later-hidden";  // rappel « accès passés » masqué

/** Efface les choix faits dans la carte : étapes passées, accès passés, cadres de machines ouverts */
export function forgetChoices(): void {
  localStorage.removeItem(SKIPS);
  localStorage.removeItem(DISMISSED_KEY);
  localStorage.removeItem(LATER_HIDDEN_KEY);
  sessionStorage.removeItem(ADDED_KEY);
}

/** Menu du compte -> « Revoir les premiers pas » : la carte s'ouvre à l'accueil, même si elle avait été fermée,
 *  et repart de zéro (plus aucune étape ni aucun accès « passé ») */
export function reopenFirstSteps(): void {
  forgetChoices();
  localStorage.setItem(REOPEN, "1");
  location.hash = "";
  dispatchEvent(new Event(REOPEN_EVENT));
}

/** Vrai (une seule fois) si une réouverture est demandée */
export function takeReopen(): boolean {
  const asked = localStorage.getItem(REOPEN) !== null;
  localStorage.removeItem(REOPEN);
  return asked;
}

const SKIPS = "myservices-first-steps-skipped";
export type StepId = "key" | "connectors" | "network";

const allSkips = (): Record<string, StepId[]> => {
  try { return JSON.parse(localStorage.getItem(SKIPS) || "{}") as Record<string, StepId[]>; } catch { return {}; }
};

/** Étapes que l'utilisateur a choisi de passer (il les reprend quand il veut) */
export const skippedSteps = (fp: string): StepId[] => allSkips()[fp] ?? [];

export function setSkipped(fp: string, id: StepId, skipped: boolean): void {
  const now = new Set(skippedSteps(fp));
  if (skipped) now.add(id); else now.delete(id);
  localStorage.setItem(SKIPS, JSON.stringify({ ...allSkips(), [fp]: [...now] }));
}
