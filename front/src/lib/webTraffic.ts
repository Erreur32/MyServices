// The web traffic of each machine whose Nginx Proxy Manager logs are read (agent or SSH, health stats.json), for the Web traffic page of
// Security and its findings. The flags (rising, diffuse, errors) and the usual levels come from the health pass (tile_history.web_trend).
import type { Health, WebTraffic } from "../types";
import { splitHostName } from "./format";

export type SiteVerdict = "diffuse" | "errors" | "usual";
export interface SiteRow { site: string; last: number; usual: number | null; total: number; ips: number; share: number; dip: number; errors: number; verdict: SiteVerdict }
export interface WebMachine {
  id: string; name: string; ip: string; via: string; web: WebTraffic; hours: number[];   // hours: requests of the 24 hours up to the current one
  load: number | null; ncpu: number; iowait: number | null; sites: SiteRow[];
}

export const VERDICT_ORDER: SiteVerdict[] = ["diffuse", "errors", "usual"];
export const LOAD_DISK = 30;   // % of CPU time waiting for the disks: from there a high load is the disks' (copies), not the web's

const hourOf = (t: number): number => Math.floor(t / 3600) * 3600;

/** The sites of a machine, the ones to look at first, then the busiest */
export function siteRows(w: WebTraffic): SiteRow[] {
  const last = hourOf(w.at) - 3600;
  return Object.entries(w.sites).map(([site, s]): SiteRow => {
    const total = s.total ?? s.h.reduce((n, [, r]) => n + r, 0);
    let verdict: SiteVerdict = "usual";   // a site is listed only once it has requests
    if (s.errors) verdict = "errors";
    if (s.diffuse) verdict = "diffuse";
    return { site, last: s.h.find(([t]) => t === last)?.[1] ?? 0, usual: s.usual ?? null, total, ips: s.ips, dip: s.dip,
      share: total ? Math.round((100 * s.dreq) / total) : 0, errors: s.h.reduce((n, [, , e]) => n + e, 0), verdict };
  }).sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.total - a.total);
}

/** A site that needs a look: scraped, or answering 5xx */
export const toLook = (r: SiteRow): boolean => r.verdict !== "usual";

/** One entry per machine whose NPM logs were read, the rising ones first */
export function webMachines(health: Health | null): WebMachine[] {
  return (health?.hosts ?? []).flatMap((h): WebMachine[] => {
    const w = h.web;
    if (!w?.sites) return [];
    const [name, ip] = splitHostName(h.name), cur = hourOf(w.at);
    const per = new Map<number, number>();
    for (const s of Object.values(w.sites)) for (const [t, n] of s.h) per.set(t, (per.get(t) ?? 0) + n);
    return [{
      id: h.id, name, ip, via: h.source ?? "", web: w, hours: Array.from({ length: 24 }, (_, i) => per.get(cur - (23 - i) * 3600) ?? 0),
      load: h.load?.available ? h.load.load_1 : null, ncpu: h.load?.ncpu ?? 1, iowait: h.res?.iowait_pct ?? null, sites: siteRows(w),
    }];
  }).sort((a, b) => Number(!!b.web.rising) - Number(!!a.web.rising) || b.web.ips - a.web.ips);
}

/** What the load of the machine says beside its traffic: a peak, the disks (backup copies), or nothing to say */
export function loadReading(m: WebMachine): "peak" | "disk" | "high" | "calm" {
  if (m.web.rising) return "peak";
  if (m.load == null || m.load < m.ncpu) return "calm";
  return (m.iowait ?? 0) >= LOAD_DISK ? "disk" : "high";
}

/** The busiest addresses of the last hour, every machine together */
export const topIps = (machines: WebMachine[]): { ip: string; site: string; n: number; machine: string }[] =>
  machines.flatMap((m) => m.web.top.map(([ip, site, n]) => ({ ip, site, n, machine: m.name }))).sort((a, b) => b.n - a.n).slice(0, 10);
