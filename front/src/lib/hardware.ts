import type { AgentHardware } from "../types";
import { tx } from "./i18n";

/** Matériel lu par l'agent -> lignes « libellé / valeur » (champs absents omis). */
export function hardwareRows(hw?: AgentHardware | null): [string, string][] {
  if (!hw) return [];
  const rows: [string, string | null | undefined][] = [
    [tx("Modèle"), [hw.maker, hw.model].filter(Boolean).join(" ")],
    [tx("BIOS"), hw.bios],
    [tx("Processeur"), hw.cpu ? `${hw.cpu}${hw.cores ? ` · ${tx("{0} cœurs", String(hw.cores))}` : ""}${hw.threads ? ` / ${tx("{0} threads", String(hw.threads))}` : ""}` : null],
    [tx("Mémoire"), hw.ram_gb ? `${hw.ram_gb} ${tx("Go")}` : null],
    [tx("Graphique"), (hw.gpu || []).map((g) => g.res ? `${g.name} (${g.res})` : g.name).join(", ")],
    [tx("Réseau"), (hw.net || []).map((n) => `${n.name} ${n.ip}`).join(", ")],
    [tx("Domaine"), hw.domain],
    [tx("Dernière mise à jour"), hw.last_update],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}
