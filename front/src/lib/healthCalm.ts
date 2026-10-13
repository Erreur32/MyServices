// Health « only when something is wrong »: machines in good health are hidden by default (choice kept in the browser),
// a one-line summary on top says how many there are and which ones need a look.
const KEY = "ms.health.calm";

export const worrying = (level: string) => level === "down" || level === "crit" || level === "warn";

export function savedCalm(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function saveCalm(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage refused: the choice lasts this visit */ }
}
