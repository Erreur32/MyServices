import { describe, expect, it } from "vitest";
import type { CloudflareZone, Dns, Host } from "../types";
import { dnsHostIcon } from "./appIcons";
import { cloudCounts, compareKey, dnsCompare, isAlert, machineRanks } from "./dnsCompare";
import type { DnsRow } from "./dnsState";

const g = (o: Partial<Dns> = {}): Dns => ({ servers: {}, rewrites_diff: [], user_rules_diff: [], orphans: [], npm_ips: { home: "10.0.0.1", remote: "203.0.113.5" }, zones: { "serveur.fr": "OVH" }, ...o });
const zone = (name: string, records: [string, boolean][]): CloudflareZone => ({ name, status: "active", paused: false, plan: "Free Website", settings: { ssl: "strict", always_use_https: "on", min_tls_version: "1.2", security_header: false, security_level: "medium", cache_level: "aggressive" },
  dns: { total: records.length, proxied: records.filter(([, p]) => p).length, records: records.map(([n, proxied]) => ({ name: n, type: "A", proxied })) }, traffic: null });
const host = (domains: string[], npm: string, issues: [string, string][] = [], o: Partial<Host> = {}) => ({ type: "proxy", id: domains[0], domains, enabled: true, npm, ssl: true, ssl_forced: true, cloudflare: true, lan_only: false,
  dns: { issues, answers: Object.fromEntries(domains.map((d) => [d, { "10.0.0.2": issues.length ? [] : ["10.0.0.1"], "10.0.0.3": issues.length ? null : ["10.0.0.1"] }])) }, ...o }) as unknown as Host;
const machines = [{ ip: "10.0.0.1", name: "maison" }, { ip: "203.0.113.5", name: "ovh" }];
const zones = [zone("site.info", [["site.info", true]]), zone("maison.fr", [["blog.maison.fr", true], ["*.lan.maison.fr", false]])];
const find = (rows: ReturnType<typeof dnsCompare>, name: string) => rows.find((r) => r.name === name)!;

describe("DNS comparison", () => {
  it("a name missing everywhere is a red alert naming its machine, what to do and where", () => {
    const rows = dnsCompare(g(), [host(["git.serveur.fr", "git.site.info"], "remote", [["absent", "git.site.info"]])], machines, zones, []);
    expect(find(rows, "git.site.info")).toMatchObject({ tone: "bad", npm: "ovh", npmIp: "203.0.113.5", manager: "Cloudflare", cloud: "none", answer: "aucune réponse", note: "autre nom du host git.serveur.fr" });
    expect(find(rows, "git.site.info").verdict).toContain("Retirer le nom du NPM ovh (203.0.113.5), ou créer l'enregistrement chez Cloudflare");
    expect(rows[0].name).toBe("git.site.info");
  });
  it("a name outside Cloudflare says who runs it, an internal one stays local", () => {
    const rows = dnsCompare(g(), [host(["git.serveur.fr"], "remote"), host(["krawl.lan"], "home")], machines, zones, []);
    expect(find(rows, "git.serveur.fr")).toMatchObject({ manager: "OVH", cloud: "outside", tone: "info", verdict: "Se change chez OVH", answer: "10.0.0.1" });
    expect(find(rows, "krawl.lan")).toMatchObject({ manager: "DNS local", verdict: "" });
  });
  it("tells a proxied record, a wildcard and a plain DNS answer", () => {
    const rows = dnsCompare(g(), [host(["blog.maison.fr"], "home"), host(["app.lan.maison.fr"], "home", [], { lan_only: true })], machines, zones, []);
    expect(find(rows, "blog.maison.fr")).toMatchObject({ cloud: "proxied", tone: "ok" });
    expect(find(rows, "app.lan.maison.fr")).toMatchObject({ cloud: "wildcard", tone: "ok" });
    expect(cloudCounts(rows)).toMatchObject({ proxied: 2, wildcard: 1, alerts: 0 });
  });
  it("a site down behind a wildcard is no DNS alert, the same site behind its own proxied record is", () => {
    const down = { public: { code: 502 } } as Partial<Host>;
    expect(find(dnsCompare(g(), [host(["app.lan.maison.fr"], "home", [], { lan_only: true, ...down })], machines, zones, []), "app.lan.maison.fr").tone).toBe("ok");
    expect(find(dnsCompare(g(), [host(["blog.maison.fr"], "home", [], down)], machines, zones, []), "blog.maison.fr").tone).toBe("bad");
  });
  it("a host kept for the LAN but proxied by Cloudflare asks for a look", () => {
    const rows = dnsCompare(g(), [host(["blog.maison.fr"], "home", [], { lan_only: true })], machines, zones, []);
    expect(isAlert(find(rows, "blog.maison.fr"))).toBe(true);
  });
  it("a Cloudflare record without an active host gets its own row", () => {
    const rows = dnsCompare(g(), [], machines, zones, []);
    expect(find(rows, "blog.maison.fr")).toMatchObject({ npm: "-", npmIp: "", tone: "info", note: "enregistrement sans host NPM actif" });
  });
  it("a host switched off with no record is not listed: it was cut on purpose", () => {
    const off = host(["ancien.maison.fr"], "home", [], { enabled: false });
    expect(dnsCompare(g(), [off], machines, zones, []).map((r) => r.name)).not.toContain("ancien.maison.fr");
  });
  it("sorts the alerts first on the verdict column, and every other column on its text", () => {
    const rows = dnsCompare(g(), [host(["blog.maison.fr"], "home"), host(["git.site.info"], "remote", [["absent", "git.site.info"]])], machines, zones, []);
    expect(compareKey(find(rows, "git.site.info"), "tone")).toBeLessThan(compareKey(find(rows, "blog.maison.fr"), "tone") as number);
    expect(compareKey(find(rows, "git.site.info"), "npm")).toBe("ovh");
    expect(compareKey(find(rows, "blog.maison.fr"), "cloud")).toBe("proxied");
  });
  it("each machine gets its own rank, and a row without a machine none", () => {
    const rows = dnsCompare(g(), [host(["a.maison.fr"], "home"), host(["b.maison.fr"], "home"), host(["c.serveur.fr"], "remote")], machines, zones, []);
    const ranks = machineRanks(rows);
    expect([...ranks]).toEqual([["maison", 0], ["ovh", 1]]);
  });
  it("without Cloudflare no state is claimed, and the alerts about no name stay in the table", () => {
    const watch: DnsRow[] = [{ key: "sync", sev: "bad", area: "Synchro", title: "synchro en retard", detail: "", anchor: "servers" }, { key: "host/x", sev: "warn", area: "Domaine", title: "dup", detail: "", anchor: "domains" }];
    const rows = dnsCompare(g(), [host(["a.maison.fr"], "home")], machines, [], watch);
    expect(rows.map((r) => r.name)).toEqual(["synchro en retard", "a.maison.fr"]);
    expect(find(rows, "a.maison.fr")).toMatchObject({ cloud: null, tone: "ok" });
  });
});

describe("logo of a DNS host", () => {
  it("names a file for a known host, nothing for the others", () => {
    expect(dnsHostIcon("OVH")).toMatch(/ovh\.svg$/);
    expect(dnsHostIcon("AWS Route 53")).toMatch(/aws-route53\.svg$/);
    expect(dnsHostIcon("DNS local")).toBeNull();
  });
});
