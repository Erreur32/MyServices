// History › Events: the figures on top of the chosen period (and of the search and chips, as the chart): how many events and per day,
// outages, serious ones, returns to normal, and the machine with the most events.
import type { StoredEvent } from "../types";
import { groupOf } from "./historyChart";

export interface PeriodFigures { total: number; perDay: number; outages: number; serious: number; back: number; top: { machine: string; n: number } | null }

/** severity: level of each event kind (0 to 3, 3 = serious), as the page's « Severity » chip */
export function periodFigures(events: StoredEvent[], days: number, severity: Record<string, number>): PeriodFigures {
  const by = new Map<string, number>();
  let outages = 0, serious = 0, back = 0;
  for (const e of events) {
    const g = groupOf(e.kind);
    if (g === "services" || g === "machines") outages++;
    if (g === "retours") back++;
    if ((severity[e.kind] ?? 0) >= 3) serious++;
    if (e.machine) by.set(e.machine, (by.get(e.machine) ?? 0) + 1);
  }
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { total: events.length, perDay: Math.round((events.length / Math.max(1, days)) * 10) / 10, outages, serious, back, top: top ? { machine: top[0], n: top[1] } : null };
}
