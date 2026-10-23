// Security › Wazuh: one row per Wazuh agent, matched to its MyServices machine (by IP, else by name), worst first; the average compliance.
import type { Machine, ServiceStatus, WazuhMachine } from "../types";

export interface WazuhRow { ip: string; m: WazuhMachine; machine: Machine | null; score: number | null; vulns: number }

const plain = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The machine of an agent: the one with its IP, else the one of the same name (an agent in a container gives its inner IP) */
export function machineOfAgent(ip: string, agent: string | null | undefined, machines: Machine[]): Machine | null {
  return machines.find((x) => x.ip === ip) ?? (plain(agent) ? machines.find((x) => plain(x.name) === plain(agent)) ?? null : null);
}

/** Lowest score of the machine's SCA policies (the one to work on), null without any */
export function scoreOf(m: WazuhMachine): number | null {
  return m.sca?.length ? Math.min(...m.sca.map((p) => p.score)) : null;
}

/** The rows of every Wazuh instance: the most critical vulnerabilities first, then the most high ones, then the disconnected agents last */
export function wazuhRows(statuses: ServiceStatus[] | undefined, machines: Machine[]): WazuhRow[] {
  const rows: WazuhRow[] = [];
  for (const s of statuses ?? []) {
    if (s.connector !== "wazuh") continue;
    for (const [ip, m] of Object.entries(s.machines ?? {})) {
      const v = m.vulns;
      rows.push({ ip, m, machine: machineOfAgent(ip, m.agent, machines), score: scoreOf(m), vulns: v ? v.critical + v.high + v.medium + v.low : 0 });
    }
  }
  const key = (r: WazuhRow) => [r.m.status === "active" ? 0 : 1, -(r.m.vulns?.critical ?? 0), -(r.m.vulns?.high ?? 0)];
  return rows.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || (a.m.agent ?? "").localeCompare(b.m.agent ?? "");
  });
}

/** Average of the machines' scores, rounded; null when none has one */
export function averageScore(rows: WazuhRow[]): number | null {
  const s = rows.map((r) => r.score).filter((x): x is number => x != null);
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
}
