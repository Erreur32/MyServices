// The page of a machine: the figures on top (health, processor, memory, fullest disk, temperature, uptime) and the short names of its temperature probes.
import type { HealthHost } from "../types";
import { dur } from "./format";
import { tx } from "./i18n";

export type FigureTone = "ok" | "warn" | "bad" | undefined;
export interface MachineFigure { key: string; label: string; value: string; sub?: string; tone: FigureTone; pct?: number; at?: string }   // at: health, when the machine was last read

/** Tone of a filling (processor, memory, disk): orange from 75 %, red from 90 % */
export function fillTone(p: number): FigureTone {
  if (p >= 90) return "bad";
  return p >= 75 ? "warn" : "ok";
}

/** Tone of a processor temperature, with the thresholds of health.py: orange from 85 °C, red from 95 °C */
export function tempTone(c: number): FigureTone {
  if (c >= 95) return "bad";
  return c >= 85 ? "warn" : "ok";
}

const LEVEL_TONE: Record<string, FigureTone> = { ok: "ok", warn: "warn", crit: "bad", down: "bad" };
const LEVEL_TEXT: Record<string, string> = { ok: tx("OK"), warn: tx("À surveiller"), crit: tx("Critique"), down: tx("Injoignable") };

/** The figures that tell the state of the machine at a glance; the ones the machine does not report are left out */
export function machineFigures(h: HealthHost | undefined, uptimeS: number | null, why?: string): MachineFigure[] {
  const out: MachineFigure[] = [];
  if (h && h.level !== "na") out.push({ key: "health", label: tx("Santé"), value: LEVEL_TEXT[h.level] ?? h.level, sub: why, tone: LEVEL_TONE[h.level], at: h.read_at });
  const cpu = h?.res?.cpu_pct ?? h?.load?.cpu_pct;
  if (cpu != null) out.push({ key: "cpu", label: tx("Processeur"), value: `${Math.round(cpu)} %`, tone: fillTone(cpu), pct: cpu });
  const mem = h?.res?.mem_pct;
  if (mem != null) {
    const used = h?.res?.mem_used_mb, total = h?.res?.mem_total_mb;
    const sub = used != null && total ? `${(used / 1024).toFixed(1).replace(".", ",")} / ${(total / 1024).toFixed(1).replace(".", ",")} Go` : undefined;
    out.push({ key: "mem", label: tx("Mémoire"), value: `${Math.round(mem)} %`, sub, tone: fillTone(mem), pct: mem });
  }
  const full = [...(h?.disks ?? [])].sort((a, b) => b.used_pct - a.used_pct)[0];
  if (full) {
    const free = full.avail_gb != null ? ` · ${tx("{0} Go libres", Math.round(full.avail_gb))}` : "";
    out.push({ key: "disk", label: tx("Disque le plus plein"), value: `${Math.round(full.used_pct)} %`, sub: `${full.mount}${free}`, tone: fillTone(full.used_pct), pct: full.used_pct });
  }
  const c = h?.temp?.available ? h.temp.celsius : undefined;
  if (c != null) out.push({ key: "temp", label: tx("Température"), value: `${Math.round(c)} °C`, tone: tempTone(c) });
  if (uptimeS) out.push({ key: "uptime", label: tx("En marche depuis"), value: dur(uptimeS), tone: undefined });
  return out;
}

/** A temperature probe's name, short enough for a chip: the chip prefix goes (coretemp_, nct6798_, k10temp_…), underscores become spaces,
 *  « core_12 » stays « core 12 »; the full name goes in the tooltip */
export function shortProbe(name: string): string {
  const s = name
    .replace(/^(coretemp|k10temp|zenpower|acpitz|nct\d+|it\d+|pch_\w+?|amdgpu|thinkpad)_/i, "")
    .replace(/_id_/g, " ")
    .replace(/_/g, " ")
    .trim();
  return s.length > 16 ? `${s.slice(0, 15)}…` : s || name;
}
