// Réglages : classes des champs et boutons, retour d'une action, appel d'écriture (hors composants : le
// rechargement à chaud de Vite ne marche que sur un fichier qui n'exporte que des composants).
import { LOGIN, LoginRequired } from "../api";

export const input = "w-full rounded-lg border border-line bg-bg2 px-3 py-2 text-sm text-txt outline-none placeholder:text-dim focus:border-link";
export const button = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
// Plein (fond accent, texte blanc) : on ne le confond pas avec les cadres dépliables, qui sont bordés et teintés
export const primary = `${button} border-link bg-link text-white shadow-sm hover:brightness-110`;
export const quiet = `${button} border-txt/30 bg-bg2 text-txt hover:border-link hover:bg-link/10`;
export const danger = `${button} border-bad/50 text-bad hover:bg-bad/10`;

/** Retour d'une action : message vert ou rouge sous le formulaire. */
export type Note = { ok: boolean; text: string } | null;

/** Appel d'écriture : session perdue -> page de connexion, sinon message lisible. */
export async function act(fn: () => Promise<unknown>, done: string, setNote: (n: Note) => void): Promise<boolean> {
  try {
    await fn();
    setNote({ ok: true, text: done });
    return true;
  } catch (e) {
    if (e instanceof LoginRequired) location.replace(LOGIN);
    else setNote({ ok: false, text: (e as Error).message });
    return false;
  }
}
