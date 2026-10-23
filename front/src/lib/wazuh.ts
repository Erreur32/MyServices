// What the Wazuh connector knows of one machine (by the IP of its Wazuh agent): configuration score, inventory, vulnerabilities.
import type { ServiceStatus, WazuhMachine } from "../types";

export interface WazuhOfMachine { instance: string; stale: boolean; m: WazuhMachine }

/** A name compared without case, spaces or signs: « Home Assistant » and « HomeAssistant » are the same */
const plain = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The first Wazuh instance that has an agent on this IP; failing that, an agent of the same name whose own IP is no known machine's
 *  (an agent in a container gives its inner IP, 172.x); null when none (the card is left out) */
export function wazuhOf(statuses: ServiceStatus[] | undefined, ip: string, name?: string, knownIps: ReadonlySet<string> = new Set()): WazuhOfMachine | null {
  const wz = (statuses ?? []).filter((s) => s.connector === "wazuh" && s.machines);
  const hit = (s: ServiceStatus, m: WazuhMachine) => ({ instance: s.instance ?? s.name, stale: s.stale, m });
  for (const s of wz) if (s.machines![ip]) return hit(s, s.machines![ip]);
  const want = plain(name);
  if (!want) return null;
  for (const s of wz) {
    const found = Object.entries(s.machines!).find(([at, m]) => !knownIps.has(at) && plain(m.agent) === want);
    if (found) return hit(s, found[1]);
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
