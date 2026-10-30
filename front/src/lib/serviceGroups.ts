// Services page: the collected rows (one per NPM entry, port or container) gathered into real services, with a single state each.
import type { Host, ServiceStatus } from "../types";
import { tx } from "./i18n";
import { CLEANUP, checks, hostName, status } from "./status";

export type GroupTone = "ok" | "warn" | "bad" | "off";
export interface ServiceGroup {
  key: string; name: string; theme: string; hosts: Host[]; cards: ServiceStatus[]; domains: string[]; machines: string[];
  tech: boolean; cloud: boolean; problems: string[]; tone: GroupTone;
}

const PLUMBING = /^(nginx|apache|openssh|samba|cadvisor|anubis|munin)\b/i;
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
  const theme = themeOf(r.category), web = theme === tx("Sites web") || theme === OTHERS();
  return web ? (site ? tx("Sites web") : OTHERS()) : theme;
}
const CARD_THEME: Record<string, string[]> = { netatmo: ["Domotique"], freebox: ["Réseau / DNS"], unifi: ["Réseau / DNS"] };

/** Every real domain of a service: its NPM domains, or the ones its Apache / nginx declares */
export const hostDomains = (r: Host): string[] => (r.domains.length ? r.domains : r.vhost_domains ?? []);

/** What a row belongs to. Without a known application, each site with a domain is a service of its own, even on a shared address */
function placeOf(r: Host, apps: Map<string, string>): { key: string; name: string; tech: boolean; site: boolean } {
  if (r.type === "redirect" || r.type === "dead") return { key: "redirects", name: tx("Redirections et 404"), tech: true, site: false };
  const domain = hostDomains(r)[0], word = r.app?.label.split(/[ (]/)[0].toLowerCase() ?? "", seen = r.service && r.service.kind !== "web" ? r.service : null;
  // A guess from the port gives way to what really runs there (container, process), unless the domain says the same
  const sure = r.app && (r.app.confidence !== "possible" || !seen || !domain || domain.includes(word));
  const label = (sure ? r.app!.label.replace(/ \(.*$/, "") : "") || apps.get(`${r.ip}:${r.port}`);   // a domain in front of a known application is that application
  const plumbing = !!sure && (!!r.app?.agent_of || PLUMBING.test(r.app?.label ?? ""));
  if (plumbing && !domain) return { key: `tech:${r.app?.label}`, name: r.app?.label ?? "", tech: true, site: false };
  if (label && !plumbing) return { key: `app:${label}`, name: label, tech: false, site: false };
  if (domain && r.service?.kind === "docker" && r.service.name) return { key: `name:${r.service.name}`, name: r.service.name, tech: false, site: false };   // several addresses of one container
  if (domain) return { key: `site:${domain}`, name: hostName(r), tech: false, site: true };
  const name = r.service?.kind === "process" ? "" : r.service?.name || r.name;   // « python3 » or « node » say nothing: one service per address
  return name ? { key: `name:${name}`, name, tech: false, site: false } : { key: `at:${r.ip}:${r.port}`, name: hostName(r), tech: false, site: false };
}

function toneOf(hosts: Host[], cards: ServiceStatus[]): GroupTone {
  const seen = hosts.map((r) => status(r)[0]);
  if (seen.includes("bad") || cards.some((c) => !c.ok)) return "bad";
  const flagged = hosts.some((r) => status(r)[0] !== "off" && checks(r).some((k) => !CLEANUP.includes(k)));
  if (seen.includes("warn") || flagged || cards.some((c) => c.stale || c.problems?.length)) return "warn";
  return seen.includes("ok") || cards.length ? "ok" : "off";
}

/** `hidden`: rows hidden from the alerts, which no longer colour their service */
export function groupServices(hosts: Host[], cards: ServiceStatus[], hidden: (r: Host) => boolean = () => false): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>(), apps = new Map<string, string>();
  for (const r of hosts) if (r.app && r.app.confidence !== "possible" && !r.app.agent_of && !PLUMBING.test(r.app.label)) apps.set(`${r.ip}:${r.port}`, r.app.label.replace(/ \(.*$/, ""));
  for (const r of hosts) {
    const p = placeOf(r, apps), g = groups.get(p.key) ?? { key: p.key, name: p.name, theme: placeTheme(r, p.site), hosts: [], cards: [], domains: [], machines: [], tech: p.tech, cloud: false, problems: [], tone: "off" };
    if (g.theme === OTHERS() || g.theme === tx("Sites web")) g.theme = placeTheme(r, p.site);   // another row may know better
    g.hosts.push(r);
    g.domains = [...new Set([...g.domains, ...hostDomains(r)])];
    const machine = r.machine || r.host_ip || r.ip;
    if (machine && !g.machines.includes(machine)) g.machines.push(machine);
    groups.set(p.key, g);
  }
  const list = [...groups.values()];
  for (const c of cards) {
    const g = list.find((x) => x.hosts.some((r) => r.app?.connector === c.connector));
    if (g) g.cards.push(c);
    else list.push({ key: `card:${c.connector}:${c.name}`, name: c.label, theme: themeOf(CARD_THEME[c.connector]?.[0]), hosts: [], cards: [c], domains: [], machines: [], tech: false, cloud: !c.url, problems: [], tone: "off" });
  }
  for (const g of list) {
    const word = g.name.split(/[ (]/)[0].toLowerCase();
    g.domains.sort((a, b) => Number(b.includes(word)) - Number(a.includes(word)));   // the domain named after the service comes first
    g.problems = g.cards.flatMap((c) => c.problems ?? []);
    g.tone = toneOf(g.hosts.filter((r) => !hidden(r)), g.cards);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export const toCheck = (g: ServiceGroup) => g.tone === "warn" || g.tone === "bad";

/** The sentence above the list: the technical pieces are no services */
export function groupsTitle(groups: ServiceGroup[]): string {
  const real = groups.filter((g) => !g.tech), watch = real.filter(toCheck).length;
  return watch ? tx("{0} services, {1} à vérifier.", real.length, watch) : tx("{0} services, tout va bien.", real.length);
}

/** The headings of the list and the services under each one: a service on two machines shows under both */
export function sections(groups: ServiceGroup[], byMachine: boolean): { title: string; groups: ServiceGroup[] }[] {
  if (!byMachine) return themeOrder().map((title) => ({ title, groups: groups.filter((g) => g.theme === title) })).filter((s) => s.groups.length);
  const place = (g: ServiceGroup) => (g.cloud ? ["Cloud"] : g.machines.length ? g.machines : [tx("Autres")]);
  const titles = [...new Set(groups.flatMap(place))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return titles.map((title) => ({ title, groups: groups.filter((g) => place(g).includes(title)) }));
}
