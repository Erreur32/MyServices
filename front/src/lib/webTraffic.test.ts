import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { Health } from "../types";
import { securityFindings } from "./securityFindings";
import { loadReading, topIps, webMachines } from "./webTraffic";

const AT = 1_793_000_000, CUR = Math.floor(AT / 3600) * 3600;
const site = (o: object) => ({ h: [[CUR - 3600, 300, 0], [CUR, 50, 0]], ips: 40, dip: 0, dreq: 0, bots: 0, m10: [0, 0], ...o });
const host = (id: string, web: object, extra: object = {}) => ({ id, name: `${id} · 203.0.113.${id.length}`, source: "agent", reachable: true, level: "ok", web: { at: AT, ips: 50, top: [], ...web }, ...extra });
const health = (...hosts: object[]) => ({ hosts }) as unknown as Health;

const OVH = host("ovh", {
  rising: true, last: 4000, now: 100, usual: 400, top: [["198.51.100.38", "links.test", 1210]],
  sites: { "links.test": site({ total: 3000 }), "rss.test": site({ diffuse: true, dreq: 620, total: 1000, dip: 184 }), "api.test": site({ errors: true, total: 500 }) },
}, { load: { load_1: 10.9, ncpu: 4, available: true }, res: { available: true, iowait_pct: 75 } });

describe("web traffic", () => {
  it("sites to look at first, the last complete hour and 24 bars", () => {
    const [m] = webMachines(health(OVH, { id: "nas", name: "nas", reachable: true, level: "ok" }));
    expect(m.sites.map((r) => [r.site, r.verdict, r.last])).toEqual([["rss.test", "diffuse", 300], ["api.test", "errors", 300], ["links.test", "usual", 300]]);
    expect(m.sites[0].share).toBe(62);
    expect(m.hours).toHaveLength(24);
    expect(m.hours.slice(-2)).toEqual([900, 150]);
    expect(loadReading(m)).toBe("peak");
    expect(loadReading({ ...m, web: { ...m.web, rising: false } })).toBe("disk");   // high load, the CPUs wait for the disks
    expect(topIps([m])[0]).toEqual({ ip: "198.51.100.38", site: "links.test", n: 1210, machine: "ovh" });
  });
  it("a peak, a scraped site and a site in 5xx are findings of the traffic page, with stable details", () => {
    const snap = { data: { hosts: [], machine_list: [], security: [], network: [] }, health: health(OVH) } as unknown as Snapshot;
    const got = securityFindings(snap).filter((f) => f.area === "traffic");
    expect(got.map((f) => [f.title, f.detail, f.href])).toEqual([
      ["Pic de trafic web sur le NPM de ovh", "plus de 3 fois l'heure habituelle", "#security/traffic"],
      ["rss.test", "aspiration diffuse, sous les seuils de Fail2ban", "#security/traffic"],
      ["api.test", "plus de 5 % d'erreurs 5xx sur 10 min", "#security/traffic"],
    ]);
    expect(got[1].sub).toBe("ovh · 62 % des requêtes du jour, 184 IP");
  });
});
