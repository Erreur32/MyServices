// The last 24 hours of the home page: events per hour (a small chart) and one row per kind of event, worst first.
import type { Event, Events } from "../types";
import { GROUP_COLOR, groupOf } from "./historyChart";
import { tx } from "./i18n";

const HOUR = 3600e3, DAY = 24 * HOUR;

export interface Last24hRow { kind: string; label: string; count: number; who: string[]; last: number; color: string; severity: number }
export interface Last24h { total: number; hours: { n: number; color: string }[]; rows: Last24hRow[] }

export function eventTime(e: Event): number {
  if (e.ts) return new Date(e.ts).getTime();
  return e.at ? new Date(e.at.replace(" ", "T")).getTime() : Number.NaN;
}

/** « 🔴 Panne » -> « Panne »: the page draws its own colour, the emoji of the label is dropped */
export const plainLabel = (label: string): string => label.replace(/^\p{Extended_Pictographic}️?\s*/u, "");

/** The most frequent colour of a group of events (the chart bar takes the colour of what happened most in that hour) */
function dominantColor(kinds: string[]): string {
  const count = new Map<string, number>();
  for (const k of kinds) count.set(GROUP_COLOR[groupOf(k)] ?? "bg-dim", (count.get(GROUP_COLOR[groupOf(k)] ?? "bg-dim") ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "bg-dim";
}

export function last24h(events: Event[], labels: Events["labels"], severity: Events["severity"], now: number): Last24h {
  const recent = events.map((e) => ({ e, t: eventTime(e) })).filter(({ t }) => Number.isFinite(t) && now - t >= 0 && now - t < DAY);
  const slots: string[][] = Array.from({ length: 24 }, () => []);
  for (const { e, t } of recent) slots[23 - Math.min(23, Math.floor((now - t) / HOUR))].push(e.kind);
  const byKind = new Map<string, { who: Set<string>; count: number; last: number }>();
  for (const { e, t } of recent) {
    const row = byKind.get(e.kind) ?? { who: new Set<string>(), count: 0, last: 0 };
    row.who.add(e.label || e.machine || "?");
    row.count += 1;
    row.last = Math.max(row.last, t);
    byKind.set(e.kind, row);
  }
  const rows = [...byKind].map(([kind, r]): Last24hRow => ({
    kind, label: plainLabel(labels[kind] || kind), count: r.count, who: [...r.who], last: r.last, color: GROUP_COLOR[groupOf(kind)] ?? "bg-dim", severity: severity[kind] || 0,
  })).sort((a, b) => b.severity - a.severity || b.count - a.count);
  return { total: recent.length, hours: slots.map((k) => ({ n: k.length, color: dominantColor(k) })), rows };
}

/** « à l'instant », « il y a 12 min », « il y a 3 h » */
export function sinceText(t: number, now: number): string {
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return tx("à l'instant");
  return min < 60 ? tx("il y a {0} min", min) : tx("il y a {0} h", Math.round(min / 60));
}
