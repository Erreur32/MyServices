// What the Wazuh connector knows of one machine (by the IP of its Wazuh agent): configuration score, inventory, vulnerabilities.
import type { ServiceStatus, WazuhMachine } from "../types";

export interface WazuhOfMachine { instance: string; stale: boolean; m: WazuhMachine }

/** The first Wazuh instance that has an agent on this IP; null when none (the card is left out) */
export function wazuhOf(statuses: ServiceStatus[] | undefined, ip: string): WazuhOfMachine | null {
  for (const s of statuses ?? []) {
    const m = s.connector === "wazuh" ? s.machines?.[ip] : undefined;
    if (m) return { instance: s.instance ?? s.name, stale: s.stale, m };
  }
  return null;
}

/** Tone of an SCA score: green from 80 %, orange from 50 %, red below (the dashboard's own bands) */
export function scoreTone(score: number): "ok" | "warn" | "bad" {
  if (score >= 80) return "ok";
  return score >= 50 ? "warn" : "bad";
}

/** Tone of the vulnerabilities of a machine: red with a critical one, orange with a high one */
export function vulnTone(v: NonNullable<WazuhMachine["vulns"]>): "ok" | "warn" | "bad" {
  if (v.critical) return "bad";
  return v.high ? "warn" : "ok";
}
