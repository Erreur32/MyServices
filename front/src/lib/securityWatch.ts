// The « To watch » table of the Security page: the findings, one row per problem instead of one per thing. Public sites that share
// a gap make one row (« No HSTS, 5 sites »), machines whose SSH server has the same weak setting make one row; the rest stays one
// row each. Red first, then in the order of the areas.
import { tx } from "./i18n";
import { AREAS, type Area, type Finding } from "./securityFindings";

export interface WatchRow { key: string; sev: Finding["sev"]; area: Area; title: string; sub?: string; detail: string; fix: string; items: Finding[] }

/** A finding on its own row */
const single = (f: Finding): WatchRow => ({ key: `${f.area}/${f.title}/${f.detail}`, sev: f.sev, area: f.area, title: f.title, sub: f.sub, detail: f.detail, fix: f.fix, items: [f] });

/** What to do about one gap of a public site, in Nginx Proxy Manager */
const SITE_FIX: Record<string, () => string> = {
  [tx("pas de HSTS")]: () => tx("Dans Nginx Proxy Manager : cocher « HSTS Enabled » sur chaque hôte."),
  [tx("HTTPS non forcé")]: () => tx("Dans Nginx Proxy Manager : cocher « Force SSL » sur chaque hôte."),
  [tx("pas de HTTPS")]: () => tx("Dans Nginx Proxy Manager : demander un certificat (Let's Encrypt) et l'attacher à l'hôte."),
  [tx("« Block exploits » coupé")]: () => tx("Dans Nginx Proxy Manager : cocher « Block Common Exploits » sur chaque hôte."),
  [tx("en-têtes de sécurité faibles")]: () => tx("Dans Nginx Proxy Manager : ajouter les en-têtes (X-Frame-Options, Content-Security-Policy…) dans la configuration avancée de l'hôte."),
};

/** Public sites grouped by gap: one row per gap, the sites in the detail; a site with two gaps sits in two rows */
function siteRows(list: Finding[]): WatchRow[] {
  const by = new Map<string, Finding[]>();
  for (const f of list) for (const gap of f.detail.split(" · ")) by.set(gap, [...(by.get(gap) ?? []), f]);
  return [...by].map(([gap, items]) => ({
    key: `sites/${gap}`, sev: "warn", area: "sites", title: gap, sub: tx("{0} site(s)", items.length), detail: items.map((f) => f.title).join(", "),
    fix: SITE_FIX[gap]?.() ?? items[0].fix, items,
  }));
}

/** Findings of one area sharing the same text (same weak SSH settings): one row naming them all */
function sameRows(list: Finding[], what: (n: number) => string): WatchRow[] {
  const by = new Map<string, Finding[]>();
  for (const f of list) { const k = `${f.sev}|${f.detail}|${f.fix}`; by.set(k, [...(by.get(k) ?? []), f]); }
  return [...by.values()].map((items) => {
    const f = items[0];
    return items.length === 1 ? single(f) : { key: `${f.area}/${f.detail}`, sev: f.sev, area: f.area, title: items.map((x) => x.title).join(", "), sub: what(items.length), detail: f.detail, fix: f.fix, items };
  });
}

export function watchRows(findings: Finding[]): WatchRow[] {
  const sites = findings.filter((f) => f.area === "sites"), ssh = findings.filter((f) => f.area === "ssh");
  const rest = findings.filter((f) => f.area !== "sites" && f.area !== "ssh").map(single);
  return [...rest, ...siteRows(sites), ...sameRows(ssh, (n) => tx("{0} machine(s)", n))]
    .sort((a, b) => Number(b.sev === "bad") - Number(a.sev === "bad") || AREAS.indexOf(a.area) - AREAS.indexOf(b.area) || b.items.length - a.items.length);
}
