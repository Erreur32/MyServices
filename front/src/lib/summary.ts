// Accueil : ce qui demande l'attention (tous onglets confondus, trié par gravité) et le paragraphe des dernières 24 h.
// Texte en phrases, avec les noms (3 au plus, puis « … et N autres ») ; **gras** rendu par <Rich>.
import { serviceKey } from "./servicesHidden";
import type { Backups, Data, Event, Events, Health, HealthHost, Host, Level } from "../types";
import type { Selected } from "./filter";
import { splitHostName } from "./format";
import { CHECK, CLEANUP, certIssue, checks, dnsDown, dnsSync, hostName, status } from "./status";
import { tx } from "./i18n";
import { healthCauses, hungOnly } from "./machineWatch";
import { machineTag } from "./richText";
import { localVia } from "./eventOrigin";

export type TabId = "home" | "history" | "machines" | "services" | "domotique" | "cloudflare" | "ai" | "stream" | "security" | "virtualization" | "network" | "dns" | "backups" | "diagrams" | "settings";

/** The families the attention card is sorted into */
export type Category = "machines" | "services" | "sante" | "dns" | "sauvegardes" | "connecteurs";

export interface Attention {
  category: Category;
  level: "crit" | "warn";
  text: string;
  tab: TabId;
  action: string;   // the button's label: where the line leads (« Voir la machine », « Voir le jeu »…)
  sel?: Selected;   // filter applied on arrival in the tab (the line lands on what it talks about)
  href?: string;  // adresse exacte (ex. « settings/machines ») quand l'onglet ne suffit pas
  fix?: { label: string; href: string };   // administrator: the setting that settles the alert, beside the button that shows it
  dot?: string;   // the menu entry that carries the dot when it is not the tab's own entry (« connectors » for a connector in trouble)
  help?: string;  // the hint under the line when it depends on the cause (health); absent: the hint of its category, "" none
  via?: string[]; // what read the line (same labels as the Historique's « Lu par »): absent where the source is already obvious (ping, AdGuard…)
}

export interface Inputs {
  data: Data;
  health?: Health | null;
  backups?: Backups | null;
  events?: Event[]; // watcher + santé, toutes dates
  labels?: Events["labels"];
  now?: number;
}

/** « **A**, **B**, **C** … et 2 autres » */
export function names(list: string[], max = 3): string {
  const shown = list.slice(0, max).map((n) => `**${n}**`).join(", ");
  return list.length > max ? tx("{0} … et {1} autre{2}", shown, list.length - max, list.length - max > 1 ? "s" : "") : shown;
}

/** « 3 services » / « 1 service », traduit (les deux formes françaises sont des clés de lib/en.ts) */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${tx(n > 1 ? many : word)}`;
}


const machineOf = (h: HealthHost) => splitHostName(h.name)[0];

const machineFix = (ip: string) => (ip ? { label: tx("Régler la machine"), href: `machines/${ip}/settings` } : undefined);

/** Message technique raccourci (erreur SSH brute…) : le détail reste dans l'onglet */
function short(msg: string, max = 70): string {
  return msg.length > max ? `${msg.slice(0, max - 1).trimEnd()}…` : msg;
}

function healthLevel(h: HealthHost): Level | "na" {
  return h.reachable === false ? "down" : h.level || "ok";
}

/** Machines tab filtered on the Santé facet: the machines whose health is not « ok », the ones the menu's dot lists */
const HEALTH_SEL: Selected = { health: ["warn", "crit", "down"] };

/** What a click on a menu dot filters its page on, by menu entry: exactly what the dot's tooltip lists, so the dot and the list agree.
 *  Machines: the Santé facet, not « Alertes » (the wider « À surveiller » column); Services: its « Alertes » facet (down or warning, not
 *  hidden from the alerts, see tabs/Services alerting). An entry absent here (Connecteurs) opens on its address. */
export const DOT_FILTER: Partial<Record<string, Selected>> = {
  machines: HEALTH_SEL, services: { alert: ["on"] }, network: { alert: ["on"] }, backups: { alerts: ["on"] }, dns: { alerts: ["on"] },
};

/** Lines shown one by one above that many NPM entries in warning they are grouped: the home page stays short */
const NPM_LINES = 3;
/** The service in the list, opened on what to check */
const serviceHref = (r: Host) => `services/all/${encodeURIComponent(serviceKey(r))}`;

/** What read this service row: NPM for a proxied entry, else what read the local port (localVia) */
const rowVia = (r: Host): string[] => (r.type === "local" ? localVia(r.service?.kind, r.by_agent) : ["NPM"]);

/** NPM entries in warning: each with its exact reason and its link, or one line when there are many */
function npmWarnings(hosts: Host[]): Attention[] {
  const warn = hosts.filter((r) => r.type !== "local" && r.enabled && !r.paused && status(r)[0] === "warn"), sel = { src: ["npm"], status: ["warn"] };
  if (warn.length > NPM_LINES)
    return [{ category: "services", level: "warn", text: tx("{0} NPM avec avertissement : {1}", plural(warn.length, "entrée"), names(warn.map(hostName))), tab: "services", action: tx("Voir les entrées"), sel }];
  return warn.map((r) => {
    const why = checks(r).filter((k) => !CLEANUP.includes(k)).map((k) => CHECK[k][0]).join(", ") || status(r)[1];
    return { category: "services", level: "warn", text: tx("**{0}** : {1}", hostName(r), why), tab: "services", action: tx("Voir le service"), sel, href: serviceHref(r), via: rowVia(r) };
  });
}

/** The hint under a health line: only where there is something to know or a setting to change */
function healthHelp(h: HealthHost, kind?: string): string {
  if (kind === "kernel" && hungOnly(h)) return tx("Rien à faire si une copie tournait à cette heure : l'avertissement s'efface seul 12 h après.");
  return kind === "disk" || kind === "mem" || kind === "temp" ? tx("Si c'est son niveau normal, monte le seuil dans Régler la machine.") : "";
}

/** A machine whose health needs a look: its name, the exact trouble, and a link to the frame of its page that explains it */
function healthLine(h: HealthHost, l: "down" | "crit" | "warn", data: Data): Attention {
  const ip = splitHostName(h.name)[1], name = data.machine_list.find((m) => m.ip === ip)?.name || machineOf(h);
  const base = { category: "sante" as const, level: l === "warn" ? "warn" as const : "crit" as const, tab: "machines" as const, sel: HEALTH_SEL, fix: machineFix(ip) };
  const tag = machineTag(name);
  if (l === "down") return { ...base, text: tx("{0} est injoignable", tag), action: tx("Voir la machine"), href: ip ? `machines/${ip}` : undefined, help: "" };
  const cause = healthCauses(h);
  const general = l === "crit" ? tx("{0} est en état critique", tag) : tx("{0} est à surveiller", tag);
  const page = cause.kind ? `machines/${ip}/watch/${cause.kind}` : `machines/${ip}`;
  return { ...base, text: cause.text ? `${tag} ${cause.text}` : general, action: tx("Voir la santé"), href: ip ? page : undefined, help: healthHelp(h, cause.kind) };
}

/** Liste « à regarder » : rouge d'abord, puis orange, dans l'ordre des onglets. */
export function attention({ data, health, backups }: Inputs): Attention[] {
  const out: Attention[] = [];
  for (const m of data.machine_list)
    if (!m.ping && !m.off && !m.disabled) out.push({ category: "machines", level: "crit", text: tx("{0} ne répond plus au ping ({1})", machineTag(m.name), m.ip), tab: "machines", action: tx("Voir la machine"), sel: { state: ["down"] }, href: `machines/${m.ip}`, fix: machineFix(m.ip) });
  out.push(...npmWarnings(data.hosts));
  for (const r of data.hosts) {
    const [cls, label] = status(r);
    if (cls === "bad") out.push({ category: "services", level: "crit", text: tx("**{0}** ne répond plus ({1}){2}", hostName(r), label, r.machine ? tx(", sur {0}", machineTag(r.machine)) : ""), tab: "services", action: tx("Voir le service"), sel: { status: ["bad"] }, href: serviceHref(r), fix: { label: tx("Régler le service"), href: `services/edit/${encodeURIComponent(serviceKey(r))}` }, via: rowVia(r) });
    const cert = r.enabled && !r.paused ? certIssue(r) : "";
    if (cert) out.push({ category: "services", level: "warn", text: tx("**{0}** : {1}", hostName(r), cert), tab: "services", action: tx("Voir le site"), sel: { status: ["warn"] }, href: serviceHref(r), via: rowVia(r) });
  }
  for (const h of health?.hosts || []) {
    const l = healthLevel(h);
    if (l === "down" || l === "crit" || l === "warn") out.push(healthLine(h, l, data));
  }
  const reboot = (health?.hosts || []).filter((h) => h.reboot_required);
  if (reboot.length) {
    const ip = reboot.length === 1 ? splitHostName(reboot[0].name)[1] : "";
    const tags = reboot.map((h) => { const at = splitHostName(h.name)[1]; return machineTag(machineOf(h), at ? `machines/${at}/watch/reboot` : undefined); });
    out.push({ category: "sante", level: "warn", text: tx("Redémarrage demandé {0}", tags.join(" ")), tab: "machines", action: tx("Voir les machines"), href: ip ? `machines/${ip}/watch/reboot` : undefined });
  }
  if (data.dns) {
    for (const n of dnsDown(data.dns)) out.push({ category: "dns", level: "crit", text: tx("Le serveur DNS **{0}** ne répond pas", n), tab: "dns", action: tx("Voir le DNS"), sel: { alerts: ["on"] } });
    const s = dnsSync(data.dns, Date.parse(data.generated));
    if (s.cls !== "ok") out.push({ category: "dns", level: s.cls === "bad" ? "crit" : "warn", text: tx("DNS AdGuard : {0}", s.label), tab: "dns", action: tx("Voir le DNS"), sel: { alerts: ["on"] } });
    if (data.dns.orphans.length) out.push({ category: "dns", level: "warn", text: tx("{0}, sans host NPM actif ({1})", plural(data.dns.orphans.length, "réécriture AdGuard orpheline", "réécritures AdGuard orphelines"), names(data.dns.orphans.map((o) => o.domain))), tab: "dns", action: tx("Voir les réécritures"), sel: { alerts: ["on"] } });
  }
  for (const i of backups?.issues || [])
    out.push({ category: "sauvegardes", level: i.level === "warn" ? "warn" : "crit", text: tx("Sauvegarde **{0}** : {1}", i.set, i.text), tab: "backups", action: tx("Voir le jeu"), sel: i.set_id ? { alerts: ["on"] } : { state: ["crit", "down", "warn"] }, fix: i.set_id ? { label: tx("Régler le jeu"), href: "settings/backups" } : undefined });   // a set: the sets on Alerts; a machine (disk, unreachable): the machines in trouble
  const dockerOff = (data.connectors || []).filter((c) => c.type === "docker" && !c.ok);
  if (dockerOff.length)
    out.push({ category: "connecteurs", level: "warn", text: tx("Docker illisible sur {0} : leurs conteneurs ne sont pas à jour", names(dockerOff.map((c) => c.name))), tab: "settings", action: tx("Voir l'accès"), dot: "machines", href: "settings/machines" });
  for (const c of data.connectors || [])
    if (c.type !== "docker" && (!c.ok || (!c.ip && (c.stale || c.warning)))) {   // the reading itself in trouble; what the tool reports (a Nextcloud share) stays on its card, a partial SSH reading of a machine (ip) on Machines
      let why = short(c.message);
      if (c.ok) why = c.stale ? tx("lecture périmée") : short(c.warning!);
      out.push({ category: "connecteurs", level: "warn", text: tx("Connecteur **{0}** ({1}) : {2}", c.name, c.type, why), tab: "settings", action: tx("Voir le connecteur"), dot: "connectors", href: "settings/connectors" });
    }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "crit" ? -1 : 1));
}

