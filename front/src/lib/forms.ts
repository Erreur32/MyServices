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

/** On the container of every page (App): any rounded card without a colour of its own (neutral "line" border) gets a more
 *  visible grey border; on hover its hover colour comes back. Cards with a coloured left stripe (status) are left alone. */
/** Unfolded line of a table: a full blue frame around the line and its detail (inset shadows, as borders of table rows do not
 *  draw a box). OPEN_ROW on the line (top, and the outer sides of its first and last cells), OPEN_DETAIL on the detail line. */
export const OPEN_ROW = "bg-link/5 [&>td]:shadow-[inset_0_2px_0_rgb(var(--link))] [&>td:first-child]:shadow-[inset_2px_2px_0_rgb(var(--link))] [&>td:last-child]:shadow-[inset_-2px_2px_0_rgb(var(--link))]";
export const OPEN_DETAIL = "[&>td]:shadow-[inset_2px_-2px_0_rgb(var(--link)),inset_-2px_0_0_rgb(var(--link))]";
/** Unfolded card: full blue frame (wins over GREY_CARDS) */
export const OPEN_CARD = "!border-link ring-1 ring-link";

export const GREY_CARDS = "[&_.rounded-xl.border-line:not(:hover):not(.border-l-4)]:border-dim/50 [&_.rounded-2xl.border-line:not(:hover):not(.border-l-4)]:border-dim/50";
