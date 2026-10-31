// « À surveiller » : tout ce qui demande un coup d'œil sur une machine, avec sa gravité et une icône. Sert à la colonne de l'onglet Machines et,
// pour la partie santé, à la liste de problèmes de l'onglet Machines (mêmes phrases aux deux endroits).
import type { Connector, HealthHost, HostSystem, Machine } from "../types";
import { bytes, dur } from "./format";
import { shortProbe } from "./machineFigures";
import { MSTATE, mState } from "./machines";
import { tx } from "./i18n";

export type WatchTone = "bad" | "warn" | "info";
export type WatchKind = "down" | "ssh" | "disk" | "systemd" | "docker" | "kernel" | "smart" | "load" | "ssh_auth" | "mem" | "temp" | "reboot" | "updates" | "services" | "connector" | "access"
  | "pm2" | "raid" | "zfs" | "mounts" | "ntp" | "timers" | "auto_upd";
export interface WatchItem { tone: WatchTone; kind: WatchKind; text: string; detail?: string[] }   // detail: the messages behind the notice (kernel errors…), shown in its tooltip and in the machine window

/** The section of the machine window where a notice is explained (data-sec), so a badge can lead the eye there */
export const WATCH_SECTION: Record<WatchKind, "system" | "health" | "updates" | "access" | "services"> = {   // system: the measures (processor, memory, disks, temperature)
  down: "access", ssh: "access", access: "access", disk: "system", systemd: "health", docker: "health", kernel: "health", smart: "system", load: "system",
  ssh_auth: "health", mem: "system", temp: "system", reboot: "updates", updates: "updates", services: "services", connector: "services",
  pm2: "health", raid: "health", zfs: "health", mounts: "health", ntp: "health", timers: "health", auto_upd: "updates",
};

export const RANK: Record<WatchTone, number> = { bad: 3, warn: 2, info: 1 };

/** Ce que la santé relevée reproche à une machine, en phrases courtes (vide = rien à signaler) */
/** The same thresholds as health.py (host_checks): the sentence says what the server measured */
export const UU_STALE_DAYS = 3;   // health.py UU_STALE_DAYS
export const ZFS_BAD = ["FAULTED", "UNAVAIL", "SUSPENDED"];
const MB = 1048576, GB = 1073741824;
const LOAD_WARN_MULT = 1.5, LOAD_CRIT_MULT = 3, CPU_WARN_PCT = 90, SYSTEMD_CRIT_N = 3, DOCKER_CRIT_N = 3, SSH_AUTH_WARN_N = 20, SSH_AUTH_CRIT_N = 100;
const CHECK_KIND: Record<string, WatchKind> = { disk: "disk", systemd: "systemd", docker: "docker", kernel: "kernel", load: "load", ssh_auth: "ssh_auth", smart: "smart", temp: "temp", res: "mem",
  pm2: "pm2", raid: "raid", zfs: "zfs", mounts: "mounts", ntp: "ntp", timers: "timers", auto_upd: "auto_upd" };
const CHECK_TEXT: Record<string, () => string> = {
  disk: () => tx("un disque se remplit"), systemd: () => tx("des services systemd sont en échec"), docker: () => tx("des conteneurs Docker sont arrêtés ou en défaut"),
  kernel: () => tx("erreurs noyau récentes"), load: () => tx("processeur très sollicité"), ssh_auth: () => tx("beaucoup de connexions SSH refusées"),
  smart: () => tx("un disque est en défaut (SMART)"), temp: () => tx("processeur très chaud"), res: () => tx("mémoire presque pleine"),
  pm2: () => tx("PM2 arrêté ou une appli PM2 arrêtée"), raid: () => tx("une grappe RAID est dégradée"), zfs: () => tx("un pool ZFS n'est pas en bon état"),
  mounts: () => tx("un partage réseau ne répond pas"), ntp: () => tx("l'heure n'est pas synchronisée"), timers: () => tx("une tâche planifiée a échoué"),
  auto_upd: () => tx("les mises à jour automatiques ne passent plus"),
};

export const SHARE_STATE: Record<string, () => string> = { ok: () => tx("répond"), hang: () => tx("ne répond pas"), error: () => tx("en erreur"), missing: () => tx("non monté") };

type AddItem = (tone: WatchTone, kind: WatchKind, text: string, detail?: string[]) => void;

/** PM2: its systemd units, then the saved apps that do not run (or the stopped apps of a running PM2) */
function pm2Items(s: HostSystem, add: AddItem) {
  for (const u of s.pm2?.units ?? []) if (u.enabled && !u.active) add("warn", "pm2", tx("PM2 arrêté ({0})", u.unit.replace(/\.service$/, "")));
  const apps = s.pm2?.apps ?? [];
  if (s.pm2?.running === false && apps.some((a) => a.saved)) add("warn", "pm2", tx("PM2 arrêté : {0} appli(s) enregistrée(s) ne tournent pas", apps.filter((a) => a.saved).length));
  else if (s.pm2?.running && apps.some((a) => !a.up)) add("warn", "pm2", tx("PM2 : appli arrêtée : {0}", apps.filter((a) => !a.up).map((a) => a.name).join(", ")));
}

/** Software RAID arrays: degraded, or rebuilding (a scheduled check is not a rebuild) */
function raidItems(s: HostSystem, add: AddItem) {
  for (const a of s.raid?.arrays ?? []) {
    if (a.degraded && !a.rebuild) add("bad", "raid", tx("RAID {0} dégradé", a.name));
    else if (a.rebuild && a.rebuild.kind !== "check") add("warn", "raid", tx("RAID {0} en reconstruction ({1} %)", a.name, a.rebuild.pct));
  }
}

/** Storage: RAID arrays, ZFS pools and network shares */
function storageItems(s: HostSystem, add: AddItem) {
  raidItems(s, add);
  for (const p of s.zfs?.pools ?? []) if (p.health !== "ONLINE") add(ZFS_BAD.includes(p.health) ? "bad" : "warn", "zfs", tx("pool ZFS {0} : {1}", p.name, p.health));
  for (const m of s.mounts?.shares ?? []) if (!m.ok) add(m.state === "hang" ? "bad" : "warn", "mounts", tx("partage {0} : {1}", m.path, SHARE_STATE[m.state]?.() ?? m.state));
}

/** Automatic updates (unattended-upgrades): in error, or not run for too long */
function autoUpdItems(s: HostSystem, add: AddItem) {
  const u = s.auto_upd;
  if (!u?.available || !u.enabled) return;
  if (u.errors?.length) add("warn", "auto_upd", tx("mises à jour automatiques en erreur"), u.errors);
  else if (u.days != null && u.days > UU_STALE_DAYS) add("warn", "auto_upd", tx("mises à jour automatiques : dernier passage il y a {0} jours", Math.floor(u.days)));
}

/** Services and storage (health.py collect_system), with the same levels as system_levels */
function systemItems(h: HealthHost, add: AddItem) {
  const s = h.system;
  if (!s) return;
  pm2Items(s, add);
  storageItems(s, add);
  if (s.ntp?.available && !s.ntp.synced) add("warn", "ntp", tx("l'heure n'est pas synchronisée"));
  if (s.timers?.failed?.length) add("warn", "timers", tx("tâche(s) planifiée(s) en échec : {0}", s.timers.failed.join(", ")));
  autoUpdItems(s, add);
  if (s.snap?.pending) add("info", "updates", tx("{0} snap(s) à mettre à jour", s.snap.pending));
  const nr = s.needrestart?.services ?? [];
  if (nr.length) add("warn", "updates", tx("{0} service(s) à redémarrer après une mise à jour", nr.length), nr);
}

/** A disk's filling, with what is left when the machine reports it */
function diskText(d: NonNullable<HealthHost["disks"]>[number]): string {
  if (d.avail_gb == null || d.size_gb == null) return tx("disque {0} rempli à {1} %", d.mount, d.used_pct);
  return tx("disque {0} rempli à {1} % ({2} libres sur {3})", d.mount, d.used_pct, bytes(d.avail_gb * GB), bytes(d.size_gb * GB));
}

/** The memory in use, with the amounts when the machine reports them */
function memText(r: NonNullable<HealthHost["res"]>): string {
  const pct = Math.round(r.mem_pct!);
  if (r.mem_used_mb == null || r.mem_total_mb == null) return tx("mémoire utilisée à {0} %", pct);
  return tx("mémoire utilisée à {0} % ({1} sur {2})", pct, bytes(r.mem_used_mb * MB), bytes(r.mem_total_mb * MB));
}

/** What explains a hot processor: its thresholds, the hottest probe, and the load (a low one means the heat does not come from the work) */
function heatDetail(h: HealthHost): string[] {
  const t = h.temp, hottest = [...(t?.sensors ?? [])].sort((a, b) => b.celsius - a.celsius)[0], out: string[] = [];
  if (t?.warn_c != null && t.crit_c != null) out.push(tx("Avertissement à {0} °C, critique à {1} °C", t.warn_c, t.crit_c));
  if (hottest) out.push(tx("Capteur le plus chaud : {0} à {1} °C", shortProbe(hottest.name), hottest.celsius));
  if (h.load?.available && h.load.cpu_pct == null) out.push(tx("charge {0} pour {1} CPU", h.load.load_1, h.load.ncpu));
  return out;
}

/** Adds since when each notice lasts; the temperature says it in its own sentence.
 *  shortcut: one date per control, so two full disks share the oldest one; a date per disk if that ever misleads */
function withSince(items: WatchItem[], h: HealthHost): WatchItem[] {
  const since = new Map(Object.entries(h.check_s ?? {}).map(([check, s]) => [CHECK_KIND[check], s]));
  return items.map((i) => {
    const s = i.kind === "temp" ? 0 : since.get(i.kind) ?? 0;
    return s >= 60 ? { ...i, text: tx("{0}, depuis {1}", i.text, dur(s)) } : i;
  });
}

export function healthItems(h: HealthHost): WatchItem[] {
  if (h.reachable === false) return [{ tone: "bad", kind: "down", text: tx("injoignable : ni SSH ni Beszel") }];
  const out: WatchItem[] = [];
  const add = (tone: WatchTone, kind: WatchKind, text: string, detail?: string[]) => out.push({ tone, kind, text, ...(detail?.length ? { detail } : {}) });
  for (const d of h.disks || []) if (d.critical || d.warning) add(d.critical ? "bad" : "warn", "disk", diskText(d));
  const failed = h.systemd?.failed || [];
  if (failed.length) add(failed.length >= SYSTEMD_CRIT_N ? "bad" : "warn", "systemd", tx("{0} service(s) systemd en échec : {1}", failed.length, failed.map((u) => u.unit).join(", ")));
  const dk = h.docker, dkN = (dk?.unhealthy || 0) + (dk?.restarting || 0) + (dk?.exited || 0);
  if (dk?.accessible && dkN) add(dkN >= DOCKER_CRIT_N ? "bad" : "warn", "docker", tx("Docker : {0} unhealthy, {1} en redémarrage, {2} arrêté(s)", dk.unhealthy || 0, dk.restarting || 0, dk.exited || 0));
  if (dk?.issues?.length) add("warn", "docker", tx("Docker : {0}", dk.issues.map((c) => typeof c === "string" ? c : `${c.name} (${c.status})`).join(", ")));
  if (dk?.loops?.length) add("warn", "docker", tx("Docker : redémarre en boucle : {0}", dk.loops.map((c) => `${c.name} (${c.restarts})`).join(", ")));
  if (h.kernel?.has_errors) add("warn", "kernel", tx("erreurs noyau récentes"), h.kernel.samples);
  for (const d of h.smart?.disks || []) if (d.failed) add("bad", "smart", tx("SMART : {0} en défaut", d.device));
  if (h.load?.available) {
    if (h.load.cpu_pct != null) { if (h.load.cpu_pct >= CPU_WARN_PCT) add("warn", "load", tx("processeur à {0} %", Math.round(h.load.cpu_pct))); }   // Windows: instant CPU
    else if (h.load.load_1 >= LOAD_WARN_MULT * h.load.ncpu) add(h.load.load_1 >= LOAD_CRIT_MULT * h.load.ncpu ? "bad" : "warn", "load", tx("charge {0} pour {1} CPU", h.load.load_1, h.load.ncpu));
  }
  if (h.ssh_auth?.available && h.ssh_auth.failed_24h >= SSH_AUTH_WARN_N) add(h.ssh_auth.failed_24h >= SSH_AUTH_CRIT_N ? "bad" : "warn", "ssh_auth", tx("{0} connexions SSH refusées en 24 h", h.ssh_auth.failed_24h));
  if (h.res?.available && (h.res.mem_pct ?? 0) >= 90) add(h.res.mem_pct! >= 97 ? "bad" : "warn", "mem", memText(h.res));
  if (h.temp?.available && h.temp.celsius != null) {   // the server's level: the machine's own threshold, and only once it stays hot (a short peak is not an alert)
    const level = h.temp.level ?? (h.temp.celsius >= 95 ? "crit" : h.temp.celsius >= 85 ? "warn" : "ok");
    if (level === "warn" || level === "crit") add(level === "crit" ? "bad" : "warn", "temp", h.temp.hot_s ? tx("processeur à {0} °C depuis {1}", h.temp.celsius, dur(h.temp.hot_s)) : tx("processeur à {0} °C", h.temp.celsius), heatDetail(h));
  }
  systemItems(h, add);
  if (h.reboot_required) add("warn", "reboot", tx("redémarrage requis"));
  if (h.apt?.upgradable) add("warn", "updates", h.apt.security ? tx("{0} mise(s) à jour en attente, dont {1} de sécurité", h.apt.upgradable, h.apt.security) : tx("{0} mise(s) à jour en attente", h.apt.upgradable), h.apt.sample);
  // A control the server flags that nothing above explained (another threshold, a datum this page does not read): said anyway, in general terms
  for (const [check, level] of Object.entries(h.checks ?? {})) {
    const kind = CHECK_KIND[check];
    if (kind && (level === "warn" || level === "crit") && !out.some((i) => i.kind === kind)) add(level === "crit" ? "bad" : "warn", kind, CHECK_TEXT[check]());
  }
  return withSince(out, h);
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

/** Why the health of a machine is not « ok », short: what the server flagged when it says, the worst first; `kind` is the frame that explains it */
export function healthCauses(h: HealthHost, max = 2): { text: string; kind?: WatchKind } {
  const flagged = new Set(Object.entries(h.checks ?? {}).filter(([, level]) => level === "warn" || level === "crit").map(([check]) => CHECK_KIND[check]));
  const items = healthItems(h).filter((i) => i.tone !== "info" && (!flagged.size || flagged.has(i.kind))).sort((a, b) => RANK[b.tone] - RANK[a.tone]);
  const shown = items.slice(0, max).map((i) => i.text).join(", ");
  return { text: items.length > max ? tx("{0} (+{1})", shown, items.length - max) : shown, kind: items[0]?.kind };
}

/** Tout ce qui est à surveiller sur une machine : accès (ping, SSH), santé, services en panne, connecteurs en échec ; le plus grave d'abord.
 *  Une machine non suivie ou éteinte volontairement n'a rien à surveiller. downList : les services en panne (nom : cause). readByTool : lue par l'API d'un outil réseau (Freebox, UniFi), « sans SSH » n'est pas un manque. */
export function watchItems(m: Machine, h: HealthHost | undefined, connectors: Connector[] = [], readByTool = false, downList: string[] = []): WatchItem[] {
  const st = mState(m);
  if (st === "disabled" || st === "off") return [];
  const out: WatchItem[] = [];
  const access = accessItem(st, readByTool);
  if (access) out.push(access);
  if (h && !(st === "down" && h.reachable === false)) out.push(...healthItems(h));
  if (m.down > 0) out.push({ tone: "bad", kind: "services", text: tx("{0} service(s) en panne", m.down), ...(downList.length ? { detail: downList } : {}) });   // which ones, and why: in the tooltip and the machine window
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
