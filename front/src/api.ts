// Lecture des fichiers produits par les tâches et de l'API v1 (même origine, cookie de session).
import { serverText, translateConnectorMessages, translateConnectorTypes, translateLabels } from "./lib/serverText";
import type { AddressSheet, Backups, ConnectorType, Data, Event, Events, Health, Me, Host, StoredEvent } from "./types";
import { tx } from "./lib/i18n";

export const ROOT = "/";   // the app is served at the root of the site (before 0.10.2: /myservices/)
export const LOGIN = `${ROOT}login.html?next=${encodeURIComponent(ROOT)}`;

export class LoginRequired extends Error {}

/** Fichiers produits : revalidés (ETag, 304 sans corps si rien n'a changé) ; API : jamais en cache. */
async function get<T>(path: string, optional = false): Promise<T | null> {
  const live = path.startsWith("api/");
  const url = ROOT + path + (live ? (path.includes("?") ? "&" : "?") + `t=${Date.now()}` : "");
  const r = await fetch(url, { cache: live ? "no-store" : "no-cache" });
  if (r.status === 401) throw new LoginRequired();
  if (!r.ok) {
    if (optional) return null;
    throw new Error(tx("{0} : HTTP {1}", path, r.status));
  }
  return r.json() as Promise<T>;
}

export interface Snapshot {
  me: Me;
  data: Data;
  health: Health | null;
  backups: Backups | null;
  events: Event[];
  labels: Events["labels"];
  severity: Events["severity"];
}

/** Installation neuve : connecté, mais aucune collecte encore (pas de data.json). */
export class NotConfigured extends Error {
  constructor(public me: Me) { super(tx("pas encore configurée")); }
}

/** Pouls (pulse.json) : l'état du ping de chaque machine, confirmé, bien plus frais que data.json (collecte toutes les 15 min) */
interface Pulse { ts: number; machines: Record<string, { ping: boolean; ms: number | null; since: number }> }
const PULSE_MAX_AGE_S = 300;

const recent = (p: Pulse | null): p is Pulse => !!p && Date.now() / 1000 - p.ts <= PULSE_MAX_AGE_S;

/** Le « ip:port » suivi par le pouls des services, même règle que pulse.port_of */
function portOf(r: Host): string {
  const b = r.backend;
  if (!r.enabled || r.paused || r.machine_off || r.stopped || !b || b.internal || typeof b.up !== "boolean" || (b.up && r.web === "none" && !r.by_agent)) return "";
  return r.ip && r.port ? `${r.ip}:${r.port}` : "";
}

/** data.json avec le pouls par-dessus (ping des machines, port des services), s'il est récent ; sinon tel quel */
export function withPulse(data: Data, p: Pulse | null, ports: Pulse | null = null): Data {
  let out = data;
  if (recent(p) && data.machine_list.some((m) => p.machines[m.ip] && p.machines[m.ip].ping !== m.ping)) {
    out = { ...out, machine_list: data.machine_list.map((m) => { const live = p.machines[m.ip]; return live ? { ...m, ping: live.ping } : m; }) };
  }
  if (recent(ports)) {
    const up = (r: Host) => ports.machines[portOf(r)]?.ping;
    if (data.hosts.some((r) => up(r) != null && up(r) !== r.backend?.up)) {
      out = { ...out, hosts: data.hosts.map((r) => (up(r) == null ? r : { ...r, backend: { ...r.backend, up: up(r) } })) };
    }
  }
  return out;
}

/** Lectures légères des connecteurs (live.json, toutes les 5 min) : MynetworK (état, ports et date de leur scan), invités Proxmox par API */
export interface Live {
  ts: number;
  sources: Record<string, { at: number; ok: boolean; devices?: Record<string, { status: string; ping_ms: number | null; ports: number[]; ports_at: string | null }>; guests?: Record<string, string>; details?: Record<string, AddressSheet>; status?: Record<string, { status: string; name: string }> }>;
}
const LIVE_MAX_AGE_S = 900;

/** data.json avec les lectures rapides par-dessus (appareils du scanner, invités Proxmox par API) ; sans lecture récente, tel quel */
export function withLive(data: Data, live: Live | null): Data {
  if (!live || Date.now() / 1000 - live.ts > LIVE_MAX_AGE_S) return data;
  let moved = false;
  const sheets = Object.values(live.sources).reduce<Record<string, AddressSheet>>((all, s) => (s.ok ? { ...all, ...s.details } : all), {});
  const network = data.network?.map((row) => {
    const src = live.sources[`${row.connector}/${row.name}`];
    if (row.connector !== "mynetwork" || !src?.ok || !src.devices) return row;
    moved = true;
    return { ...row, devices: (row.devices ?? []).map((d) => { const l = src.devices![d.ip]; return l ? { ...d, ...l } : d; }) };
  });
  const virtualization = data.virtualization?.map((row) => {
    const src = live.sources[`${row.connector}/${row.name}`];
    if (row.via === "ssh" || !src?.ok || !src.guests || !row.guests) return row;
    moved = true;
    return { ...row, guests: row.guests.map((g) => { const s = src.guests![`${g.node}/${g.vmid}`]; return s ? { ...g, status: s } : g; }) };
  });
  // Beszel: the red or green of its badge follows the status it gives now, not the one of the last full collection
  const beszel = Object.entries(live.sources).filter(([k, s]) => k.startsWith("beszel/") && s.ok && s.status);
  let machine_list = data.machine_list;
  if (beszel.length) {
    machine_list = data.machine_list.map((m) => {
      const hit = beszel.map(([k, s]) => ({ inst: k.slice(7), st: s.status![m.ip] })).find((x) => x.st);
      const src = m.links?.sources.find((x) => x.source === "beszel" && x.instance === hit?.inst);
      if (!hit || !src || src.ok === (hit.st.status === "up")) return m;
      moved = true;
      return { ...m, links: { ...m.links!, sources: m.links!.sources.map((x) => (x === src ? { ...x, ok: hit.st.status === "up" } : x)) } };
    });
  }
  const merged = moved || Object.keys(sheets).length ? { ...data, machine_list, network, virtualization, sheets } : data;
  return healConnectors(merged, live);
}

interface ConnectorRow { ok?: boolean; stale?: boolean; message?: string; name?: string; type?: string; connector?: string }

/** A connector that failed at the last full collection but that a newer light reading (live.json) read fine is shown as read, with no failure
 *  message: the warnings (home, machines, services…) no longer wait for the next full collection to go away. */
export function healConnectors(data: Data, live: Live): Data {
  const collected = Date.parse(data.generated) / 1000;
  if (!Number.isFinite(collected)) return data;
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    let changed = false;
    const rows = value.map((row: ConnectorRow) => {
      const src = row && (row.ok === false || row.stale === true) ? live.sources[`${row.connector ?? row.type}/${row.name}`] : undefined;
      if (!src?.ok || src.at <= collected) return row;
      changed = true;
      return { ...row, ok: true, stale: false, message: "" };
    });
    if (changed) out = { ...(out ?? data), [key]: rows };
  }
  return (out as unknown as Data) ?? data;
}

const loadLive = (): Promise<Live | null> => get<Live>("live.json", true).catch(() => null);

const loadPulse = (): Promise<Pulse | null> => get<Pulse>("pulse.json", true).catch(() => null);
const loadPorts = (): Promise<Pulse | null> => get<Pulse>("ports.json", true).catch(() => null);

/** Stamp of every produced file (api/v1/manifest): a file is read again only when its stamp moved */
interface Manifest { ts: number; files: Record<string, string> }

const ME_EVERY_MS = 300_000;      // the account (role, e-mail) is read again every 5 min, not at every refresh
const REMOTE_EVERY_MS = 60_000;   // a file the manifest cannot stamp (health or backups served from elsewhere): read again every minute

/** What the last refresh read, piece by piece, so the next one reads only what moved */
interface Kept {
  files: Record<string, string>;          // stamps of the manifest at the last refresh
  readAt: Record<string, number>;         // when each file not in the manifest was last read
  meAt: number;
  me: Me; raw: Data | null; pulse: Pulse | null; ports: Pulse | null; live: Live | null;
  health: Health | null; backups: Backups | null; watch: Events | null; hev: Events | null;
  snap: Snapshot | null;
}
let kept: Kept | null = null;

/** Forgets what was read: the next refresh reads everything again */
export function forgetSnapshot(): void { kept = null; }

const loadManifest = (): Promise<Manifest | null> => get<Manifest>("api/v1/manifest", true).catch(() => null);

/** Tout ce que l'accueil lit ; santé, sauvegardes et événements sont facultatifs. Guided by the manifest: at rest one small request,
 *  and only the files whose stamp moved are read again (each still with its ETag); without manifest, everything as before. */
export async function loadSnapshot(known?: Record<string, string>): Promise<Snapshot> {   // known: the stamps the event stream just sent
  const now = Date.now();
  const stamps = known ?? (await loadManifest())?.files ?? null;
  const k = kept;
  const moved = (rel: string): boolean => {
    if (!k) return true;
    if (stamps && rel in stamps) return stamps[rel] !== k.files[rel];
    if (stamps) return !(rel in k.files) ? now - (k.readAt[rel] ?? 0) > REMOTE_EVERY_MS : true;   // not stamped: at its own pace
    return true;   // no manifest at all: everything, as before
  };
  const readAt: Record<string, number> = { ...k?.readAt };
  const file = async <T>(rel: string, prev: T | null, read: () => Promise<T | null>): Promise<T | null> => {
    if (!moved(rel)) return prev;
    readAt[rel] = now;
    return read();
  };
  const meFresh = !!k && now - k.meAt < ME_EVERY_MS;
  const [me, raw, pulse, ports, live] = await Promise.all([
    meFresh ? k!.me : get<Me>("api/v1/me"),
    file<Data>("data.json", k?.raw ?? null, () => get<Data>("data.json", true)),
    file<Pulse>("pulse.json", k?.pulse ?? null, loadPulse),
    file<Pulse>("ports.json", k?.ports ?? null, loadPorts),
    file<Live>("live.json", k?.live ?? null, loadLive),
  ]);
  if (!raw) { kept = null; throw new NotConfigured(me!); }
  const hu = raw.page.health_url, bu = raw.page.backups_url;
  const [health, backups, watch, hev] = await Promise.all([
    hu ? file<Health>(`${hu}stats.json`, k?.health ?? null, () => get<Health>(`${hu}stats.json`, true)) : null,
    bu ? file<Backups>(bu, k?.backups ?? null, () => get<Backups>(bu, true)) : null,
    file<Events>("events.json", k?.watch ?? null, () => get<Events>("events.json", true)),
    hu ? file<Events>(`${hu}events.json`, k?.hev ?? null, () => get<Events>(`${hu}events.json`, true)) : null,
  ]);
  const same = !!k?.snap && me === k.me && raw === k.raw && pulse === k.pulse && ports === k.ports && live === k.live && health === k.health && backups === k.backups && watch === k.watch && hev === k.hev;
  const snap: Snapshot = same ? k!.snap! : {   // nothing moved: the very same object, so the page does not render again
    me: me!, data: translateConnectorMessages(withPulse(withLive(raw, live), pulse, ports)), health, backups,
    events: [...(watch?.events || []), ...(hev?.events || [])],
    labels: translateLabels({ ...hev?.labels, ...watch?.labels }),
    severity: { ...hev?.severity, ...watch?.severity },
  };
  kept = { files: stamps ?? {}, readAt, meAt: meFresh ? k!.meAt : now, me: me!, raw, pulse, ports, live, health, backups, watch, hev, snap };
  return snap;
}

/** Historique SQLite (un an) : événements d'une période et comptes par jour. */
export async function loadHistory(days: number): Promise<{ events: StoredEvent[]; perDay: { day: string; kind: string; n: number }[] }> {
  const since = Date.now() / 1000 - days * 86400;
  const [ev, pd] = await Promise.all([
    get<{ events: StoredEvent[] }>(`api/v1/events?since=${since}&limit=5000`),
    get<{ days: { day: string; kind: string; n: number }[] }>(`api/v1/events/per-day?days=${days}`),
  ]);
  return { events: ev!.events, perDay: pd!.days };
}

function csrf(): string {
  return document.cookie.split("; ").find((c) => c.startsWith("ms_csrf="))?.slice(8) || "";
}

/** Écriture vers l'API v1 (jeton CSRF en en-tête) ; le message d'erreur du serveur est repris tel quel. */
export async function send<T = { ok: boolean }>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  inflight.clear();   // a read already running may be from before this change
  const r = await fetch(`${ROOT}api/v1/${path}`, {
    method,
    headers: { "X-CSRF-Token": csrf(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && !path.endsWith("password")) throw new LoginRequired();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.error === "string" ? serverText(j.error) : `HTTP ${r.status}`);
  if (!READ_ONLY.test(path)) refreshSnapshot();   // a change: every tab shows it now, and follows the collection it may start
  if (typeof j.message === "string") j.message = serverText(j.message);
  return j as T;
}

/** Writes after which data.json cannot have changed yet: tries, checks, secrets, sign-in, the assistant's own progress, a detection
 *  proposal, and « read this machine again » (the pass it starts ends with a reload by the scan bar): no reload after them */
const READ_ONLY = /(\/test|\/check|\/preview|\/reveal|\/refresh|\/redetect|^login|^logout|password|^assistant)$/;

/** Téléchargement d'un fichier produit par une écriture (export) : renvoie le Blob et son nom. */
export async function download(path: string, body: unknown): Promise<{ blob: Blob; name: string }> {
  const r = await fetch(`${ROOT}api/v1/${path}`, {
    method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(typeof j.error === "string" ? serverText(j.error) : `HTTP ${r.status}`);
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || "export.tar.gz";
  return { blob: await r.blob(), name };
}

/** Reads of the v1 API that are running now, by path: the same read asked again while it runs (two panels of one screen loading the same data) shares
 *  the one network call. A write empties it, so nothing read after a change can be an answer from before it. */
const inflight = new Map<string, Promise<unknown>>();

/** Lecture de l'API v1 (Réglages). */
export function read<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = get<T>(`api/v1/${path}`).then((r) => (path === "connectors/settings" ? translateConnectorTypes(r as { types: ConnectorType[] }) as T : r!)).finally(() => { if (inflight.get(path) === p) inflight.delete(path); });
  inflight.set(path, p);
  return p;
}

/** Asks the page to read data.json again now (after a change the server already published), instead of at the next minute; the page
 *  then reads it every few seconds for a while, so a collection started by the change shows up when it ends */
export const RELOAD_EVENT = "ms-reload";
export function refreshSnapshot(): void {
  dispatchEvent(new Event(RELOAD_EVENT));
}

export async function logout(): Promise<void> {
  await fetch(`${ROOT}api/v1/logout`, { method: "POST", headers: { "X-CSRF-Token": csrf() } }).catch(() => undefined);
  location.href = LOGIN;
}
