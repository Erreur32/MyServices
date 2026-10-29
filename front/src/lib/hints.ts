// The information frames (InfoNote) a user has hidden, remembered in this browser only: the id of a frame is a short hash of its text, so a
// frame stays hidden across visits and a changed text shows again. A caution (tone warn) is never hidden.
import { useSyncExternalStore, type ReactNode } from "react";

const KEY = "myservices.hints.hidden";
const listeners = new Set<() => void>();

function read(): string[] {
  try { const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
let cache = read().join(",");   // useSyncExternalStore wants a value that is the same until something changes
const emit = () => { cache = read().join(","); listeners.forEach((l) => l()); };
function write(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* navigation privée : masqué jusqu'au rechargement seulement */ }
  emit();
}

/** The text of a React node (strings and numbers, through elements), to name a frame by what it says */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props ? textOf(props.children) : "";
}

/** A short stable id for a text (djb2) */
export function hintId(text: string): string {
  let h = 5381;
  for (const c of text.trim().slice(0, 200)) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const hiddenIds = (): string[] => (cache ? cache.split(",") : []);

export function hideHint(id: string) { write([...new Set([...read(), id])]); }
export function showAllHints() { write([]); }

/** Is this frame hidden, and how many are hidden in all */
export function useHints(id: string): { hidden: boolean; count: number } {
  const snapshot = useSyncExternalStore(subscribe, () => cache, () => "");
  const ids = snapshot ? snapshot.split(",") : [];
  return { hidden: ids.includes(id), count: ids.length };
}

export const hiddenHintCount = (): number => hiddenIds().length;
