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
