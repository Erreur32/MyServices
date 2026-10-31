// The Cloudflare pages: domains read by the connector, what to improve on them, and the check of each name against the reverse proxy that really serves it.
import type { Snapshot } from "../api";
import type { CloudflareRecord, CloudflareZone, Host } from "../types";
import { tx } from "./i18n";

export const SETTINGS: { key: string; label: string }[] = [
  { key: "ssl", label: "SSL" }, { key: "always_use_https", label: tx("HTTPS forcé") }, { key: "min_tls_version", label: tx("TLS minimal") },
  { key: "security_header", label: "HSTS" }, { key: "security_level", label: tx("Niveau de sécurité") }, { key: "cache_level", label: tx("Cache") },
];
const LOW_CACHE = 0.01, ENOUGH_REQUESTS = 100;   // below that many requests a cache share says nothing
const OLD_TLS = new Set(["1.0", "1.1"]);

/** A check that asks for a look: the ones for information stay out of the counts */
export const isTrouble = (c: Check) => c.tone === "warn" || c.tone === "bad";

export const hasCloudflare = (s: Snapshot) => (s.data.services_status ?? []).some((c) => c.connector === "cloudflare");

/** Every domain read, once: two instances can share a domain */
export function cloudflareZones(s: Snapshot): CloudflareZone[] {
  const seen = new Map<string, CloudflareZone>();
  for (const c of s.data.services_status ?? []) for (const z of c.cloudflare?.zones ?? []) if (!seen.has(z.name)) seen.set(z.name, z);
  return [...seen.values()];
}

/** No proxied record: no request goes through Cloudflare, its settings apply to nothing */
export const dnsOnly = (z: CloudflareZone) => z.dns?.proxied === 0;

export function settingText(z: CloudflareZone, key: string): string {
  const v = z.settings[key];
  if (typeof v === "boolean") return v ? "on" : "off";
  return v ?? "?";
}

export type AdviceTone = "warn" | "info";
export interface Advice { key: string; tone: AdviceTone; title: string; who: string[]; why: string; fix: string; care: string }

export function advice(zones: CloudflareZone[]): Advice[] {
  const live = zones.filter((z) => !dnsOnly(z)), names = (list: CloudflareZone[]) => list.map((z) => z.name);
  const lowCache = live.filter((z) => z.traffic && z.traffic.requests >= ENOUGH_REQUESTS && z.traffic.cached / z.traffic.requests < LOW_CACHE);
  const noHsts = live.filter((z) => z.settings.security_header === false);
  const list: Advice[] = [
    { key: "clear", tone: "warn", title: tx("Liaison vers le serveur non chiffrée"), who: names(live.filter((z) => z.settings.ssl === "flexible" || z.settings.ssl === "off")),
      why: tx("Cloudflare parle à ton serveur en clair : le visiteur voit un cadenas, mais la fin du trajet n'est pas protégée."), fix: tx("SSL/TLS, Overview : Full (strict)."), care: tx("Un certificat valide doit être installé sur le serveur avant de changer.") },
    { key: "https", tone: "warn", title: tx("HTTPS non forcé"), who: names(live.filter((z) => z.settings.always_use_https === "off")),
      why: tx("Un visiteur arrivé par http:// reste sur une liaison non chiffrée."), fix: tx("SSL/TLS, Edge Certificates, Always Use HTTPS : On."), care: tx("Vérifier d'abord que le site répond bien en https://.") },
    { key: "tls", tone: "warn", title: tx("Ancien TLS encore accepté"), who: names(live.filter((z) => OLD_TLS.has(String(z.settings.min_tls_version)))),
      why: tx("Les versions 1.0 et 1.1 sont abandonnées et affaiblissent la connexion."), fix: tx("SSL/TLS, Edge Certificates, Minimum TLS Version : 1.2."), care: tx("De très vieux appareils ne pourront plus se connecter.") },
    { key: "full", tone: "warn", title: tx("SSL full, certificat non vérifié"), who: names(live.filter((z) => z.settings.ssl === "full")),
      why: tx("La liaison vers le serveur est chiffrée, mais Cloudflare accepte n'importe quel certificat."), fix: tx("SSL/TLS, Overview : Full (strict)."), care: tx("Un certificat valide doit être installé sur le serveur avant de changer.") },
    { key: "cache", tone: "warn", title: tx("Cache presque nul"), who: names(lowCache),
      why: tx("Moins de 1 % des requêtes sont servies par Cloudflare : tout repart vers ton serveur."), fix: tx("Regarder les en-têtes de cache du site, puis les règles de cache."), care: tx("Ne jamais mettre en cache une page privée ou connectée.") },
    { key: "hsts", tone: "info", title: tx("HSTS coupé"), who: names(noHsts),
      why: tx("C'est le réglage par défaut, pas une panne."), fix: tx("À activer seulement une fois HTTPS stable partout."), care: tx("Un souci de certificat peut alors bloquer les navigateurs qui l'ont mémorisé.") },
    { key: "unused", tone: "info", title: tx("Réglages sans effet"), who: names(zones.filter(dnsOnly)),
      why: tx("Aucun enregistrement n'est proxifié : rien ne passe par Cloudflare."), fix: tx("Rien à faire aujourd'hui."), care: tx("Passer en Full (strict) et forcer HTTPS avant d'activer le proxy.") },
  ];
  return list.filter((a) => a.who.length > 0);
}

/** The domain to compare the others with: the one closest to the safe settings, among those that serve traffic */
export function bestZone(zones: CloudflareZone[]): number {
  const score = (z: CloudflareZone) => (dnsOnly(z) ? -1 : 0) + Number(z.settings.ssl === "strict") + Number(z.settings.always_use_https === "on") + Number(z.settings.min_tls_version === "1.2" || z.settings.min_tls_version === "1.3");
  return zones.reduce((best, z, i) => (score(z) > score(zones[best]) ? i : best), 0);
}

export type CheckTone = "ok" | "info" | "warn" | "bad";
export interface Check { name: string; zone: string; record: "proxied" | "dns" | "none"; via: string | null; machine: string | null; code: number | null; tone: CheckTone; notes: string[] }

const ORDER: CheckTone[] = ["bad", "warn", "info", "ok"];
const wildcardOf = (name: string) => `*.${name.split(".").slice(1).join(".")}`;
const zoneOf = (name: string, zones: CloudflareZone[]) => zones.filter((z) => name === z.name || name.endsWith(`.${z.name}`)).sort((a, b) => b.name.length - a.name.length)[0];

/** The reverse proxy entries by name: NPM hosts, Apache and nginx vhosts; an enabled entry wins over a disabled one */
function hostsByName(hosts: Host[]): Map<string, Host> {
  const out = new Map<string, Host>();
  for (const h of hosts) {
    if (h.type !== "proxy" && h.type !== "redirect" && h.type !== "local") continue;
    for (const raw of [...(h.domains ?? []), ...(h.vhost_domains ?? [])]) {
      const name = raw.toLowerCase(), known = out.get(name);
      if (!known || (!known.enabled && h.enabled)) out.set(name, h);
    }
  }
  return out;
}

function recordOf(z: CloudflareZone, name: string): CloudflareRecord | undefined {
  const records = z.dns?.records ?? [], exact = records.filter((r) => r.name.toLowerCase() === name);
  if (exact.length) return exact.find((r) => r.proxied) ?? exact[0];
  return records.find((r) => r.name.toLowerCase() === wildcardOf(name));
}

function recordKind(r: CloudflareRecord | undefined): Check["record"] {
  if (!r) return "none";
  return r.proxied ? "proxied" : "dns";
}

function viaOf(h: Host | undefined): string | null {
  if (!h) return null;
  return [h.npm, h.vhost_server].filter(Boolean).join(" + ") || null;
}

/** What a name that goes through Cloudflare needs from the proxy behind it. Each rule gives its verdict with its reason. */
function proxiedTrouble(z: CloudflareZone, h: Host): [CheckTone, string][] {
  const ssl = z.settings.ssl, out: [CheckTone, string][] = [];
  if (!h.enabled) out.push(["bad", tx("hôte coupé alors que Cloudflare lui envoie le trafic")]);
  if ((ssl === "flexible" || ssl === "off") && h.ssl_forced) out.push(["bad", tx("boucle de redirection : Cloudflare arrive en http et l'hôte force HTTPS")]);
  if ((ssl === "full" || ssl === "strict") && h.npm && h.ssl === false) out.push(["bad", tx("SSL {0} sur Cloudflare, mais aucun certificat sur l'hôte", String(ssl))]);
  if (h.lan_only) out.push(["warn", tx("hôte réservé au réseau local : derrière Cloudflare, il voit les adresses de Cloudflare")]);
  if (h.npm && h.cloudflare === false) out.push(["warn", tx("vraie adresse des visiteurs non reprise (CF-Connecting-IP) : journaux et fail2ban voient Cloudflare")]);
  return out;
}

/** Each name that Cloudflare sends somewhere or that a reverse proxy serves in one of the domains, with what was found on both sides.
 *  A record with no site behind it and no proxy (mail…) is left out, and so is a local name with no public record. */
export function cloudflareChecks(zones: CloudflareZone[], hosts: Host[]): Check[] {
  const known = hostsByName(hosts), names = new Set<string>();
  for (const z of zones) for (const r of z.dns?.records ?? []) if (r.proxied && !r.name.startsWith("*.")) names.add(r.name.toLowerCase());
  for (const name of known.keys()) if (!name.startsWith("*.") && zoneOf(name, zones)) names.add(name);
  const out: Check[] = [];
  for (const name of names) {
    const z = zoneOf(name, zones);
    if (!z) continue;
    const h = known.get(name) ?? known.get(wildcardOf(name)), r = recordOf(z, name);
    if (!r && h?.lan_only) continue;
    const found: [CheckTone, string][] = [];
    if (r?.proxied && h) found.push(...proxiedTrouble(z, h));
    else if (r?.proxied) found.push(["info", tx("proxifié, mais aucun hôte connu : il est servi ailleurs, ou le reverse proxy n'est pas lu")]);
    else if (r && h && !h.lan_only) found.push(["info", tx("DNS seul : l'adresse du serveur est visible de tous")]);
    else if (!r && h) found.push([h.public_ok ? "warn" : "info", tx("aucun enregistrement dans Cloudflare : ce nom ne répond pas depuis Internet")]);
    const code = h?.public?.code ?? null;
    if (code !== null && code >= 500) found.push(["bad", tx("répond {0}", code)]);
    if (h?.public?.cert_ok === false) found.push(["warn", tx("certificat refusé")]);
    const tone = ORDER.find((t) => found.some(([x]) => x === t)) ?? "ok";
    out.push({ name, zone: z.name, record: recordKind(r), via: viaOf(h), machine: h?.machine ?? null, code, tone, notes: found.map(([, t]) => t) });
  }
  return out.sort((a, b) => ORDER.indexOf(a.tone) - ORDER.indexOf(b.tone) || a.name.localeCompare(b.name));
}

/** The dots of the side menu: what to correct on each sub-page */
export function cloudflareCounts(s: Snapshot): Record<string, number> {
  if (!hasCloudflare(s)) return {};
  const zones = cloudflareZones(s);
  return { "cloudflare-overview": advice(zones).filter((a) => a.tone === "warn").length,
           "cloudflare-checks": cloudflareChecks(zones, s.data.hosts).filter(isTrouble).length };
}

/** Requests of each day over all the domains, in date order */
export function requestsByDay(zones: CloudflareZone[]): { date: string; requests: number }[] {
  const days = new Map<string, number>();
  for (const z of zones) for (const d of z.traffic?.days ?? []) days.set(d.date, (days.get(d.date) ?? 0) + d.requests);
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, requests]) => ({ date, requests }));
}

/** The top of a chart: the first round figure (1, 2, 5 × 10^n) at or above the highest bar */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((k) => k * unit).find((v) => v >= n) ?? n;
}
