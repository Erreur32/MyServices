// The Services tab in « state » mode: the figures of the top tiles and the services to watch (down, warning, or with a point to check),
// worst first. Worked out from the hosts of the snapshot with the same rules as the list (lib/status.ts).
import { CLEANUP, checks, status, type Check } from "./status";
import type { Host } from "../types";

export interface ServicesFigures { total: number; withDomain: number; local: number; machines: number; ok: number; bad: number; warn: number; toCheck: number; warnWhy: string[]; checkWhy: Check[] }

/** Points to check that are not mere cleanup (an obsolete host, a paused one) */
export const liveChecks = (r: Host): Check[] => checks(r).filter((k) => !CLEANUP.includes(k));

export function figures(hosts: Host[]): ServicesFigures {
  const f: ServicesFigures = { total: hosts.length, withDomain: 0, local: 0, machines: new Set(hosts.map((r) => r.host_ip || r.ip || r.target_ip).filter(Boolean)).size, ok: 0, bad: 0, warn: 0, toCheck: 0, warnWhy: [], checkWhy: [] };
  for (const r of hosts) {
    if (r.domains.length || r.vhost_domains?.length) f.withDomain++;
    if (r.type === "local") f.local++;
    const [cls, label] = status(r);
    if (cls === "ok") f.ok++;
    else if (cls === "bad") f.bad++;
    else if (cls === "warn") { f.warn++; if (!f.warnWhy.includes(label)) f.warnWhy.push(label); }
    const ck = liveChecks(r);
    if (ck.length) { f.toCheck++; for (const k of ck) if (!f.checkWhy.includes(k)) f.checkWhy.push(k); }
  }
  return f;
}

const RANK: Record<string, number> = { bad: 0, warn: 1, ok: 2, off: 3 };

/** The services that need a look: down first, then warnings, then the ones only flagged by a check; each once */
export function toWatch(hosts: Host[]): Host[] {
  return hosts.filter((r) => { const c = status(r)[0]; return c === "bad" || c === "warn" || liveChecks(r).length > 0; })
    .sort((a, b) => RANK[status(a)[0]] - RANK[status(b)[0]] || liveChecks(b).length - liveChecks(a).length);
}
