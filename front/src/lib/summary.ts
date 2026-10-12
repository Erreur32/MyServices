// Accueil : ce qui demande l'attention (tous onglets confondus, trié par gravité) et un paragraphe par onglet.
// Texte en phrases, avec les noms (3 au plus, puis « … et N autres ») ; **gras** rendu par <Rich>.
import type { Backups, Data, Event, Events, Health, HealthHost, Level } from "../types";
import { bytes, splitHostName } from "./format";
import { CLEANUP, certIssue, checks, dnsDown, dnsSync, hostName, status } from "./status";
import { mState } from "./machines";
import { tx } from "./i18n";

export type TabId = "home" | "history" | "machines" | "services" | "health" | "security" | "virtualization" | "dns" | "backups" | "diagrams" | "settings";

export interface Attention {
  level: "crit" | "warn";
  text: string;
  tab: TabId;
  href?: string;  // adresse exacte (ex. « settings/machines ») quand l'onglet ne suffit pas
}

export interface Paragraph {
  tab: TabId;
  title: string;
  sentences: string[];
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
export function attention({ data, health, backups, now = Date.now() }: Inputs): Attention[] {
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
    if (l === "down") out.push({ level: "crit", text: tx("Santé : **{0}** est injoignable en SSH", machineOf(h)), tab: "health" });
    else if (l === "crit") out.push({ level: "crit", text: tx("Santé : **{0}** est en état critique{1}", machineOf(h), fullDisk(h)), tab: "health" });
    else if (l === "warn") out.push({ level: "warn", text: tx("Santé : **{0}** est à surveiller{1}", machineOf(h), fullDisk(h)), tab: "health" });
  }
  if (data.dns) {
    for (const n of dnsDown(data.dns)) out.push({ level: "crit", text: tx("AdGuard **{0}** ne répond pas", n), tab: "dns" });
    const s = dnsSync(data.dns, now);
    if (s.cls !== "ok") out.push({ level: s.cls === "bad" ? "crit" : "warn", text: tx("DNS AdGuard : {0}", s.label), tab: "dns" });
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

function servicesParagraph(data: Data): Paragraph {
  const npm = data.hosts.filter((r) => r.type !== "local"), local = data.hosts.filter((r) => r.type === "local");
  const by = (rows: typeof npm, cls: string) => rows.filter((r) => status(r)[0] === cls);
  const active = npm.filter((r) => r.enabled);
  const bad = by(npm, "bad"), warn = by(npm, "warn"), ok = by(active, "ok");
  const fix = npm.filter((r) => checks(r).some((c) => !CLEANUP.includes(c)));
  const cleanup = npm.filter((r) => checks(r).some((c) => CLEANUP.includes(c)));
  const certs = npm.filter((r) => r.enabled && certIssue(r));
  const s: string[] = [];
  if (npm.length) {
    s.push(tx("NPM publie {0} : {1} répondent normalement", plural(npm.length, "entrée"), ok.length)
      + (bad.length ? tx(", {0} en panne ({1})", bad.length, names(bad.map(hostName))) : "")
      + (warn.length ? tx(", {0} ({1})", plural(warn.length, "avertissement"), names(warn.map(hostName))) : "")
      + (npm.length - active.length ? tx(", {0} désactivées", npm.length - active.length) : "") + ".");
    if (certs.length) s.push(tx("{0} à renouveler bientôt ou invalide{1} : {2}.", plural(certs.length, "certificat"), certs.length > 1 ? "s" : "", names(certs.map(hostName))));
    if (fix.length || cleanup.length)
      s.push(tx("À corriger : {0} (accès, SSL, DNS…)", plural(fix.length, "entrée")) + (cleanup.length ? tx(" ; à nettoyer : {0} (désactivées dont le service est mort, ou en pause).", cleanup.length) : "."));
  }
  if (local.length) {
    const down = by(local, "bad");
    s.push(tx("{0} en accès direct sur le réseau local", plural(local.length, "service")) + (down.length ? tx(", dont {0} injoignable{1} ({2}).", down.length, down.length > 1 ? "s" : "", names(down.map(hostName))) : tx(", tous joignables.")));
  }
  return { tab: "services", title: tx("Services"), sentences: s };
}

function machinesParagraph(data: Data): Paragraph {
  const ms = data.machine_list.filter((m) => !m.disabled);
  const off = ms.filter((m) => m.off), down = ms.filter((m) => !m.off && !m.ping), up = ms.filter((m) => !m.off && m.ping);
  const s = [tx("{0} : {1} en ligne", plural(ms.length, "machine"), up.length)
    + (down.length ? tx(", {0} hors ligne ({1})", down.length, names(down.map((m) => m.name))) : "")
    + (off.length ? tx(", {0} éteinte{1} volontairement ({2})", off.length, off.length > 1 ? "s" : "", names(off.map((m) => m.name))) : "") + "."];
  const unreachable = (data.connectors || []).filter((c) => c.type === "docker" && !c.ok);
  if (unreachable.length) s.push(tx("Docker illisible sur {0} : leurs conteneurs ne sont pas à jour.", names(unreachable.map((c) => c.name))));
  return { tab: "machines", title: tx("Machines"), sentences: s };
}

function healthParagraph(h: Health): Paragraph {
  const at = (l: string) => h.hosts.filter((x) => healthLevel(x) === l).map(machineOf);
  const warn = at("warn"), crit = at("crit"), down = at("down"), reboot = h.hosts.filter((x) => x.reboot_required).map(machineOf);
  const ok = h.hosts.length - warn.length - crit.length - down.length;
  const s = [tx("{0} : {1} sans alerte", plural(h.hosts.length, "machine relevée", "machines relevées"), ok)
    + (warn.length ? tx(", {0} à surveiller ({1})", warn.length, names(warn)) : "")
    + (crit.length ? tx(", {0} en état critique ({1})", crit.length, names(crit)) : "")
    + (down.length ? tx(", {0} injoignable{1} ({2})", down.length, down.length > 1 ? "s" : "", names(down)) : "") + "."];
  if (reboot.length) s.push(tx("Redémarrage demandé sur {0}.", names(reboot)));
  return { tab: "health", title: tx("Santé"), sentences: s };
}

function dnsParagraph(data: Data, now: number): Paragraph | null {
  const g = data.dns;
  if (!g) return null;
  const srv = Object.values(g.servers), rows = data.hosts.filter((r) => r.dns && r.enabled);
  const bad = rows.filter((r) => r.dns!.issues.length);
  const rw = [...new Set(srv.map((x) => x.rewrites))].join(" / ");
  const s = [tx("{0} AdGuard ({1}), {2} réécritures ; {3}.", plural(srv.length, "instance"), srv.map((x) => x.name).join(", "), rw, dnsSync(g, now).label),
    tx("{0} domaines NPM sur {1} résolvent correctement", rows.length - bad.length, rows.length)
      + (bad.length ? tx(" ; à vérifier : {0}.", names(bad.map(hostName))) : ".")];
  if (g.orphans.length) s.push(tx("{0}, sans host NPM actif ({1}).", plural(g.orphans.length, "réécriture orpheline", "réécritures orphelines"), names(g.orphans.map((o) => o.domain))));
  return { tab: "dns", title: tx("DNS"), sentences: s };
}

function backupsParagraph(b: Backups): Paragraph {
  const m = b.summary;
  const s = [tx("{0} de sauvegarde sur {1}, {2} de sources : {3} à jour", plural(m.sets, "jeu", "jeux"), plural(m.hosts, "machine"), bytes(m.volume), m.ok)
    + (m.warn ? tx(", {0} en retard", m.warn) : "") + (m.crit ? tx(", {0} critique{1}", m.crit, m.crit > 1 ? "s" : "") : "") + "."];
  if (m.no_offsite) s.push(tx("{0} sans aucune copie hors de sa machine.", plural(m.no_offsite, "jeu", "jeux")));
  return { tab: "backups", title: tx("Sauvegardes"), sentences: s };
}

function eventTime(e: Event): number {
  if (e.ts) return new Date(e.ts).getTime();
  return e.at ? new Date(e.at.replace(" ", "T")).getTime() : NaN;
}

function historyParagraph(events: Event[], labels: Record<string, string>, now: number): Paragraph {
  const recent = events.filter((e) => now - eventTime(e) < 86400e3);
  if (!recent.length) return { tab: "history", title: tx("Dernières 24 h"), sentences: [tx("Aucun événement : rien n'est tombé, rien n'a changé.")] };
  const kinds = new Map<string, string[]>();
  for (const e of recent) kinds.set(e.kind, [...(kinds.get(e.kind) || []), e.label || e.machine || "?"]);
  const parts = [...kinds].sort((a, b) => b[1].length - a[1].length)
    .map(([k, who]) => `${who.length} × ${(labels[k] || k).replace(/^\S+\s/, "").toLowerCase()} (${names([...new Set(who)])})`);
  return { tab: "history", title: tx("Dernières 24 h"), sentences: [tx("{0} :", plural(recent.length, "événement")), ...parts] };  // en liste : une ligne par type
}

/** Paragraphes dans l'ordre des onglets ; un onglet sans données n'en a pas. */
export function paragraphs(i: Inputs): Paragraph[] {
  const now = i.now ?? Date.now();
  const out: (Paragraph | null)[] = [
    historyParagraph(i.events || [], i.labels || {}, now),
    machinesParagraph(i.data),
    servicesParagraph(i.data),
    i.health ? healthParagraph(i.health) : null,
    dnsParagraph(i.data, now),
    i.backups ? backupsParagraph(i.backups) : null,
  ];
  return out.filter((p): p is Paragraph => !!p && p.sentences.length > 0);
}
