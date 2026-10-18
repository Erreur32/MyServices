// Accueil : ce qui demande l'attention (tous onglets confondus, trié par gravité) et le paragraphe des dernières 24 h.
// Texte en phrases, avec les noms (3 au plus, puis « … et N autres ») ; **gras** rendu par <Rich>.
import type { Backups, Data, Event, Events, Health, HealthHost, Level } from "../types";
import { splitHostName } from "./format";
import { certIssue, dnsDown, dnsSync, hostName, status } from "./status";
import { mState } from "./machines";
import { tx } from "./i18n";

export type TabId = "home" | "history" | "machines" | "services" | "infra" | "security" | "security2" | "virtualization" | "network" | "dns" | "backups" | "diagrams" | "settings";

export interface Attention {
  level: "crit" | "warn";
  text: string;
  tab: TabId;
  href?: string;  // adresse exacte (ex. « settings/machines ») quand l'onglet ne suffit pas
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

/** Message technique raccourci (erreur SSH brute…) : le détail reste dans l'onglet */
function short(msg: string, max = 70): string {
  return msg.length > max ? `${msg.slice(0, max - 1).trimEnd()}…` : msg;
}

function healthLevel(h: HealthHost): Level | "na" {
  return h.reachable === false ? "down" : h.level || "ok";
}

function fullDisk(h: HealthHost): string {
  const d = (h.disks || []).filter((x) => x.critical || x.warning).sort((a, b) => b.used_pct - a.used_pct)[0];
  return d ? tx(" (disque {0} à {1} %)", d.mount, d.used_pct) : "";
}

/** Liste « à regarder » : rouge d'abord, puis orange, dans l'ordre des onglets. */
export function attention({ data, health, backups }: Inputs): Attention[] {
  const out: Attention[] = [];
  for (const m of data.machine_list)
    if (!m.ping && !m.off && !m.disabled) out.push({ level: "crit", text: tx("La machine **{0}** ({1}) ne répond plus au ping", m.name, m.ip), tab: "machines" });
  // En ligne mais sans accès SSH utilisable : ni conteneurs ni santé lus (box et machines éteintes volontairement exclues)
  const noSsh = data.machine_list.filter((m) => m.ping && !m.off && !m.disabled && !m.gateway && !m.local && ["nossh", "refused"].includes(mState(m)));
  if (noSsh.length)
    out.push({ level: "warn", text: tx("{0} sans accès SSH utilisable ({1}) : leurs conteneurs et leur santé ne sont pas lus", plural(noSsh.length, "machine"), names(noSsh.map((m) => m.name))), tab: "machines" });
  // NPM : entrées actives avec un avertissement (accès, SSL, DNS…), en une seule ligne
  const npmWarn = data.hosts.filter((r) => r.type !== "local" && r.enabled && !r.paused && status(r)[0] === "warn");
  if (npmWarn.length)
    out.push({ level: "warn", text: tx("{0} NPM avec avertissement : {1}", plural(npmWarn.length, "entrée"), names(npmWarn.map(hostName))), tab: "services" });
  for (const r of data.hosts) {
    const [cls, label] = status(r);
    if (cls === "bad") out.push({ level: "crit", text: tx("**{0}** ne répond plus ({1}){2}", hostName(r), label, r.machine ? tx(", sur {0}", r.machine) : ""), tab: "services" });
    const cert = r.enabled && !r.paused ? certIssue(r) : "";
    if (cert) out.push({ level: "warn", text: tx("**{0}** : {1}", hostName(r), cert), tab: "services" });
  }
  for (const h of health?.hosts || []) {
    const l = healthLevel(h);
    if (l === "down") out.push({ level: "crit", text: tx("Santé : **{0}** est injoignable en SSH", machineOf(h)), tab: "machines" });
    else if (l === "crit") out.push({ level: "crit", text: tx("Santé : **{0}** est en état critique{1}", machineOf(h), fullDisk(h)), tab: "machines" });
    else if (l === "warn") out.push({ level: "warn", text: tx("Santé : **{0}** est à surveiller{1}", machineOf(h), fullDisk(h)), tab: "machines" });
  }
  const reboot = (health?.hosts || []).filter((h) => h.reboot_required).map(machineOf);
  if (reboot.length) out.push({ level: "warn", text: tx("Redémarrage demandé sur {0}", names(reboot)), tab: "machines" });
  if (data.dns) {
    for (const n of dnsDown(data.dns)) out.push({ level: "crit", text: tx("AdGuard **{0}** ne répond pas", n), tab: "dns" });
    const s = dnsSync(data.dns, Date.parse(data.generated));
    if (s.cls !== "ok") out.push({ level: s.cls === "bad" ? "crit" : "warn", text: tx("DNS AdGuard : {0}", s.label), tab: "dns" });
    if (data.dns.orphans.length) out.push({ level: "warn", text: tx("{0}, sans host NPM actif ({1})", plural(data.dns.orphans.length, "réécriture AdGuard orpheline", "réécritures AdGuard orphelines"), names(data.dns.orphans.map((o) => o.domain))), tab: "dns" });
  }
  for (const i of backups?.issues || [])
    out.push({ level: i.level === "warn" ? "warn" : "crit", text: tx("Sauvegarde **{0}** : {1}", i.set, i.text), tab: "backups" });
  const dockerOff = (data.connectors || []).filter((c) => c.type === "docker" && !c.ok);
  if (dockerOff.length)
    out.push({ level: "warn", text: tx("Docker illisible sur {0} : leurs conteneurs ne sont pas à jour", names(dockerOff.map((c) => c.name))), tab: "settings", href: "settings/machines" });
  for (const c of data.connectors || [])
    if (!c.ok && c.type !== "docker") out.push({ level: "warn", text: tx("Connecteur **{0}** ({1}) : {2}", c.name, c.type, short(c.message)), tab: "settings" });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "crit" ? -1 : 1));
}
