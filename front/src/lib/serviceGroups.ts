// Services page: the collected rows (one per NPM entry, port or container) gathered into real services, with a single state each.
import type { Host, ServiceStatus } from "../types";
import { tx } from "./i18n";
import { CLEANUP, checks, hostName, status } from "./status";
import { genericProcess } from "./servicesState";

export type GroupTone = "ok" | "warn" | "bad" | "off";
export interface ServiceGroup {
  key: string; name: string; theme: string; hosts: Host[]; cards: ServiceStatus[]; domains: string[]; machines: string[];
  tech: boolean; cloud: boolean; problems: string[]; tone: GroupTone;
}

const PLUMBING = /^(nginx|apache|openssh|samba|cadvisor|anubis|munin)\b/i;
const WINDOWS_PIECE = /^(system|svchost|lsass|services|wininit|spoolsv)$/i;   // what Windows itself listens with, no service of yours
const THEMES = (): [string, string[]][] => [
  [tx("Domotique"), ["Domotique"]],
  [tx("Fichiers et médias"), ["Fichiers / sync", "Médias", "Stream"]],
  [tx("IA"), ["IA"]],
  [tx("Supervision"), ["Monitoring", "Sécurité", "Système"]],
  [tx("Réseau"), ["Réseau / DNS", "Infra / virtualisation"]],
  [tx("Sites web"), ["Web / perso"]],
];
export const themeOrder = () => [...THEMES().map(([t]) => t), OTHERS()];
const OTHERS = () => tx("Autres");
const themeOf = (category?: string) => THEMES().find(([, c]) => c.includes(category ?? ""))?.[0] ?? OTHERS();
/** A plain site goes with the sites unless its category says more; an application is never a « website » */
function placeTheme(r: Host, site: boolean): string {
  const theme = themeOf(r.category);
  if (theme !== tx("Sites web") && theme !== OTHERS()) return theme;
  return site ? tx("Sites web") : OTHERS();
}
const CARD_THEME: Record<string, string[]> = { netatmo: ["Domotique"], tapo: ["Domotique"], freebox: ["Réseau / DNS"], unifi: ["Réseau / DNS"], "upnp-box": ["Réseau / DNS"], fritzbox: ["Réseau / DNS"], sfrbox: ["Réseau / DNS"], livebox: ["Réseau / DNS"], "vodafone-station": ["Réseau / DNS"], "sagemcom-fast": ["Réseau / DNS"], bbox: ["Réseau / DNS"], "swisscom-box": ["Réseau / DNS"], "connect-box": ["Réseau / DNS"], "speedport": ["Réseau / DNS"], "technicolor-gateway": ["Réseau / DNS"], "tmobile-home-internet": ["Réseau / DNS"], "hitron-coda": ["Réseau / DNS"], "verizon-fios": ["Réseau / DNS"], "arris-surfboard": ["Réseau / DNS"] };

/** Every real domain of a service: its NPM domains, or the ones its Apache / nginx declares */
export const hostDomains = (r: Host): string[] => (r.domains.length ? r.domains : r.vhost_domains ?? []);

type Place = { key: string; name: string; tech: boolean; site: boolean };

/** The place of a row whose application is known, null otherwise. A guess from the port gives way to what really runs there (container, process), unless the domain says the same */
function appPlace(r: Host, apps: Map<string, string>, domain?: string): Place | null {
  const word = r.app?.label.split(/[ (]/)[0].toLowerCase() ?? "", seen = r.service && r.service.kind !== "web" ? r.service : null;
  const sure = r.app && (r.app.confidence !== "possible" || !seen || !domain || domain.includes(word));
  const label = (sure ? r.app!.label.replace(/ \(.*$/, "") : "") || apps.get(`${r.ip}:${r.port}`);   // a domain in front of a known application is that application
  const plumbing = !!sure && (!!r.app?.agent_of || PLUMBING.test(r.app?.label ?? ""));
  if (plumbing && !domain) return { key: `tech:${r.app?.label}`, name: r.app?.label ?? "", tech: true, site: false };
  return label && !plumbing ? { key: `app:${label}`, name: label, tech: false, site: false } : null;
}

/** The place of a row without a known application: each site with a domain is a service of its own, even on a shared address */
function namedPlace(r: Host, domain?: string): Place {
  if (domain && r.service?.kind === "docker" && r.service.name) return { key: `name:${r.service.name}`, name: r.service.name, tech: false, site: false };   // several addresses of one container
  if (domain) return { key: `site:${domain}`, name: hostName(r), tech: false, site: true };
  const process = r.service?.kind === "process" ? r.service.name : "";
  if (process && !genericProcess(process)) return { key: `process:${process.toLowerCase()}`, name: process, tech: WINDOWS_PIECE.test(process), site: false };   // one card, on every machine and port
  const name = process ? "" : r.service?.name || r.name;   // « python3 » or « node » say nothing: one service per address
  return name ? { key: `name:${name}`, name, tech: false, site: false } : { key: `at:${r.ip}:${r.port}`, name: hostName(r), tech: false, site: false };
}

/** What a row belongs to */
function placeOf(r: Host, apps: Map<string, string>): Place {
  if (r.type === "redirect" || r.type === "dead") return { key: "redirects", name: tx("Redirections et 404"), tech: true, site: false };
  const domain = hostDomains(r)[0];
  return appPlace(r, apps, domain) ?? namedPlace(r, domain);
}

const containerOf = (r: Host) => (r.service?.kind === "docker" && r.service.name && r.type !== "redirect" && r.type !== "dead" ? `${r.machine || r.host_ip || r.ip}|${r.service.name}` : "");
const placeRank = (p: Place) => (p.tech ? 2 : Number(!p.key.startsWith("app:")));

/** A container is one service, whatever its ports, addresses and NPM hosts in front of it: all its rows take the place of the one that knows it best */
function containerPlaces(hosts: Host[], apps: Map<string, string>): Map<string, Place> {
  const best = new Map<string, Place>(), labels = new Map<string, string>();
  for (const r of hosts) {
    const key = containerOf(r);
    if (!key) continue;
    const place = placeOf(r, apps), kept = best.get(key);
    if (!kept || placeRank(place) < placeRank(kept)) best.set(key, place);
    if (r.app?.label && r.app.confidence !== "possible") labels.set(key, r.app.label.replace(/ \(.*$/, ""));
  }
  for (const [key, place] of best) if (place.key.startsWith("name:")) best.set(key, { ...place, name: labels.get(key) ?? place.name });   // its real name when a row knows it
  return best;
}

function toneOf(hosts: Host[], cards: ServiceStatus[]): GroupTone {
  const seen = new Set(hosts.map((r) => status(r)[0]));
  if (seen.has("bad") || cards.some((c) => !c.ok)) return "bad";
  const flagged = hosts.some((r) => status(r)[0] !== "off" && checks(r).some((k) => !CLEANUP.includes(k)));
  if (seen.has("warn") || flagged || cards.some((c) => c.stale || c.problems?.length)) return "warn";
  return seen.has("ok") || cards.length ? "ok" : "off";
}

function addRow(g: ServiceGroup, r: Host, p: Place): void {
  if (g.theme === OTHERS() || g.theme === tx("Sites web")) g.theme = placeTheme(r, p.site);   // another row may know better
  if (g.name === g.name.toLowerCase()) g.name = p.name;   // AnyDesk rather than anydesk, whichever machine comes first
  g.hosts.push(r);
  g.domains = [...new Set([...g.domains, ...hostDomains(r)])];
  const machine = r.machine || r.host_ip || r.ip;
  if (machine && !g.machines.includes(machine)) g.machines.push(machine);
}

/** The figures of a group once it has all its rows and cards */
function settle(g: ServiceGroup, hidden: (r: Host) => boolean): void {
  const word = g.name.split(/[ (]/)[0].toLowerCase();
  g.domains.sort((a, b) => Number(b.includes(word)) - Number(a.includes(word)));   // the domain named after the service comes first
  g.problems = g.cards.flatMap((c) => c.problems ?? []);
  g.tone = toneOf(g.hosts.filter((r) => !hidden(r)), g.cards);
}

/** `hidden`: rows hidden from the alerts, which no longer colour their service */
export function groupServices(hosts: Host[], cards: ServiceStatus[], hidden: (r: Host) => boolean = () => false): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>(), apps = new Map<string, string>();
  for (const r of hosts) if (r.app && r.app.confidence !== "possible" && !r.app.agent_of && !PLUMBING.test(r.app.label)) apps.set(`${r.ip}:${r.port}`, r.app.label.replace(/ \(.*$/, ""));
  const containers = containerPlaces(hosts, apps);
  for (const r of hosts) {
    const p = containers.get(containerOf(r)) ?? placeOf(r, apps), g = groups.get(p.key) ?? { key: p.key, name: p.name, theme: placeTheme(r, p.site), hosts: [], cards: [], domains: [], machines: [], tech: p.tech, cloud: false, problems: [], tone: "off" };
    addRow(g, r, p);
    groups.set(p.key, g);
  }
  const list = [...groups.values()];
  for (const c of cards) {
    const g = list.find((x) => x.hosts.some((r) => r.app?.connector === c.connector));
    if (g) g.cards.push(c);
    else list.push({ key: `card:${c.connector}:${c.name}`, name: c.label, theme: themeOf(CARD_THEME[c.connector]?.[0]), hosts: [], cards: [c], domains: [], machines: [], tech: false, cloud: !c.url, problems: [], tone: "off" });
  }
  for (const g of list) settle(g, hidden);
  return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Every port of a service, in order, for the line of its card */
export const groupPorts = (g: ServiceGroup): number[] => [...new Set(g.hosts.flatMap((r) => r.port ?? []))].sort((a, b) => a - b);

export const toCheck = (g: ServiceGroup) => g.tone === "warn" || g.tone === "bad";

/** The sentence above the list: the technical pieces are no services */
export function groupsTitle(groups: ServiceGroup[]): string {
  const real = groups.filter((g) => !g.tech), watch = real.filter(toCheck).length;
  return watch ? tx("{0} services, {1} à vérifier.", real.length, watch) : tx("{0} services, tout va bien.", real.length);
}

/** The headings of the list and the services under each one: a service on two machines shows under both */
export function sections(groups: ServiceGroup[], byMachine: boolean): { title: string; groups: ServiceGroup[] }[] {
  if (!byMachine) return themeOrder().map((title) => ({ title, groups: groups.filter((g) => g.theme === title) })).filter((s) => s.groups.length);
  const place = (g: ServiceGroup) => {
    if (g.cloud) return ["Cloud"];
    return g.machines.length ? g.machines : [tx("Autres")];
  };
  const titles = [...new Set(groups.flatMap(place))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return titles.map((title) => ({ title, groups: groups.filter((g) => place(g).includes(title)) }));
}
