// The last 24 hours of the home page: events per hour (a small chart) and one row per kind of event, worst first.
import type { Event, Events, Host } from "../types";
import { GROUP_COLOR, groupOf } from "./historyChart";
import { tx } from "./i18n";

const HOUR = 3600e3, DAY = 24 * HOUR;

export interface Last24hRow { kind: string; label: string; count: number; who: string[]; keys: Record<string, string>; targets: Record<string, string>; last: number; color: string; severity: number }   // by name: what the event is about, and its target (an image, an address)
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

/** What each return to normal answers */
const CLEARS: Record<string, string[]> = {
  retabli: ["panne"], en_ligne: ["hors_ligne"], ssh_ok: ["ssh_down"], connecteur_ok: ["connecteur"], vm_marche: ["vm_arret"], stockage_ok: ["stockage"],
  health_ok: ["health_warn", "health_crit", "health_down"],
};

/** The problems still worth a look: no return to normal, no failure that a later return of the same target settled, and nothing « new » the history has
 *  already seen (a service that reappears is no news; shortcut: the history is kept for a limited time, what comes back after it reads as new again) */
function stillIssues<T extends { e: Event; t: number }>(recent: T[], events: Event[]): T[] {
  const known = (x: T) => x.e.kind === "nouveau" && !!x.e.key && events.some((e) => e.key === x.e.key && eventTime(e) < x.t);
  const settled = (x: T) => !!x.e.key && recent.some(({ e, t }) => t > x.t && e.key === x.e.key && CLEARS[e.kind]?.includes(x.e.kind));
  return recent.filter((x) => groupOf(x.e.kind) !== "retours" && !settled(x) && !known(x));
}

export function last24h(events: Event[], labels: Events["labels"], severity: Events["severity"], now: number): Last24h {
  const recent = stillIssues(events.map((e) => ({ e, t: eventTime(e) })).filter(({ t }) => Number.isFinite(t) && now - t >= 0 && now - t < DAY), events);
  const slots: string[][] = Array.from({ length: 24 }, () => []);
  for (const { e, t } of recent) slots[23 - Math.min(23, Math.floor((now - t) / HOUR))].push(e.kind);
  const byKind = new Map<string, { who: Set<string>; keys: Record<string, string>; targets: Record<string, string>; count: number; last: number }>();
  for (const { e, t } of recent) {
    const row = byKind.get(e.kind) ?? { who: new Set<string>(), keys: {}, targets: {}, count: 0, last: 0 }, name = e.label || e.machine || "?";
    row.who.add(name);
    if (e.key) row.keys[name] = e.key;
    if (e.target) row.targets[name] = e.target;
    row.count += 1;
    row.last = Math.max(row.last, t);
    byKind.set(e.kind, row);
  }
  const rows = [...byKind].map(([kind, r]): Last24hRow => ({
    kind, label: plainLabel(labels[kind] || kind), count: r.count, who: [...r.who], keys: r.keys, targets: r.targets, last: r.last, color: GROUP_COLOR[groupOf(kind)] ?? "bg-dim", severity: severity[kind] || 0,
  })).sort((a, b) => b.severity - a.severity || b.count - a.count);
  return { total: recent.length, hours: slots.map((k) => ({ n: k.length, color: dominantColor(k) })), rows };
}

/** The service an event is about: « proxy:348 » and « local:10.0.0.1:80 » name its type and its id; undefined for anything else (a machine, a connector) */
export function serviceOfEvent(hosts: Host[], key?: string): Host | undefined {
  return key ? hosts.find((r) => key === `${r.type}:${r.id}`) : undefined;
}

/** What a logo may say of a row: a domain names an application, never the Docker or Apache behind it */
export const logoOf = (r: Host) => (r.type === "local" ? r : { app: r.app, service: r.service && { ...r.service, kind: undefined } });

const IMAGE_KIND = "maj_image";

/** The service of a name of a row: by the key of its event, or, for an image to update, whose event only knows its container, by that name */
export function serviceOfRow(hosts: Host[], row: Pick<Last24hRow, "kind" | "keys">, name: string): Host | undefined {
  return serviceOfEvent(hosts, row.keys[name]) ?? (row.kind === IMAGE_KIND ? hosts.find((r) => r.service?.name === name) : undefined);
}

/** What an image to update looks like when no service is found: its container and its image, at least Docker */
export const imageService = (row: Pick<Last24hRow, "kind" | "targets">, name: string) =>
  row.kind === IMAGE_KIND ? { service: { name, image: row.targets[name], kind: "docker" } } : null;

/** « à l'instant », « il y a 12 min », « il y a 3 h » */
export function sinceText(t: number, now: number): string {
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return tx("à l'instant");
  return min < 60 ? tx("il y a {0} min", min) : tx("il y a {0} h", Math.round(min / 60));
}
