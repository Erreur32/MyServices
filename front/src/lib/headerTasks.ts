// Which running tasks the header shows, chosen per browser in Tasks and schedules: the collection and the network search unless told otherwise.
import { tx } from "./i18n";
import type { ScanStatus } from "./scan";
import { readFlag, useStoredFlag } from "./storedFlag";

const key = (task: string) => `ms.header.${task}`;
const byDefault = (task: string) => task === "collect" || task === "netscan";

export const inHeader = (task: string) => readFlag(key(task), byDefault(task));
export const useHeaderTask = (task: string) => useStoredFlag(key(task), byDefault(task));

/** What the header shows, most important first: the collection, the network search, then the others chosen */
export const shownTasks = (st: ScanStatus | null): string[] =>
  [...new Set([st?.running && "collect", st?.network?.running && "netscan", ...(st?.tasks ?? [])])].filter((t): t is string => !!t && inHeader(t));

export const taskTitle = (task: string): string => ({
  collect: tx("Collecte en cours"), netscan: tx("Recherche réseau en cours"), watch: tx("Veille en cours"),
  health: tx("Santé des machines en cours"), backups: tx("Sauvegardes en cours"),
})[task] ?? task;

// The theme's own tokens, so each task keeps its colour on all of them. Violet for the network search: the only one far from the blue of the collection everywhere. The bar blends two of them (.scan-<task> in index.css).
const TONE: Record<string, string> = { collect: "link", netscan: "apache", watch: "loc", health: "ok", backups: "npm" };
const tone = (task: string) => TONE[task] ?? "link";

export const taskColor = (task: string) => `rgb(var(--${tone(task)}))`;

/** The orb is drawn on a canvas and reads no CSS variable: it gets the value of the theme in use, and whether that theme is light. */
export function orbLook(task: string): { color?: string; theme: "light" | "dark" } {
  if (typeof document === "undefined") return { theme: "dark" };
  const root = document.documentElement, rgb = getComputedStyle(root).getPropertyValue(`--${tone(task)}`).trim().split(/\s+/);
  return { color: `rgb(${rgb.join(", ")})`, theme: root.classList.contains("light") ? "light" : "dark" };
}
