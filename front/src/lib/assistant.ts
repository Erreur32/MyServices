// Assistant de démarrage : les étapes et ce que l'utilisateur en a fait (faite, passée), gardé par le navigateur.
// Hors du composant : le rechargement à chaud de Vite ne marche que sur un fichier qui n'exporte que des composants.
import { tx } from "./i18n";

export type AssistantStep = "welcome" | "machine" | "network" | "access" | "tools" | "alerts";

/** ready : l'étape existe vraiment ; sinon la page annonce qu'elle arrive et laisse passer */
export const STEPS: { id: AssistantStep; title: string; ready: boolean }[] = [
  { id: "welcome", title: tx("Bienvenue"), ready: true },
  { id: "machine", title: tx("Cette machine"), ready: true },
  { id: "network", title: tx("Le réseau"), ready: false },
  { id: "access", title: tx("Lire chaque machine"), ready: false },
  { id: "tools", title: tx("Relier vos outils"), ready: false },
  { id: "alerts", title: tx("Être prévenu"), ready: false },
];

export interface AssistantProgress { current: AssistantStep; done: AssistantStep[]; skipped: AssistantStep[] }

const KEY = "myservices-assistant";
const EMPTY: AssistantProgress = { current: "welcome", done: [], skipped: [] };

export function loadProgress(): AssistantProgress {
  try {
    const got = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<AssistantProgress> | null;
    const ids = STEPS.map((s) => s.id);
    if (!got || !ids.includes(got.current as AssistantStep)) return EMPTY;
    return { current: got.current as AssistantStep, done: (got.done ?? []).filter((i) => ids.includes(i)), skipped: (got.skipped ?? []).filter((i) => ids.includes(i)) };
  } catch { return EMPTY; }
}

export function saveProgress(p: AssistantProgress): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* navigation privée : tant pis, l'assistant repart du début */ }
}

export function resetProgress(): void {
  try { localStorage.removeItem(KEY); } catch { /* idem */ }
}

/** L'étape après `id` (la dernière reste la dernière) */
export function nextStep(id: AssistantStep): AssistantStep {
  const i = STEPS.findIndex((s) => s.id === id);
  return STEPS[Math.min(i + 1, STEPS.length - 1)].id;
}

export function previousStep(id: AssistantStep): AssistantStep {
  const i = STEPS.findIndex((s) => s.id === id);
  return STEPS[Math.max(i - 1, 0)].id;
}

/** Marque l'étape faite (ou passée) et avance */
export function advance(p: AssistantProgress, how: "done" | "skipped"): AssistantProgress {
  const rest = (l: AssistantStep[]) => l.filter((i) => i !== p.current);
  return { current: nextStep(p.current), done: how === "done" ? [...rest(p.done), p.current] : rest(p.done), skipped: how === "skipped" ? [...rest(p.skipped), p.current] : rest(p.skipped) };
}
