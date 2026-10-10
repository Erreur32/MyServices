// Tons des badges et niveaux santé / sauvegardes (hors composants, voir lib/forms.ts).
import { tx } from "./i18n";

export type Tone = "ok" | "warn" | "bad" | "off" | "info";

/** Niveau santé / sauvegardes -> badge */
export const LEVEL: Record<string, [Tone, string]> = {
  ok: ["ok", tx("OK")], warn: ["warn", tx("à surveiller")], crit: ["bad", tx("critique")], down: ["bad", tx("injoignable")],
  na: ["off", tx("sans objet")], archive: ["off", "archive"],
};
