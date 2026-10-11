// Recherche et filtres en pastilles, communs à tous les onglets. Une facette = une question (« État »,
// « Machine »…) ; plusieurs pastilles d'une même facette = OU, facettes entre elles = ET. Le compte de
// chaque pastille est calculé sur les résultats des AUTRES filtres (on voit ce qu'un clic donnerait).
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { norm } from "./format";

export interface Facet<T> {
  key: string;
  label: string;
  /** Valeur(s) de l'élément pour cette facette ; "" ou [] = sans valeur (jamais compté) */
  get: (item: T) => string | string[];
  /** Libellé d'une valeur (défaut : la valeur) */
  name?: (v: string) => string;
  /** Ordre fixe des valeurs ; sinon par nombre décroissant */
  order?: string[];
  /** Repère visuel devant la pastille d'une valeur : point de couleur, logo ou icône du service */
  mark?: (v: string) => ReactNode;
}

export interface Chip {
  value: string;
  label: string;
  count: number;
  on: boolean;
}

export type Selected = Record<string, string[]>;

function values<T>(f: Facet<T>, item: T): string[] {
  const v = f.get(item);
  return (Array.isArray(v) ? v : [v]).filter(Boolean);
}

function matches<T>(item: T, facets: Facet<T>[], sel: Selected, skip?: string): boolean {
  return facets.every((f) => f.key === skip || !sel[f.key]?.length || values(f, item).some((v) => sel[f.key].includes(v)));
}

/** Recherche : tous les mots doivent apparaître dans le texte de l'élément (sans accents ni casse). */
export function searchHit(text: string, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(text);
  return words.every((w) => hay.includes(w));
}

export function useFilter<T>(items: T[], facets: Facet<T>[], text: (item: T) => string, initial: Selected = {}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Selected>(initial);

  const found = useMemo(() => items.filter((it) => searchHit(text(it), query)), [items, query, text]);
  const shown = useMemo(() => found.filter((it) => matches(it, facets, sel)), [found, facets, sel]);

  const chips = useMemo(() => facets.map((f) => {
    const counts = new Map<string, number>();
    for (const it of found) if (matches(it, facets, sel, f.key)) for (const v of values(f, it)) counts.set(v, (counts.get(v) || 0) + 1);
    for (const v of sel[f.key] || []) if (!counts.has(v)) counts.set(v, 0);  // pastille active gardée même à 0
    const keys = f.order ? f.order.filter((v) => counts.has(v)) : [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
    return { facet: f, chips: keys.map((v): Chip => ({ value: v, label: f.name ? f.name(v) : v, count: counts.get(v)!, on: !!sel[f.key]?.includes(v) })) };
  }), [found, facets, sel]);

  const toggle = (key: string, value: string) => setSel((s) => {
    const cur = s[key] || [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    const out = { ...s, [key]: next };
    if (!next.length) delete out[key];
    return out;
  });
  const only = (key: string, value: string) => setSel({ [key]: [value] });
  const reset = () => { setSel({}); setQuery(""); };
  const active = Object.values(sel).reduce((n, v) => n + v.length, 0) + (query.trim() ? 1 : 0);

  return { query, setQuery, shown, total: items.length, chips, toggle, only, reset, active, sel };
}

/** Tri par colonne : clic = trier, 2e clic = ordre inverse. */
export function useSort<T>(rows: T[], keyOf: (row: T, key: string) => string | number, initial: string) {
  const [key, setKey] = useState(initial);
  const [asc, setAsc] = useState(true);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = keyOf(a, key), y = keyOf(b, key);
    return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
  }), [rows, key, asc, keyOf]);
  const by = (k: string) => { if (k === key) setAsc(!asc); else { setKey(k); setAsc(true); } };
  return { sorted, key, asc, by };
}
