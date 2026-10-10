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

/** Menu du compte -> « Revoir les premiers pas » : la carte s'ouvre à l'accueil, même si elle avait été fermée */
export function reopenFirstSteps(): void {
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
