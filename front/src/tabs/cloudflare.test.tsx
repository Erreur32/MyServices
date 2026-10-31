import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { Cloudflare } from "./Cloudflare";

const zone = { name: "a.example", status: "active", paused: false, plan: "Free Website",
  settings: { ssl: "full", always_use_https: "off", min_tls_version: "1.0", security_header: false, security_level: "medium", cache_level: "aggressive" },
  dns: { total: 2, proxied: 1, records: [{ name: "www.a.example", type: "A", proxied: true }] },
  traffic: { requests: 1000, cached: 2, bytes: 2048, threats: 7, page_views: 10, visitors: 5, days: [{ date: "2026-10-30", requests: 400 }, { date: "2026-10-31", requests: 600 }] } };
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
  it("traffic: the day bars and the table", () => {
    const html = show("traffic");
    expect(html).toContain("<rect");
    expect(html).toContain("1 000".replace(" ", " "));
  });
  it("checks: says when no reverse proxy is read, then names the host", () => {
    expect(show("checks")).toContain("Aucun reverse proxy lu");
    const html = show("checks", snap([zone], [{ type: "proxy", domains: ["www.a.example"], enabled: false, npm: "NPM", ssl: true, cloudflare: true }]));
    expect(html).toContain("hôte coupé");
    expect(html).not.toContain("Aucun reverse proxy lu");
  });
  it("a connector that read nothing leads to its state", () => expect(show("overview", snap([]))).toContain("Connecteurs"));
});
