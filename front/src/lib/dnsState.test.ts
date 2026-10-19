import { describe, expect, it } from "vitest";
import type { Dns, Host } from "../types";
import { dnsFigures, dnsWatch } from "./dnsState";

const g = (o: Partial<Dns>): Dns => ({ servers: {}, rewrites_diff: [], user_rules_diff: [], orphans: [], ...o });
const host = (id: number, issues: [string, string][]): Host => ({ type: "proxy", id, enabled: true, domains: [`h${id}.lan`], dns: { issues } } as unknown as Host);

describe("DNS in state mode", () => {
  it("without a DNS tool: the resolver answers, a domain that does not resolve is red, a machine name elsewhere is orange", () => {
    const d = g({ resolver: { servers: ["10.0.0.2"], search: ["lan"] }, servers: { "10.0.0.2": { name: "résolveur", resolver: true, readable: false, rewrites: null, silent: 0 } },
      machines: [{ ip: "10.0.0.5", name: "srv", state: "ok", answer: ["10.0.0.5"] }, { ip: "10.0.0.9", name: "pc", state: "ailleurs", answer: ["10.0.0.42"] }] });
    const hosts = [host(1, []), host(2, [["absent", "h2.lan"]])];
    const f = dnsFigures(d, hosts);
    expect([f.domains, f.domainsOk, f.servers, f.serversUp, f.rewrites, f.diff]).toEqual([2, 1, 1, 1, null, 0]);
    expect(dnsWatch(d, hosts).map((r) => [r.sev, r.title])).toEqual([["bad", "h2.lan"], ["warn", "pc"]]);
  });
  it("AdGuard: a silent instance and the differences between instances, red first", () => {
    const d = g({ servers: { "10.0.0.2": { name: "A", readable: true, rewrites: 10, silent: 0 }, "10.0.0.3": { name: "B", readable: true, rewrites: 9, silent: 2 } },
      rewrites_diff: [{ domain: "x.lan", answer: "10.0.0.1", only: "10.0.0.2" }, { domain: "y.lan", answer: "10.0.0.1", only: "10.0.0.2", waiting: true }] });
    const rows = dnsWatch(d, []);
    expect(rows.map((r) => [r.sev, r.area])).toEqual([["bad", "Instance"], ["warn", "Réécritures"]]);
    expect(rows[1].title).toBe("1 différence(s) entre instances");
    expect(dnsFigures(d, []).serversUp).toBe(1);
  });
});
