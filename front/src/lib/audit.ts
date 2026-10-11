// Journal d'audit : gravité d'une action d'après son libellé, et regroupements pour les filtres.
import type { AuditEntry } from "../types";

export type AuditTone = "bad" | "warn" | "ok" | "info";

/** Échec ou refus = rouge ; suppression, désactivation, mot de passe = orange ; connexion réussie = vert ; le reste = neutre */
export function auditTone(action: string): AuditTone {
  if (/échou|refus|incorrect|invalide/i.test(action)) return "bad";
  if (/supprim|désactiv|mot de passe|révoqu|fermées?/i.test(action)) return "warn";
  if (/connexion$|connect[ée]|ouverte|créé|ajout/i.test(action)) return "ok";
  return "info";
}

/** Entrées de la période (jours, 0 = tout) à partir de `now` (ms) */
export function inPeriod(entries: AuditEntry[], days: number, now = Date.now()): AuditEntry[] {
  return days ? entries.filter((e) => e.ts * 1000 >= now - days * 86400e3) : entries;
}

/** Valeurs distinctes avec leur nombre, les plus fréquentes d'abord */
export function counted(values: (string | null | undefined)[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
