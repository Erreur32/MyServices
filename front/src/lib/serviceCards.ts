// The cards of a page that gathers one family of services (« IA et agents », « Vidéo et caméras »): the connectors of the family first,
// then the rows of Services of the family that none of them reads (« unread », with the connector to add when there is one). Nothing is
// probed here: the state is the one of the Services row, the content the one the connector read.
import type { Snapshot } from "../api";
import type { Host, ServiceStatus } from "../types";
import type { Prefill } from "./connectorPrefill";
import { tx } from "./i18n";
import { hostName, status } from "./status";
import { serviceKey } from "./servicesHidden";

export type Tone = "ok" | "warn" | "bad" | "off";
export const TONE_ORDER: Tone[] = ["bad", "warn", "ok", "off"];

export interface ServiceCard<R extends string> {
  key: string; title: string; role: R; engine?: string; app?: string;
  ip?: string; port?: number; machine?: string; version?: string | null;
  tone: Tone; state: string;
  conn?: ServiceStatus; host?: Host; serviceHash?: string;   // serviceHash: the page of its Services row
  problems: string[]; unread: boolean; partial: boolean;
  connector?: string | null;   // unread: the connector that would read it, if there is one
  prefill?: Prefill;            // unread with a connector: its form, filled with this address
}

/** What makes a connector or a row part of the family */
export interface Family<R extends string> {
  /** a connector of the family: its role and name; null when it is not one */
  conn: (c: ServiceStatus) => { role: R; title: string; partial?: boolean } | null;
  /** a row of Services of the family */
  row: (r: Host) => boolean;
  /** the role of a row by its app */
  roleOfApp: (key?: string) => R;
}

/** Host and port of an address (« http://10.0.0.5:11434/v1 » -> 10.0.0.5, 11434), the scheme's port when none is written */
export function addrOf(url?: string | null): { host: string; port: number } | null {
  try {
    const u = new URL(String(url ?? ""));
    return { host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80) };
  } catch {
    return null;
  }
}

export const rowIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";
export const machinesByIp = (snap: Snapshot) => new Map(snap.data.machine_list.map((x) => [x.ip, x.name]));

/** The rows of Services by « ip:port » of their backend, a direct row before one behind the proxy */
function rowsByAddr(hosts: Host[]): Map<string, Host> {
  const out = new Map<string, Host>();
  for (const r of [...hosts].sort((a, b) => Number(b.type === "local") - Number(a.type === "local"))) {
    const k = `${rowIp(r)}:${r.port}`;
    if (rowIp(r) && r.port && !out.has(k)) out.set(k, r);
  }
  return out;
}

/** The Services row an address leads to: same ip:port, else a domain of a row */
function rowOf(url: string | null | undefined, byAddr: Map<string, Host>, hosts: Host[]): Host | undefined {
  const a = addrOf(url);
  if (!a) return undefined;
  return byAddr.get(`${a.host}:${a.port}`) ?? hosts.find((r) => r.domains?.includes(a.host));
}

function connTone(c: ServiceStatus, r?: Host): [Tone, string] {
  if (!c.ok) return ["bad", c.message || tx("injoignable")];
  if (c.stale) return ["warn", tx("dernier relevé conservé")];
  if (r) { const [cls, label] = status(r); if (cls === "bad" || cls === "off") return [cls, label]; }
  return (c.problems ?? []).length ? ["warn", tx("à regarder")] : ["ok", tx("en ligne")];
}

export const cardHash = (r: Host) => `#services/all/${encodeURIComponent(serviceKey(r))}`;

/** What the cards built so far cover: « ip:port » of a connector, « connector type @ ip » to skip the other ports of the same app */
interface Covered { addr: Set<string>; readOn: Set<string> }

/** The card of one connector of the family, marking what it covers */
function connectorCard<R extends string>(c: ServiceStatus, kind: { role: R; title: string; partial?: boolean }, ctx: { byAddr: Map<string, Host>; hosts: Host[]; names: Map<string, string> }, cov: Covered): ServiceCard<R> {
  const a = addrOf(c.url), r = rowOf(c.url, ctx.byAddr, ctx.hosts), ip = r ? rowIp(r) : a?.host;
  const [tone, state] = connTone(c, r);
  if (r) cov.addr.add(`${rowIp(r)}:${r.port}`);
  if (a) cov.addr.add(`${a.host}:${a.port}`);
  if (ip) cov.readOn.add(`${c.connector}@${ip}`);
  return {
    key: `c:${c.connector}/${c.instance ?? c.name}`, title: kind.title, role: kind.role, engine: kind.title, ip, port: a?.port,
    machine: r?.machine || (ip ? ctx.names.get(ip) : undefined), version: c.version, tone, state, conn: c, host: r,
    serviceHash: r ? cardHash(r) : undefined, problems: c.problems ?? [], unread: false, partial: !!kind.partial,
  };
}

/** The connector form of an unread row, filled with its address, when a connector would read it */
function rowPrefill(best: Host, machine?: string): Prefill | undefined {
  const ip = rowIp(best);
  if (!best.app?.connector || !ip) return undefined;
  return { type: best.app.connector, name: (machine || ip).toLowerCase(), url: `http://${ip}:${best.port}` };
}

/** The card of a row of Services that no connector reads (« k »: its « ip:port ») */
function rowCard<R extends string>(r: Host, k: string, fam: Family<R>, byAddr: Map<string, Host>, names: Map<string, string>): ServiceCard<R> {
  const best = byAddr.get(k) ?? r, [cls, label] = status(best), machine = best.machine || names.get(rowIp(best));
  return {
    key: `h:${k}`, title: best.app?.label ?? best.name ?? hostName(best), app: best.app?.key, role: fam.roleOfApp(best.app?.key),
    ip: rowIp(best), port: best.port, machine, tone: cls, state: label, host: best,
    serviceHash: cardHash(best), problems: [], unread: true, partial: false, connector: best.app?.connector ?? null,
    prefill: rowPrefill(best, machine),
  };
}

/** Every service of the family, one card each (unsorted): its connectors, then its rows of Services that none of them covers */
export function serviceCards<R extends string>(snap: Snapshot, fam: Family<R>): ServiceCard<R>[] {
  const hosts = snap.data.hosts ?? [], byAddr = rowsByAddr(hosts), names = machinesByIp(snap);
  const out: ServiceCard<R>[] = [], cov: Covered = { addr: new Set<string>(), readOn: new Set<string>() };
  for (const c of snap.data.services_status ?? []) {
    const kind = fam.conn(c);
    if (kind) out.push(connectorCard(c, kind, { byAddr, hosts, names }, cov));
  }
  const seen = new Set<string>();
  for (const r of hosts) {
    const k = `${rowIp(r)}:${r.port}`;
    if (!fam.row(r) || cov.addr.has(k) || seen.has(k)) continue;
    if (r.app?.connector && cov.readOn.has(`${r.app.connector}@${rowIp(r)}`)) continue;   // another port of an app already read on this machine
    seen.add(k);
    out.push(rowCard(r, k, fam, byAddr, names));
  }
  return out;
}

/** What needs an eye first, then the roles in their order, then by name */
export function sortCards<R extends string, C extends ServiceCard<R>>(cards: C[], roles: R[]): C[] {
  return [...cards].sort((x, y) => TONE_ORDER.indexOf(x.tone) - TONE_ORDER.indexOf(y.tone) || roles.indexOf(x.role) - roles.indexOf(y.role) || x.title.localeCompare(y.title));
}

/** One line of « À surveiller » */
export interface WatchLine { tone: Tone; title: string; detail?: string; hash?: string; prefill?: Prefill }

/** The lines every family page shows first: a connector in error or with problems, then the services seen but not read */
export function cardAlerts<R extends string>(cards: ServiceCard<R>[], hashOf: (c: ServiceCard<R>) => string | undefined): WatchLine[] {
  const out: WatchLine[] = [];
  for (const c of cards.filter((x) => !x.unread)) {
    if (c.tone === "bad") out.push({ tone: "bad", title: tx("{0} : {1}", c.title, c.state), detail: c.machine, hash: c.serviceHash });
    else for (const p of c.problems) out.push({ tone: "warn", title: tx("{0} : {1}", c.title, p), detail: c.machine, hash: hashOf(c) });
  }
  return out;
}

export function unreadAlerts<R extends string>(cards: ServiceCard<R>[], roles: R[]): WatchLine[] {
  return cards.filter((x) => x.unread && x.prefill && roles.includes(x.role)).map((c) => (
    { tone: "off", title: tx("{0} sur {1} : contenu non lu", c.title, c.machine ?? c.ip ?? "?"), detail: tx("En ligne dans Services, mais aucun connecteur ne le lit."), prefill: c.prefill }));
}
