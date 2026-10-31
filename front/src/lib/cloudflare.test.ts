import { describe, expect, it } from "vitest";
import type { CloudflarePeriod, CloudflareZone, Host } from "../types";
import { advice, answerLines, bestZone, cloudflareChecks, countryName, dnsOnly, niceMax, trafficOf, trendOf } from "./cloudflare";

const zone = (name: string, settings: Partial<CloudflareZone["settings"]> = {}, records: [string, boolean][] = [[`www.${name}`, true]]): CloudflareZone => ({
  name, status: "active", paused: false, plan: "Free Website",
  settings: { ssl: "strict", always_use_https: "on", min_tls_version: "1.2", security_header: false, security_level: "medium", cache_level: "aggressive", ...settings },
  dns: { total: records.length, proxied: records.filter(([, p]) => p).length, records: records.map(([n, proxied]) => ({ name: n, type: "A", proxied })) },
  traffic: null,
});
const host = (domains: string[], o: Partial<Host> = {}) => ({ type: "proxy", domains, enabled: true, npm: "NPM", ssl: true, ssl_forced: true, cloudflare: true, lan_only: false, ...o }) as unknown as Host;
const one = (z: CloudflareZone, hosts: Host[]) => cloudflareChecks([z], hosts)[0];

describe("advice", () => {
  it("names what to correct, and leaves a DNS-only domain to a note", () => {
    const got = advice([zone("a.example", { always_use_https: "off", min_tls_version: "1.0" }), zone("b.example", { ssl: "flexible", always_use_https: "off" }, [["b.example", false]])]);
    expect(got.find((a) => a.key === "https")?.who).toEqual(["a.example"]);
    expect(got.find((a) => a.key === "tls")?.who).toEqual(["a.example"]);
    expect(got.find((a) => a.key === "clear")).toBeUndefined();
    expect(got.find((a) => a.key === "unused")).toMatchObject({ tone: "info", who: ["b.example"] });
  });
  it("needs enough requests to call the cache low", () => {
    const traffic = (requests: number) => ({ requests, cached: 0, bytes: 0, threats: 0, page_views: 0, visitors: 0, days: [] });
    expect(advice([{ ...zone("a.example"), traffic: traffic(50) }]).find((a) => a.key === "cache")).toBeUndefined();
    expect(advice([{ ...zone("a.example"), traffic: traffic(500) }]).find((a) => a.key === "cache")?.who).toEqual(["a.example"]);
  });
  it("picks the safest domain that serves traffic as the reference", () => {
    const off = { ssl: "full", always_use_https: "off" };
    expect(bestZone([zone("a.example", off), zone("b.example"), zone("c.example", {}, [["c.example", false]])])).toBe(1);
    expect(dnsOnly(zone("c.example", {}, [["c.example", false]]))).toBe(true);
  });
});

describe("cloudflareChecks", () => {
  it("finds nothing wrong on a name served as it should", () => {
    expect(one(zone("a.example"), [host(["www.a.example"])])).toMatchObject({ name: "www.a.example", record: "proxied", via: "NPM", tone: "ok", notes: [] });
  });
  it("sees the redirect loop of flexible SSL with a forced HTTPS", () => {
    expect(one(zone("a.example", { ssl: "flexible" }), [host(["www.a.example"])]).tone).toBe("bad");
    expect(one(zone("a.example", { ssl: "flexible" }), [host(["www.a.example"], { ssl_forced: false })]).tone).toBe("ok");
  });
  it("sees a strict domain whose host has no certificate", () => {
    const c = one(zone("a.example"), [host(["www.a.example"], { ssl: false, ssl_forced: false })]);
    expect(c.tone).toBe("bad");
    expect(c.notes[0]).toContain("strict");
  });
  it("sees a disabled host, an error answer and a refused certificate", () => {
    expect(one(zone("a.example"), [host(["www.a.example"], { enabled: false })]).tone).toBe("bad");
    expect(one(zone("a.example"), [host(["www.a.example"], { public: { code: 522 } } as Partial<Host>)])).toMatchObject({ tone: "bad", code: 522 });
    expect(one(zone("a.example"), [host(["www.a.example"], { public: { code: 200, cert_ok: false } } as Partial<Host>)]).tone).toBe("warn");
  });
  it("warns about the real address and a LAN-only host behind the proxy", () => {
    expect(one(zone("a.example"), [host(["www.a.example"], { cloudflare: false })]).tone).toBe("warn");
    expect(one(zone("a.example"), [host(["www.a.example"], { lan_only: true })]).tone).toBe("warn");
  });
  it("checks an Apache or nginx vhost without asking it for NPM settings", () => {
    const v = { type: "local", domains: [], vhost_domains: ["www.a.example"], vhost_server: "apache", enabled: true, machine: "web" } as unknown as Host;
    expect(one(zone("a.example"), [v])).toMatchObject({ via: "apache", machine: "web", tone: "ok" });
  });
  it("tells a proxied name that no reverse proxy knows", () => {
    expect(one(zone("a.example"), [])).toMatchObject({ via: null, tone: "info" });
  });
  it("tells a DNS-only site, and a public site with no record", () => {
    expect(one(zone("a.example", {}, [["www.a.example", false]]), [host(["www.a.example"])])).toMatchObject({ record: "dns", tone: "info" });
    expect(one(zone("a.example", {}, []), [host(["new.a.example"], { public_ok: true } as Partial<Host>)])).toMatchObject({ record: "none", tone: "warn" });
  });
  it("leaves out mail records and local names, and follows wildcards", () => {
    expect(cloudflareChecks([zone("a.example", {}, [["mail.a.example", false]])], [])).toEqual([]);
    expect(cloudflareChecks([zone("a.example", {}, [])], [host(["nas.a.example"], { lan_only: true })])).toEqual([]);
    expect(one(zone("a.example", {}, [["*.a.example", true]]), [host(["app.a.example"])])).toMatchObject({ record: "proxied", tone: "ok" });
    expect(one(zone("a.example"), [host(["*.a.example"])])).toMatchObject({ name: "www.a.example", via: "NPM" });
  });
  it("puts what is broken first, and ignores the names of other domains", () => {
    const got = cloudflareChecks([zone("a.example", {}, [["ok.a.example", true], ["ko.a.example", true]])], [host(["ok.a.example"]), host(["ko.a.example"], { enabled: false }), host(["other.org"])]);
    expect(got.map((c) => c.name)).toEqual(["ko.a.example", "ok.a.example"]);
  });
});

describe("chart helpers", () => {
  it("rounds the top of the scale up", () => {
    expect([niceMax(0), niceMax(3), niceMax(21100), niceMax(100)]).toEqual([1, 5, 50000, 100]);
  });
});

describe("traffic periods", () => {
  const totals = { requests: 100, cached: 10, bytes: 5, cached_bytes: 1, threats: 2, errors: 30, visitors: 4 };
  const period = (o: Partial<CloudflarePeriod> = {}): CloudflarePeriod => ({ ...totals, previous: { ...totals, requests: 50 }, points: [{ ...totals, at: "2026-10-30", requests: 7, errors: 2, visitors: 2 }],
    status: [{ code: 200, requests: 70 }, { code: 525, requests: 30 }], countries: [{ name: "FR", requests: 9, threats: 1 }], content: [], tls: [], http: [], browsers: [], hosts: [{ name: "a.example", code: 525, requests: 30 }], ...o });
  const withPeriod = (name: string, p: CloudflarePeriod) => ({ ...zone(name), traffic: { requests: 0, cached: 0, bytes: 0, threats: 0, page_views: 0, visitors: 0, days: [], periods: { "24h": p, "7d": p, "30d": p } } });

  it("adds the domains up, line by line", () => {
    const got = trafficOf([withPeriod("a.example", period()), withPeriod("b.example", period({ countries: [{ name: "FR", requests: 1, threats: 2 }, { name: "NL", requests: 20, threats: 0 }], hosts: [{ name: "b.example", code: 520, requests: 40 }] }))], "24h");
    expect(got).toMatchObject({ requests: 200, errors: 60, previous: { requests: 100 }, points: [{ at: "2026-10-30", visitors: 4, requests: 14, errors: 4 }], status: [{ code: 200, requests: 140 }, { code: 525, requests: 60 }] });
    expect(got?.countries).toEqual([{ name: "NL", requests: 20, threats: 0 }, { name: "FR", requests: 10, threats: 3, bytes: 0 }]);
    expect(got?.hosts.map((h) => h.name)).toEqual(["b.example", "a.example"]);
  });
  it("has nothing to show before the first read of the periods", () => expect(trafficOf([zone("a.example")], "7d")).toBeNull());
  it("compares with the period before only when it has something", () => {
    expect([trendOf(150, 100), trendOf(50, 100), trendOf(5, 0)]).toEqual([50, -50, null]);
  });
  it("keeps good answers together and names each server error, with what to check on a certificate", () => {
    const got = answerLines(period({ status: [{ code: 200, requests: 60 }, { code: 204, requests: 5 }, { code: 520, requests: 10 }, { code: 525, requests: 20 }, { code: 599, requests: 1 }] }));
    expect(got.map((l) => l.requests)).toEqual([65, 20, 10, 1]);
    expect(got[1]).toMatchObject({ tone: "bad", why: expect.any(String) });
    expect(got[1].name).toMatch(/^525 /);
    expect(got[2].why).toBeUndefined();
    expect(got[3].name).toMatch(/^599 /);
  });
  it("names a country and leaves a code it does not know", () => {
    expect(countryName("FR")).not.toBe("FR");
    expect(countryName("T1")).toBe("T1");
  });
});
