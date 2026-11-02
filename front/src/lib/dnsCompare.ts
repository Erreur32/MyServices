// The comparison of the DNS page: for each name, what NPM, the DNS host, Cloudflare and the local DNS servers say about it, with one verdict.
// The alerts of the page are its rows, so everything that asks for an action sits in one table. Cloudflare's own check of each name is reused.
import type { CloudflareZone, Dns, Host } from "../types";
import { CHECK_ORDER, cloudflareChecks, recordOf, zoneOf, type Check, type CheckTone } from "./cloudflare";
import { ISSUE, npmWhere, type DnsRow } from "./dnsState";
import { tx } from "./i18n";
import { hostName } from "./status";

export type CloudState = "proxied" | "dns" | "wildcard" | "none" | "outside";
export interface CompareRow { key: string; name: string; note: string; npm: string; manager: string; cloud: CloudState | null; answer: string; tone: CheckTone; verdict: string }

type Machines = { ip: string; name: string }[];

export const isAlert = (r: CompareRow) => r.tone === "bad" || r.tone === "warn";

function cloudOf(name: string, zones: CloudflareZone[]): CloudState | null {
  if (!zones.length) return null;
  const z = zoneOf(name, zones);
  if (!z) return "outside";
  const r = recordOf(z, name);
  if (!r) return "none";
  if (r.name.startsWith("*.")) return "wildcard";
  return r.proxied ? "proxied" : "dns";
}

/** What the NS of a name's domain tell, nothing for an internal name */
const hostOf = (name: string, g: Dns): string | undefined => g.zones?.[name.split(".").slice(-2).join(".")];

/** Who runs the DNS of a name: a domain read by the connector is at Cloudflare, else its NS tell, and a name without NS is local */
function managerOf(name: string, g: Dns, zones: CloudflareZone[]): string {
  return zoneOf(name, zones) ? "Cloudflare" : hostOf(name, g) ?? tx("DNS local");
}

function answerText(answers?: Record<string, string[] | null>): string {
  if (!answers) return "-";
  const ips = [...new Set(Object.values(answers).flatMap((v) => v ?? []))];
  return ips.length ? ips.join(", ") : tx("aucune réponse");
}

function nameRow(g: Dns, r: Host, name: string, machines: Machines, zones: CloudflareZone[], cloudCheck?: Check): CompareRow {
  const kinds = (r.dns?.issues ?? []).filter((i) => i[1] === name).map((i) => String(i[0]));
  const where = npmWhere(g, machines, r.npm), manager = managerOf(name, g, zones), cloud = cloudOf(name, zones);
  const check = cloud === "wildcard" ? undefined : cloudCheck;   // a name of a wildcard is not a record of its own: what the check finds there is about the site, not the DNS
  const said = kinds.map((k) => ISSUE[k] ?? k);
  if (kinds.includes("absent")) said.push(tx("Retirer le nom du NPM {0}, ou créer l'enregistrement chez {1}", where, manager));
  let tone: CheckTone = check?.tone ?? (cloud === "outside" ? "info" : "ok");
  if (kinds.length) tone = kinds.includes("absent") ? "bad" : "warn";
  if (!said.length && cloud === "outside" && hostOf(name, g)) said.push(tx("Se change chez {0}", manager));
  const first = hostName(r);
  return { key: `${r.type}${r.id}/${name}`, name, note: first === name ? "" : tx("autre nom du host {0}", first), npm: where, manager, cloud, answer: answerText(r.dns?.answers?.[name]), tone, verdict: [...said, ...(check?.notes ?? [])].join(" · ") };
}

/** A Cloudflare name no active NPM host holds */
function cloudRow(g: Dns, c: Check, machines: Machines, zones: CloudflareZone[]): CompareRow {
  return { key: `cf/${c.name}`, name: c.name, note: c.via ? "" : tx("enregistrement sans host NPM actif"), npm: c.via ? npmWhere(g, machines, c.via) : "-", manager: "Cloudflare", cloud: cloudOf(c.name, zones), answer: "-", tone: c.tone, verdict: c.notes.join(" · ") };
}

/** The alerts that are about no name of a host: an instance, the sync, a machine name, the rewrites */
const watchRow = (w: DnsRow): CompareRow => ({ key: w.key, name: w.title, note: w.area, npm: "-", manager: "-", cloud: null, answer: "-", tone: w.sev, verdict: w.detail });

export function dnsCompare(g: Dns, hosts: Host[], machines: Machines, zones: CloudflareZone[], watch: DnsRow[]): CompareRow[] {
  const checks = new Map(cloudflareChecks(zones, hosts).map((c) => [c.name, c]));
  const out = watch.filter((w) => w.anchor !== "domains").map(watchRow), seen = new Set<string>();
  for (const r of hosts) {
    if (!r.enabled || !r.dns) continue;
    for (const name of (r.domains ?? []).map((d) => d.toLowerCase())) {
      seen.add(name);
      out.push(nameRow(g, r, name, machines, zones, checks.get(name)));
    }
  }
  for (const c of checks.values()) if (!seen.has(c.name)) out.push(cloudRow(g, c, machines, zones));
  return out.sort((a, b) => CHECK_ORDER.indexOf(a.tone) - CHECK_ORDER.indexOf(b.tone) || a.name.localeCompare(b.name));
}

/** The figures of the Cloudflare card */
export function cloudCounts(rows: CompareRow[]) {
  const count = (s: CloudState) => rows.filter((r) => r.cloud === s).length;
  return { proxied: count("proxied"), dns: count("dns"), wildcard: count("wildcard"), outside: count("outside"), alerts: rows.filter((r) => isAlert(r) && r.manager === "Cloudflare").length };
}
