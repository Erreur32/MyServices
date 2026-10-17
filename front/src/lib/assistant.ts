// Assistant de démarrage : les étapes et ce que l'utilisateur en a fait (faite, passée), gardé par le navigateur.
// Hors du composant : le rechargement à chaud de Vite ne marche que sur un fichier qui n'exporte que des composants.
import { tx } from "./i18n";
import type { Machine } from "../types";

export type AssistantStep = "welcome" | "machine" | "network" | "access" | "tools" | "alerts";

/** ready : l'étape existe vraiment ; sinon la page annonce qu'elle arrive et laisse passer */
export const STEPS: { id: AssistantStep; title: string; ready: boolean }[] = [
  { id: "welcome", title: tx("Bienvenue"), ready: true },
  { id: "machine", title: tx("Cette machine"), ready: true },
  { id: "network", title: tx("Le réseau"), ready: true },
  { id: "access", title: tx("Lire chaque machine"), ready: true },
  { id: "tools", title: tx("Relier vos outils"), ready: true },
  { id: "alerts", title: tx("Être prévenu"), ready: true },
];

export interface AssistantProgress { current: AssistantStep; done: AssistantStep[]; skipped: AssistantStep[]; host: string; accepted: string[] }   // accepted : machines gardées avec leur méthode actuelle

const KEY = "myservices-assistant";
const EMPTY: AssistantProgress = { current: "welcome", done: [], skipped: [], host: "", accepted: [] };

/** Progression propre depuis n'importe quelle valeur (navigateur ou serveur, ancienne ou nouvelle version) : tous les champs existent toujours,
 *  car la page s'appuie dessus (un champ absent ferait planter l'assistant). */
export function normalizeProgress(raw: unknown): AssistantProgress {
  const got = (raw && typeof raw === "object" ? raw : {}) as Partial<AssistantProgress>;
  const ids: string[] = STEPS.map((s) => s.id), list = (v: unknown) => (Array.isArray(v) ? v : []);
  if (!ids.includes(got.current as string)) return EMPTY;
  return { current: got.current as AssistantStep, done: list(got.done).filter((i) => ids.includes(i)), skipped: list(got.skipped).filter((i) => ids.includes(i)),
    host: typeof got.host === "string" ? got.host : "", accepted: list(got.accepted).filter((a) => typeof a === "string") };
}

export function loadProgress(): AssistantProgress {
  try { return normalizeProgress(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return EMPTY; }
}

export function saveProgress(p: AssistantProgress): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* navigation privée : tant pis, l'assistant repart du début */ }
}

export function resetProgress(): void {
  try { localStorage.removeItem(KEY); } catch { /* idem */ }
}

/** La machine qui héberge MyServices, sans jamais en deviner une au hasard. Dans l'ordre : celle que l'utilisateur a désignée, celle marquée « locale »,
 *  celle dont l'adresse est celle de la page (on ouvre MyServices par l'adresse de sa machine), celle que MyServices a lui-même atteinte par l'alias
 *  « hote » (créé pour son hôte). Aucune ne correspond : undefined (la page demande alors de la désigner). */
export function thisMachine(machines: Machine[], hostname: string, chosen = ""): Machine | undefined {
  return machines.find((m) => chosen && m.ip === chosen) ?? machines.find((m) => m.local) ?? machines.find((m) => m.ip === hostname)
    ?? machines.find((m) => m.ssh?.alias === "hote");
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

/** Toutes les étapes faites ou passées */
export const isFinished = (p: Pick<AssistantProgress, "done" | "skipped"> | null): boolean => !!p && STEPS.every((s) => p.done.includes(s.id) || p.skipped.includes(s.id));

/** Marque l'étape faite (ou passée) et avance */
export function advance(p: AssistantProgress, how: "done" | "skipped"): AssistantProgress {
  const rest = (l: AssistantStep[]) => l.filter((i) => i !== p.current);
  return { ...p, current: nextStep(p.current), done: how === "done" ? [...rest(p.done), p.current] : rest(p.done), skipped: how === "skipped" ? [...rest(p.skipped), p.current] : rest(p.skipped) };
}
