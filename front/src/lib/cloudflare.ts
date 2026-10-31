// The Cloudflare pages: domains read by the connector, what to improve on them, and the check of each name against the reverse proxy that really serves it.
import type { Snapshot } from "../api";
import type { CloudflareDetail, CloudflareLine, CloudflarePeriod, CloudflarePeriodKey, CloudflarePoint, CloudflareRecord, CloudflareTotals, CloudflareZone, Host } from "../types";
import { LOCALE, tx } from "./i18n";

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

export const CHECK_ORDER: CheckTone[] = ["bad", "warn", "info", "ok"];
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

function recordTrouble(z: CloudflareZone, r: CloudflareRecord | undefined, h: Host | undefined): [CheckTone, string][] {
  if (r?.proxied) return h ? proxiedTrouble(z, h) : [["info", tx("proxifié, mais aucun hôte connu : il est servi ailleurs, ou le reverse proxy n'est pas lu")]];
  if (r && h && !h.lan_only) return [["info", tx("DNS seul : l'adresse du serveur est visible de tous")]];
  if (!r && h) return [[h.public_ok ? "warn" : "info", tx("aucun enregistrement dans Cloudflare : ce nom ne répond pas depuis Internet")]];
  return [];
}

function checkOf(name: string, z: CloudflareZone, r: CloudflareRecord | undefined, h: Host | undefined): Check {
  const found = recordTrouble(z, r, h), code = h?.public?.code ?? null;
  if (code !== null && code >= 500) found.push(["bad", tx("répond {0}", code)]);
  if (h?.public?.cert_ok === false) found.push(["warn", tx("certificat refusé")]);
  const tone = CHECK_ORDER.find((t) => found.some(([x]) => x === t)) ?? "ok";
  return { name, zone: z.name, record: recordKind(r), via: viaOf(h), machine: h?.machine ?? null, code, tone, notes: found.map(([, t]) => t) };
}

function namesToCheck(zones: CloudflareZone[], known: Map<string, Host>): Set<string> {
  const proxied = zones.flatMap((z) => z.dns?.records ?? []).filter((r) => r.proxied).map((r) => r.name.toLowerCase());
  const served = [...known.keys()].filter((name) => zoneOf(name, zones));
  return new Set([...proxied, ...served].filter((name) => !name.startsWith("*.")));
}

/** Each name that Cloudflare sends somewhere or that a reverse proxy serves in one of the domains, with what was found on both sides.
 *  A record with no site behind it and no proxy (mail…) is left out, and so is a local name with no public record. */
export function cloudflareChecks(zones: CloudflareZone[], hosts: Host[]): Check[] {
  const known = hostsByName(hosts), out: Check[] = [];
  for (const name of namesToCheck(zones, known)) {
    const z = zoneOf(name, zones);
    if (!z) continue;
    const h = known.get(name) ?? known.get(wildcardOf(name)), r = recordOf(z, name);
    if (r || !h?.lan_only) out.push(checkOf(name, z, r, h));
  }
  return out.sort((a, b) => CHECK_ORDER.indexOf(a.tone) - CHECK_ORDER.indexOf(b.tone) || a.name.localeCompare(b.name));
}

/** The dots of the side menu: what to correct on each sub-page */
export function cloudflareCounts(s: Snapshot): Record<string, number> {
  if (!hasCloudflare(s)) return {};
  const zones = cloudflareZones(s);
  return { "cloudflare-overview": advice(zones).filter((a) => a.tone === "warn").length,
           "cloudflare-checks": cloudflareChecks(zones, s.data.hosts).filter(isTrouble).length };
}

const TOTALS: (keyof CloudflareTotals)[] = ["requests", "cached", "bytes", "cached_bytes", "threats", "errors", "visitors"];
export const LINES = 6;   // lines of each breakdown of the traffic page
const addTotals = (list: CloudflareTotals[]) => Object.fromEntries(TOTALS.map((k) => [k, list.reduce((a, t) => a + (t[k] ?? 0), 0)])) as unknown as CloudflareTotals;

function addDetails(read: CloudflarePeriod[]): CloudflareDetail {
  const count = (pick: (p: CloudflarePeriod) => number | undefined) => read.reduce((a, p) => a + (pick(p) ?? 0), 0);
  const lines = (pick: (p: CloudflarePeriod) => CloudflareLine[] | undefined) => addLines(read.map((p) => pick(p) ?? []));
  const events = new Map<string, number>();
  for (const e of read.flatMap((p) => p.security?.points ?? [])) events.set(e.at, (events.get(e.at) ?? 0) + e.events);
  return { visits: count((p) => p.visits), page_views: count((p) => p.page_views), paths: lines((p) => p.paths), agents: lines((p) => p.agents), methods: lines((p) => p.methods), cache: lines((p) => p.cache), origin: lines((p) => p.origin),
           security: { events: count((p) => p.security?.events), points: [...events].map(([at, n]) => ({ at, events: n })).sort((a, b) => a.at.localeCompare(b.at)), sample: count((p) => p.security?.sample),
                       actions: lines((p) => p.security?.actions), sources: lines((p) => p.security?.sources), targets: lines((p) => p.security?.targets), countries: lines((p) => p.security?.countries) },
           dns: { total: count((p) => p.dns?.total), names: lines((p) => p.dns?.names), types: lines((p) => p.dns?.types), codes: lines((p) => p.dns?.codes) } };
}

function addLines(lists: CloudflareLine[][]): CloudflareLine[] {
  const all = new Map<string, CloudflareLine>();
  for (const line of lists.flat()) {
    const seen = all.get(line.name);
    all.set(line.name, seen ? { ...seen, requests: seen.requests + line.requests, threats: (seen.threats ?? 0) + (line.threats ?? 0), bytes: (seen.bytes ?? 0) + (line.bytes ?? 0) } : line);
  }
  return [...all.values()].sort((a, b) => b.requests - a.requests);
}

/** A period over the domains given, or null before the first read of the 24 hours and 30 days */
export function trafficOf(zones: CloudflareZone[], key: CloudflarePeriodKey): (CloudflarePeriod & CloudflareDetail) | null {
  const read = zones.flatMap((z) => z.traffic?.periods?.[key] ?? []);
  if (!read.length) return null;
  const points = new Map<string, CloudflarePoint>();
  for (const p of read.flatMap((r) => r.points)) {
    const seen = points.get(p.at);
    points.set(p.at, { at: p.at, ...addTotals(seen ? [seen, p] : [p]) });
  }
  const status = new Map<number, number>();
  for (const s of read.flatMap((r) => r.status)) status.set(s.code, (status.get(s.code) ?? 0) + s.requests);
  const lines = (pick: (p: CloudflarePeriod) => CloudflareLine[]) => addLines(read.map(pick));
  return { ...addTotals(read), previous: addTotals(read.map((r) => r.previous)), points: [...points.values()].sort((a, b) => a.at.localeCompare(b.at)),
           status: [...status].map(([code, requests]) => ({ code, requests })), countries: lines((p) => p.countries), content: lines((p) => p.content), tls: lines((p) => p.tls), http: lines((p) => p.http),
           browsers: lines((p) => p.browsers), hosts: read.flatMap((r) => r.hosts).sort((a, b) => b.requests - a.requests), ...addDetails(read) };
}

/** Percent of change against the period before, null when there is nothing to compare with */
export const trendOf = (now: number, before: number) => (before ? Math.round((100 * (now - before)) / before) : null);

const SERVER_ERRORS: Record<number, string> = {
  500: tx("erreur du serveur"), 502: tx("passerelle en erreur"), 503: tx("service indisponible"), 504: tx("passerelle trop lente"), 520: tx("réponse vide ou inattendue du serveur"),
  521: tx("serveur éteint ou qui refuse Cloudflare"), 522: tx("serveur injoignable"), 523: tx("serveur inaccessible"), 524: tx("serveur trop lent à répondre"),
  525: tx("connexion SSL refusée par le serveur"), 526: tx("certificat du serveur non valide"),
};
const CERTIFICATE = new Set([525, 526]);
export type AnswerLine = { name: string; requests: number; tone?: "ok" | "warn" | "bad"; why?: string };

/** What visitors receive: the good answers by family, each server error by its own code since each has its own cause */
export function answerLines(p: CloudflarePeriod): AnswerLine[] {
  const family = (n: number) => p.status.filter((s) => Math.floor(s.code / 100) === n).reduce((a, s) => a + s.requests, 0);
  const groups: AnswerLine[] = [{ name: tx("Réussies (2xx)"), requests: family(2), tone: "ok" }, { name: tx("Redirigées (3xx)"), requests: family(3) }, { name: tx("Refusées ou introuvables (4xx)"), requests: family(4), tone: "warn" }];
  const errors = p.status.filter((s) => s.code >= 500 && s.code < 600).sort((a, b) => b.requests - a.requests).slice(0, LINES)
    .map((s): AnswerLine => ({ name: `${s.code} ${SERVER_ERRORS[s.code] ?? tx("erreur du serveur")}`, requests: s.requests, tone: "bad", why: CERTIFICATE.has(s.code) ? tx("Vérifie le certificat du serveur ou du proxy.") : undefined }));
  return [...groups.filter((g) => g.requests), ...errors];
}

const ACTIONS: Record<string, [string, string?]> = {
  block: [tx("Bloqué")], link_maze_injected: [tx("Piège à robots injecté"), tx("Le robot reçoit de fausses pages plutôt que le site.")], skip: [tx("Laissé passer par une règle")],
  managed_challenge: [tx("Vérification adaptée")], challenge: [tx("Vérification demandée")], js_challenge: [tx("Vérification JavaScript")], log: [tx("Noté seulement")],
};
const SOURCES: Record<string, string> = { linkMaze: tx("Piège à robots IA"), firewallManaged: tx("Règles gérées par Cloudflare"), firewallCustom: tx("Tes règles"), botFight: tx("Protection contre les robots"), securityLevel: tx("Niveau de sécurité"), ratelimit: tx("Limite de requêtes"), waf: tx("Pare-feu applicatif") };
const CACHE: Record<string, [string, string?, AnswerLine["tone"]?]> = {
  dynamic: [tx("Dynamique"), tx("Cloudflare ne garde pas ces pages : souvent du HTML.")], none: [tx("Sans cache"), tx("Réponse d'erreur ou requête bloquée.")], hit: [tx("Trouvé en cache"), undefined, "ok"],
  miss: [tx("Absent du cache")], bypass: [tx("Contourné")], expired: [tx("Expiré")], revalidated: [tx("Revalidé")], updating: [tx("En cours de mise à jour")], stale: [tx("Périmé, servi quand même")],
};
const ORIGIN: Record<number, string> = { 200: tx("réussie"), 301: tx("redirection"), 302: tx("redirection"), 304: tx("inchangée"), 401: tx("connexion demandée"), 403: tx("refusée"), 404: tx("introuvable"), 500: tx("erreur du serveur"), 502: tx("passerelle en erreur"), 503: tx("service indisponible") };
const QUERY_TYPES: Record<string, string> = { A: tx("A (adresse IPv4)"), AAAA: tx("AAAA (adresse IPv6)"), DNSKEY: tx("DNSKEY (signature)"), MX: tx("MX (e-mail)") };
const PROBE = /(^|\/)(wp-login\.php|xmlrpc\.php|wp-admin|\.env|\.git|phpmyadmin|admin\.php)(\/|$)/i;   // what scanners ask for on any site

/** What the firewall did, in words */
export function actionLine(l: CloudflareLine): AnswerLine {
  const [name, why] = ACTIONS[l.name] ?? [l.name];
  return { name, why, requests: l.requests, tone: l.name === "block" ? "bad" : undefined };
}
export const sourceName = (name: string) => SOURCES[name] ?? name;
export function cacheLine(l: CloudflareLine): AnswerLine {
  const [name, why, tone] = CACHE[l.name] ?? [l.name];
  return { name, why, tone, requests: l.requests };
}
function originTone(code: number): AnswerLine["tone"] {
  if (code >= 500) return "bad";
  if (code >= 400) return "warn";
  return code < 300 ? "ok" : undefined;
}
/** What the server answered, as Cloudflare saw it; 0: it was not reached, or kept silent */
export function originLine(l: CloudflareLine): AnswerLine {
  const code = Number(l.name);
  if (code === 0) return { name: tx("Aucune réponse"), requests: l.requests, tone: "warn", why: tx("Requête arrêtée avant le serveur, servie par le cache, ou serveur muet.") };
  return { name: `${code} ${ORIGIN[code] ?? ""}`.trim(), requests: l.requests, tone: originTone(code) };
}
export const queryTypeName = (name: string) => QUERY_TYPES[name] ?? name;
/** A path a scanner asks for stands out: it says nothing of the site, only that robots are looking for a flaw */
export function pathLine(l: CloudflareLine): AnswerLine {
  return PROBE.test(l.name) ? { name: l.name, requests: l.requests, tone: "warn", why: tx("Souvent un robot qui cherche une faille.") } : { name: l.name, requests: l.requests };
}

/** A country from its two letter code; Cloudflare also sends T1 for Tor and XX for unknown, kept as they are */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([LOCALE], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The top of a chart: the first round figure (1, 2, 5 × 10^n) at or above the highest bar */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((k) => k * unit).find((v) => v >= n) ?? n;
}
