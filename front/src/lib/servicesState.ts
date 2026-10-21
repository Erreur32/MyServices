// The Services tab in « state » mode: the figures of the top tiles and the services to watch (down, warning, or with a point to check),
// worst first. Worked out from the hosts of the snapshot with the same rules as the list (lib/status.ts).
import { CLEANUP, checks, status, type Check } from "./status";
import type { Host } from "../types";

export interface ServicesFigures { total: number; withDomain: number; local: number; machines: number; ok: number; bad: number; warn: number; toCheck: number; warnWhy: string[]; checkWhy: Check[] }

/** Points to check that are not mere cleanup (an obsolete host, a paused one) */
export const liveChecks = (r: Host): Check[] => checks(r).filter((k) => !CLEANUP.includes(k));

const pushOnce = <T,>(list: T[], v: T) => { if (!list.includes(v)) list.push(v); };

/** One service counted into the figures: its state and its points to check */
function count(f: ServicesFigures, r: Host): void {
  if (r.domains.length || r.vhost_domains?.length) f.withDomain++;
  if (r.type === "local") f.local++;
  const [cls, label] = status(r);
  if (cls === "ok") f.ok++;
  else if (cls === "bad") f.bad++;
  else if (cls === "warn") { f.warn++; pushOnce(f.warnWhy, label); }
  const ck = liveChecks(r);
  if (ck.length) { f.toCheck++; for (const k of ck) pushOnce(f.checkWhy, k); }
}

export function figures(hosts: Host[]): ServicesFigures {
  const f: ServicesFigures = { total: hosts.length, withDomain: 0, local: 0, machines: new Set(hosts.map((r) => r.host_ip || r.ip || r.target_ip).filter(Boolean)).size, ok: 0, bad: 0, warn: 0, toCheck: 0, warnWhy: [], checkWhy: [] };
  for (const r of hosts) count(f, r);
  return f;
}

const RANK: Record<string, number> = { bad: 0, warn: 1, ok: 2, off: 3 };

/** The services that need a look: down first, then warnings, then the ones only flagged by a check; each once */
export function toWatch(hosts: Host[]): Host[] {
  return hosts.filter((r) => { const c = status(r)[0]; return c === "bad" || c === "warn" || liveChecks(r).length > 0; })
    .sort((a, b) => RANK[status(a)[0]] - RANK[status(b)[0]] || liveChecks(b).length - liveChecks(a).length);
}

/** Process names that several programs share (an interpreter, a shell): their ports are never merged, they may be different programs */
const GENERIC_PROCESS = new Set(["python", "python3", "node", "nodejs", "java", "php", "php-fpm", "ruby", "dotnet", "bash", "sh", "perl", "deno", "bun"]);

/** What makes two rows the same service on several ports: a container by its name, a process by its name (unless generic), on the same machine */
export function portGroupKey(r: Host): string | null {
  if (r.type !== "local" || !r.service?.name) return null;
  const kind = r.service.kind;
  if (kind !== "docker" && kind !== "process") return null;
  if (kind === "process" && GENERIC_PROCESS.has(r.service.name.toLowerCase())) return null;
  return `${r.host_ip || r.ip || r.machine || "?"}|${kind}|${r.service.name}`;
}

/** One line per service: the rows of the same service on several ports become one line, in the place of its first row; `lead` is the row the line
 *  shows and opens (its worst port, else its first), `ports` every row of the line, by port number. A lone row is a line of one. */
export function mergePorts(rows: Host[]): { lead: Host; ports: Host[] }[] {
  const out: { lead: Host; ports: Host[] }[] = [], at = new Map<string, number>();
  for (const r of rows) {
    const k = portGroupKey(r);
    const i = k ? at.get(k) : undefined;
    if (i === undefined) {
      if (k) at.set(k, out.length);
      out.push({ lead: r, ports: [r] });
    } else out[i].ports.push(r);
  }
  for (const line of out) {
    if (line.ports.length < 2) continue;
    line.ports.sort((a, b) => (a.port ?? 0) - (b.port ?? 0));
    line.lead = line.ports.reduce((w, r) => (RANK[status(r)[0]] < RANK[status(w)[0]] ? r : w), line.ports[0]);
  }
  return out;
}
