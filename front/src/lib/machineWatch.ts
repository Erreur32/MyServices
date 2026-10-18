// « À surveiller » : tout ce qui demande un coup d'œil sur une machine, avec sa gravité et une icône. Sert à la colonne de l'onglet Machines et,
// pour la partie santé, à la liste de problèmes de l'onglet Machines (mêmes phrases aux deux endroits).
import type { Connector, HealthHost, Machine } from "../types";
import { MSTATE, mState } from "./machines";
import { tx } from "./i18n";

export type WatchTone = "bad" | "warn" | "info";
export type WatchKind = "down" | "ssh" | "disk" | "systemd" | "docker" | "kernel" | "smart" | "load" | "ssh_auth" | "mem" | "temp" | "reboot" | "updates" | "services" | "connector" | "access";
export interface WatchItem { tone: WatchTone; kind: WatchKind; text: string; detail?: string[] }   // detail: the messages behind the notice (kernel errors…), shown in its tooltip and in the machine window

/** The section of the machine window where a notice is explained (data-sec), so a badge can lead the eye there */
export const WATCH_SECTION: Record<WatchKind, "health" | "updates" | "access" | "services"> = {
  down: "access", ssh: "access", access: "access", disk: "health", systemd: "health", docker: "health", kernel: "health", smart: "health", load: "health",
  ssh_auth: "health", mem: "health", temp: "health", reboot: "updates", updates: "updates", services: "services", connector: "services",
};

export const RANK: Record<WatchTone, number> = { bad: 3, warn: 2, info: 1 };

/** Ce que la santé relevée reproche à une machine, en phrases courtes (vide = rien à signaler) */
export function healthItems(h: HealthHost): WatchItem[] {
  if (h.reachable === false) return [{ tone: "bad", kind: "down", text: tx("injoignable : ni SSH ni Beszel") }];
  const out: WatchItem[] = [];
  const add = (tone: WatchTone, kind: WatchKind, text: string, detail?: string[]) => out.push({ tone, kind, text, ...(detail?.length ? { detail } : {}) });
  for (const d of h.disks || []) if (d.critical || d.warning) add(d.critical ? "bad" : "warn", "disk", tx("disque {0} rempli à {1} %", d.mount, d.used_pct));
  const failed = h.systemd?.failed || [];
  if (failed.length) add("bad", "systemd", tx("{0} service(s) systemd en échec : {1}", failed.length, failed.map((u) => u.unit).join(", ")));
  const dk = h.docker;
  if (dk?.accessible && (dk.unhealthy || dk.restarting)) add("warn", "docker", tx("Docker : {0} unhealthy, {1} en redémarrage", dk.unhealthy || 0, dk.restarting || 0));
  if ((dk?.issues || []).length) add("warn", "docker", tx("Docker : {0}", dk!.issues!.join(", ")));
  if (h.kernel?.has_errors) add("warn", "kernel", tx("erreurs noyau récentes"), h.kernel.samples);
  for (const d of h.smart?.disks || []) if (d.failed || !d.healthy) add("bad", "smart", tx("SMART : {0} en défaut", d.device));
  if (h.load?.available && h.load.load_1 > h.load.ncpu) add("warn", "load", tx("charge {0} pour {1} CPU", h.load.load_1, h.load.ncpu));
  if (h.ssh_auth?.available && h.ssh_auth.failed_24h > 20) add("warn", "ssh_auth", tx("{0} connexions SSH refusées en 24 h", h.ssh_auth.failed_24h));
  if (h.res?.available && (h.res.mem_pct ?? 0) >= 90) add(h.res.mem_pct! >= 97 ? "bad" : "warn", "mem", tx("mémoire utilisée à {0} %", Math.round(h.res.mem_pct!)));
  if (h.temp?.available && h.temp.celsius! >= 85) add(h.temp.celsius! >= 95 ? "bad" : "warn", "temp", tx("processeur à {0} °C", h.temp.celsius));
  if (h.reboot_required) add("warn", "reboot", tx("redémarrage requis"));
  if (h.apt?.upgradable) add("warn", "updates", tx("{0} mise(s) à jour en attente", h.apt.upgradable));
  return out;
}

/** The access notice of a machine that is up but not (or badly) read: nothing, a notice, or null */
function accessItem(st: ReturnType<typeof mState>, readByTool: boolean): WatchItem | null {
  if (st === "down") return { tone: "bad", kind: "down", text: MSTATE.down[1] + " : " + MSTATE.down[2] };
  if (st === "refused") return { tone: "warn", kind: "ssh", text: tx("SSH refusé : la clé de l'app n'est pas autorisée sur la machine (ou le port est faux)") };
  if (st === "nossh" && !readByTool) return { tone: "info", kind: "access", text: tx("en ligne, sans accès SSH ni agent : ses conteneurs et sa santé ne sont pas lus") };
  return null;
}

/** Connectors in failure that concern this machine (the Docker one is shown as its own state) */
function connectorItems(m: Machine, connectors: Connector[]): WatchItem[] {
  const out: WatchItem[] = [];
  for (const c of connectors) if (c.ip === m.ip && !c.ok && c.type !== "docker") out.push({ tone: "warn", kind: "connector", text: `${c.type} ${c.name} : ${c.message}` });
  for (const a of m.api ?? []) if (!a.ok && !a.stale) out.push({ tone: "warn", kind: "connector", text: `${a.label} ${a.name} : ${a.message ?? tx("illisible")}` });   // connecteur API de cette machine en échec
  return out;
}

/** Tout ce qui est à surveiller sur une machine : accès (ping, SSH), santé, services en panne, connecteurs en échec ; le plus grave d'abord.
 *  Une machine non suivie ou éteinte volontairement n'a rien à surveiller. readByTool : lue par l'API d'un outil réseau (Freebox, UniFi), « sans SSH » n'est pas un manque. */
export function watchItems(m: Machine, h: HealthHost | undefined, connectors: Connector[] = [], readByTool = false): WatchItem[] {
  const st = mState(m);
  if (st === "disabled" || st === "off") return [];
  const out: WatchItem[] = [];
  const access = accessItem(st, readByTool);
  if (access) out.push(access);
  if (h && !(st === "down" && h.reachable === false)) out.push(...healthItems(h));
  if (m.down > 0) out.push({ tone: "bad", kind: "services", text: tx("{0} service(s) en panne", m.down) });
  out.push(...connectorItems(m, connectors));
  return out.sort((a, b) => RANK[b.tone] - RANK[a.tone]);
}

/** Gravité la plus haute, 0 si rien */
export const worst = (items: WatchItem[]): number => items.reduce((n, i) => Math.max(n, RANK[i.tone]), 0);

/** A journalctl line « oct. 17 21:02:11 host kernel: message » split into its time and its message (the host and « kernel: » add nothing here) */
export function kernelLine(line: string): { when: string; msg: string } {
  const m = /^(\S+\s+\d+\s+\d{2}:\d{2}:\d{2})\s+\S+\s+(?:kernel:\s*)?(.*)$/.exec(line.trim());
  return m ? { when: m[1], msg: m[2] } : { when: "", msg: line.trim() };
}
