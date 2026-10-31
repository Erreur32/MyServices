// Historique : familles d'événements, découpage du temps pour les graphiques (barres, courbe, points, chaleur) et styles proposés.
import { dayKey } from "./format";
import { tx } from "./i18n";

export type ChartStyle = "points" | "bars" | "area" | "heat";

export const STYLES: [ChartStyle, string][] = [
  ["points", tx("Points")], ["bars", tx("Barres")], ["area", tx("Courbe")], ["heat", tx("Chaleur")],
];

/** Événements affichés au plus (api events?limit=) : au-delà, les points ne montrent que les plus récents */
export const EVENT_LIMIT = 5000;

// Familles d'événements (même regroupement que l'accueil) et leur couleur
const GROUP: Record<string, string> = {
  panne: "services", retabli: "retours", unhealthy: "services", connecteur: "services", connecteur_version: "services", connecteur_ok: "retours",
  hors_ligne: "machines", en_ligne: "retours", ssh_down: "machines", ssh_ok: "retours",
  nouveau: "inventaire", disparu: "inventaire", appareil: "inventaire", securite: "securite", menace: "securite", jail_hausse: "securite", maj_image: "inventaire", ui_hors: "securite", dns: "securite", perime: "veille",
  vm_arret: "machines", vm_marche: "retours", stockage: "machines", stockage_ok: "retours",
  health_ok: "retours", health_warn: "sante", health_crit: "sante", health_down: "sante",
};
export const GROUPS: [string, string, string][] = [
  ["services", tx("Pannes de services"), "bg-bad"], ["machines", tx("Machines / SSH"), "bg-warn"], ["sante", tx("Santé des machines"), "bg-apache"],
  ["securite", tx("Sécurité / DNS"), "bg-npm"], ["inventaire", tx("Nouveaux / disparus"), "bg-loc"], ["retours", tx("Retours à la normale"), "bg-ok"],
  ["veille", "Veille", "bg-dim"],
];
export const GROUP_NAME: Record<string, string> = Object.fromEntries(GROUPS.map(([k, l]) => [k, l]));
export const GROUP_COLOR: Record<string, string> = Object.fromEntries(GROUPS.map(([k, , c]) => [k, c]));
/** Même couleur pour le SVG (courbe) : variables CSS du thème */
export const GROUP_FILL: Record<string, string> = Object.fromEntries(
  Object.entries({ services: "bad", machines: "warn", sante: "apache", securite: "npm", inventaire: "loc", retours: "ok", veille: "dim" }).map(([k, v]) => [k, `rgb(var(--${v}))`]));
export const groupOf = (kind: string): string => GROUP[kind] || "veille";

export interface Bucket { start: number; end: number; total: number; parts: Record<string, number> }
export interface Point { ts: number; kind: string }

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

/** Pas d'un barreau selon la période : une cinquantaine à une centaine de barres, à l'heure près sur les courtes périodes */
export function stepFor(days: number): number {
  return days <= 1 ? 30 * MIN : days <= 7 ? 2 * HOUR : days <= 30 ? 6 * HOUR : days <= 90 ? DAY : 3 * DAY;
}

/** Barreaux réguliers de `from` à `to` (ms), chacun avec le nombre d'événements par famille ; `at` : événements (ts en secondes) */
export function buckets(at: Point[], from: number, to: number, step: number): Bucket[] {
  const n = Math.max(1, Math.ceil((to - from) / step));
  const out: Bucket[] = Array.from({ length: n }, (_, i) => ({ start: from + i * step, end: from + (i + 1) * step, total: 0, parts: {} }));
  for (const e of at) {
    const i = Math.floor((e.ts * 1000 - from) / step);
    if (i < 0 || i >= n) continue;
    const g = groupOf(e.kind);
    out[i].parts[g] = (out[i].parts[g] || 0) + 1;
    out[i].total++;
  }
  return out;
}

/** Comptes par jour (api events/per-day) répartis en barreaux d'un jour, jours vides compris : repli quand les événements sont tronqués */
export function dayBuckets(perDay: { day: string; kind: string; n: number }[], days: number, now: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = now - i * DAY;
    out.push({ start: new Date(dayKey(t) + "T00:00").getTime(), end: new Date(dayKey(t) + "T00:00").getTime() + DAY, total: 0, parts: {} });
  }
  const byDay = new Map(out.map((b) => [dayKey(b.start), b]));
  for (const r of perDay) {
    const b = byDay.get(r.day);
    if (!b) continue;
    const g = groupOf(r.kind);
    b.parts[g] = (b.parts[g] || 0) + r.n;
    b.total += r.n;
  }
  return out;
}

/** Jour de la semaine (0 = lundi) × heure : nombre d'événements, pour la carte de chaleur */
export function heat(at: Point[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const e of at) {
    const d = new Date(e.ts * 1000);
    grid[(d.getDay() + 6) % 7][d.getHours()]++;
  }
  return grid;
}

/** Sommet « rond » de l'axe vertical (1, 2, 5 × 10ⁿ) au moins égal au plus grand nombre d'événements, et ses repères (0 compris) */
export function yScale(max: number, parts = 4): { top: number; ticks: number[] } {
  const m = Math.max(1, max), pow = Math.max(1, 10 ** Math.floor(Math.log10(m / parts)));  // des nombres entiers d'événements
  const unit = [1, 2, 5, 10].map((k) => k * pow).find((u) => u * parts >= m)!;
  const top = Math.ceil(m / unit) * unit;
  return { top, ticks: Array.from({ length: top / unit + 1 }, (_, i) => i * unit) };
}

/** Repères réguliers de l'axe du temps : n+1 instants de `from` à `to` */
export function ticks(from: number, to: number, n = 6): number[] {
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}
