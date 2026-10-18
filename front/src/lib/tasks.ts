// Tâches planifiées (collecte, veille, santé, sauvegardes) telles que les rend GET /api/v1/tasks, et leur texte pour l'en-tête.
import { hm } from "./format";
import { tx } from "./i18n";

export interface TaskInfo {
  label: string; at?: string; next: number | null; minutes?: number[]; hours?: number[] | null; every_h?: number; enabled: boolean;
  running: boolean; started: number | null; ended: number | null; result: string | null;
}

const SHORT: Record<string, string> = { collect: "Collecte", watch: "Veille", health: "Santé", backups: "Sauvegardes", netscan: "Réseau" };
const pad = (n: number) => String(n).padStart(2, "0");

const elapsed = (s: number) => (s < 60 ? tx("{0} s", s) : tx("{0} min {1} s", Math.floor(s / 60), pad(s % 60)));

export const shortName = (name: string, t: TaskInfo): string => (SHORT[name] ? tx(SHORT[name]) : t.label);

/** Période en clair : « toutes les heures, à :10 et :40 » ou « à 07:05, 19:05 » */
export function period(t: Pick<TaskInfo, "minutes" | "hours" | "every_h">): string {
  const minutes = t.minutes ?? [];
  if (t.every_h !== undefined) return tx("toutes les {0} h", t.every_h);
  if (!t.hours) return tx("toutes les heures, à {0}", minutes.map((m) => `:${pad(m)}`).join(", "));
  return tx("à {0}", t.hours.flatMap((h) => minutes.map((m) => `${pad(h)}:${pad(m)}`)).join(", "));
}

/** « minutes heures » as the server reads it (server.parse_at): minutes 0-59, hours 0-23 or « * »; null when invalid */
export function parseAt(spec: string): { minutes: number[]; hours: number[] | null } | null {
  const [m = "", h = "", ...rest] = spec.trim().split(/\s+/);
  const list = (x: string) => (/^\d+(,\d+)*$/.test(x) ? [...new Set(x.split(",").map(Number))].sort((a, b) => a - b) : null);
  const minutes = list(m), hours = h === "" || h === "*" ? null : list(h);
  if (rest.length || !minutes || minutes.some((x) => x > 59) || (h !== "" && h !== "*" && (!hours || hours.some((x) => x > 23)))) return null;
  return { minutes, hours };
}

/** Ligne vivante d'une tâche active : en cours depuis…, ou heure du prochain passage et compte à rebours ; `now` en millisecondes */
export function liveText(t: Pick<TaskInfo, "running" | "started" | "next">, now: number): string {
  if (t.running) return tx("en cours depuis {0}", elapsed(Math.max(0, Math.round(now / 1000 - (t.started ?? now / 1000)))));
  if (t.next === null) return tx("pas d'horaire");
  const min = Math.ceil((t.next * 1000 - now) / 60000);
  return tx("{0} ({1})", hm(t.next * 1000), min <= 1 ? tx("dans moins d'une minute") : tx("dans {0} min", min));
}

/** Détail au survol : période et dernier passage */
export function detail(t: TaskInfo): string {
  const last = t.ended ? tx("dernier passage {0} : {1}", hm(t.ended * 1000), t.result ?? "?") : tx("pas encore passé depuis le démarrage");
  return `${t.label} · ${period(t)} · ${last}`;
}

export type RunState = "running" | "failed" | "ok" | "disabled" | "idle";

/** One state per task for the badge and the row style: a task that is off stays "disabled" whatever its last result was */
export function runState(t: { enabled: boolean; running: boolean; result: string | null }): RunState {
  if (t.running) return "running";
  if (!t.enabled) return "disabled";
  if (t.result === "success") return "ok";
  return t.result ? "failed" : "idle";
}

export interface TasksSummary { enabled: number; running: number; failed: number; next: { name: string; at: number } | null }

/** Counts for the page header and the soonest next run (epoch seconds) among the enabled tasks that are not running */
export function summarize(items: { name: string; enabled: boolean; running: boolean; result: string | null; next?: number | null }[]): TasksSummary {
  const out: TasksSummary = { enabled: 0, running: 0, failed: 0, next: null };
  for (const t of items) {
    const state = runState(t);
    if (t.enabled) out.enabled++;
    if (state === "running") out.running++;
    if (state === "failed") out.failed++;
    if (t.enabled && !t.running && typeof t.next === "number" && (!out.next || t.next < out.next.at)) out.next = { name: t.name, at: t.next };
  }
  return out;
}

/** Sections of the page: which task (by name) goes under which title; unknown tasks land in the last section */
export const TASK_GROUPS: { id: string; title: () => string; names: string[] }[] = [
  { id: "collect", title: () => tx("Collecte et veille"), names: ["collect", "watch", "live"] },
  { id: "network", title: () => tx("Découverte du réseau"), names: ["netscan"] },
  { id: "keep", title: () => tx("Sauvegardes et santé"), names: ["backups", "health"] },
];

export function groupOf(name: string): string {
  return TASK_GROUPS.find((g) => g.names.includes(name))?.id ?? TASK_GROUPS[TASK_GROUPS.length - 1].id;
}

/** Duration of a run in words: "42 s", "3 min 05 s" */
export const runLength = (started: number, ended: number): string => elapsed(Math.max(0, Math.round(ended - started)));

/** « dans 8 min », « dans 2 h 05 », « dans moins d'une minute » */
export function inText(ms: number): string {
  const min = Math.ceil(ms / 60000);
  if (min <= 1) return tx("dans moins d'une minute");
  if (min < 60) return tx("dans {0} min", min);
  return tx("dans {0} h {1}", Math.floor(min / 60), pad(min % 60));
}
