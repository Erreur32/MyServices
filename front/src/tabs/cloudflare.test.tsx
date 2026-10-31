import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Cloudflare } from "./Cloudflare";

const zone = { name: "a.example", status: "active", paused: false, plan: "Free Website",
  settings: { ssl: "full", always_use_https: "off", min_tls_version: "1.0", security_header: false, security_level: "medium", cache_level: "aggressive" },
  dns: { total: 2, proxied: 1, records: [{ name: "www.a.example", type: "A", proxied: true }] },
  traffic: { requests: 1000, cached: 2, bytes: 2048, threats: 7, page_views: 10, visitors: 5, days: [{ date: "2026-10-30", requests: 400 }, { date: "2026-10-31", requests: 600 }], periods: undefined as unknown } };
const totals = { requests: 1000, cached: 2, bytes: 2048, cached_bytes: 1024, threats: 7, errors: 300, visitors: 5 };
const period = { ...totals, previous: { ...totals, requests: 500 }, points: [{ at: "2026-10-30T10:00:00Z", requests: 400, errors: 100 }, { at: "2026-10-30T11:00:00Z", requests: 600, errors: 200 }],
  status: [{ code: 200, requests: 700 }, { code: 525, requests: 300 }], countries: [{ name: "FR", requests: 900, threats: 1 }], content: [{ name: "html", requests: 1000, bytes: 2048 }],
  tls: [{ name: "TLSv1.3", requests: 900 }, { name: "none", requests: 100 }], http: [{ name: "HTTP/2", requests: 1000 }], browsers: [{ name: "ChromeMobile", requests: 10 }], hosts: [{ name: "www.a.example", code: 525, requests: 300 }] };
zone.traffic.periods = { "24h": period, "7d": period, "30d": period };
const snap = (zones: unknown[], hosts: unknown[] = []) => ({ me: { role: "admin" }, data: { hosts, services_status: [{ connector: "cloudflare", cloudflare: { days: 7, zones } }] } }) as unknown as Snapshot;
const show = (view: string, s = snap([zone])) => renderToStaticMarkup(<Cloudflare snap={s} route={`cloudflare/${view}`} />);

describe("Cloudflare pages", () => {
  it("overview: what to improve, with its reason and its precaution", () => {
    const html = show("overview");
    expect(html).toContain("HTTPS non forcé");
    expect(html).toContain("Précaution");
    expect(html).toContain("classées comme menaces");
  });
  it("compare: the settings of each domain", () => expect(show("compare")).toContain("référence"));
  it("traffic: the bars with the server errors, the trends and what to look at", () => {
    const html = show("traffic");
    expect(html).toContain("fill-bad");
    expect(html).toContain("↗ 100 %");
    expect(html).toContain("www.a.example");
    expect(html).toContain("525 connexion SSL refusée");
    expect(html).toContain("30 % des requêtes finissent en erreur serveur");
    expect(html).toContain("Chrome Mobile");
    expect(html).toContain("Sans chiffrement");
  });
  it("traffic: waits for the next read when the periods are not there yet", () => {
    expect(show("traffic", snap([{ ...zone, traffic: { ...zone.traffic, periods: undefined } }]))).toContain("Statistiques à venir");
  });
  it("checks: says when no reverse proxy is read, then names the host", () => {
    expect(show("checks")).toContain("Aucun reverse proxy lu");
    const html = show("checks", snap([zone], [{ type: "proxy", domains: ["www.a.example"], enabled: false, npm: "NPM", ssl: true, cloudflare: true }]));
    expect(html).toContain("hôte coupé");
    expect(html).not.toContain("Aucun reverse proxy lu");
  });
  it("a connector that read nothing leads to its state", () => expect(show("overview", snap([]))).toContain("Connecteurs"));
});
