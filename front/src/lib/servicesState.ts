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

/** What makes rows one service on one machine, whatever their ports (the same rule as machine_service in msv/collect/tile_history.py) */
function machineService(r: Host): string | null {
  if (r.type === "redirect" || r.type === "dead") return null;
  const where = r.machine || r.host_ip || r.ip, s = r.service;
  if (s?.name && (s.kind === "docker" || (s.kind === "process" && !genericProcess(s.name)))) return `${where}|${s.kind}|${s.name.toLowerCase()}`;
  return r.app && r.app.confidence !== "possible" ? `${where}|app|${r.app.label}` : null;
}

function worse(a: Host, b: Host): boolean {
  const gap = RANK[status(a)[0]] - RANK[status(b)[0]];
  return gap < 0 || (gap === 0 && liveChecks(a).length > liveChecks(b).length);
}

/** One row per service on each machine, the one in the worst state: a service with one port down of three counts once, as it stands */
export function perService(hosts: Host[]): Host[] {
  const lines = new Map<string, Host>(), alone: Host[] = [];
  for (const r of hosts) {
    const key = machineService(r), kept = key ? lines.get(key) : undefined;
    if (!key) alone.push(r);
    else if (!kept || worse(r, kept)) lines.set(key, r);
  }
  return [...lines.values(), ...alone];
}

export function figures(hosts: Host[]): ServicesFigures {
  const rows = perService(hosts);
  const f: ServicesFigures = { total: rows.length, withDomain: 0, local: 0, machines: new Set(hosts.map((r) => r.host_ip || r.ip || r.target_ip).filter(Boolean)).size, ok: 0, bad: 0, warn: 0, toCheck: 0, warnWhy: [], checkWhy: [] };
  for (const r of rows) count(f, r);
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

export const genericProcess = (name: string): boolean => GENERIC_PROCESS.has(name.toLowerCase());

/** What makes two rows the same service on several ports: a container by its name, a process by its name (unless generic), on the same machine */
export function portGroupKey(r: Host): string | null {
  if (r.type !== "local" || !r.service?.name) return null;
  const kind = r.service.kind;
  if (kind !== "docker" && kind !== "process") return null;
  if (kind === "process" && genericProcess(r.service.name)) return null;
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
