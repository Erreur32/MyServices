// Lecture des fichiers produits par les tâches et de l'API v1 (même origine, cookie de session).
import type { Backups, Data, Event, Events, Health, Me, StoredEvent } from "./types";
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

/** Pouls (pulse.json) : l'état du ping de chaque machine, confirmé, bien plus frais que data.json (collecte toutes les 30 min) */
interface Pulse { ts: number; machines: Record<string, { ping: boolean; ms: number | null; since: number }> }
const PULSE_MAX_AGE_S = 300;

/** data.json avec le ping du pouls par-dessus, si le pouls est récent ; sinon tel quel */
export function withPulse(data: Data, p: Pulse | null): Data {
  if (!p || Date.now() / 1000 - p.ts > PULSE_MAX_AGE_S) return data;
  let moved = false;
  const machine_list = data.machine_list.map((m) => {
    const live = p.machines[m.ip];
    if (!live || live.ping === m.ping) return m;
    moved = true;
    return { ...m, ping: live.ping };
  });
  return moved ? { ...data, machine_list } : data;
}

export const loadPulse = (): Promise<Pulse | null> => get<Pulse>("pulse.json", true).catch(() => null);

/** Tout ce que l'accueil lit, en parallèle ; santé, sauvegardes et événements sont facultatifs. */
export async function loadSnapshot(): Promise<Snapshot> {
  const [me, raw, pulse] = await Promise.all([get<Me>("api/v1/me"), get<Data>("data.json", true), loadPulse()]);
  if (!raw) throw new NotConfigured(me!);
  const data = withPulse(raw, pulse);
  const hu = data!.page.health_url, bu = data!.page.backups_url;
  const [health, backups, watch, hev] = await Promise.all([
    hu ? get<Health>(`${hu}stats.json`, true) : null,
    bu ? get<Backups>(bu, true) : null,
    get<Events>("events.json", true),
    hu ? get<Events>(`${hu}events.json`, true) : null,
  ]);
  return {
    me: me!, data: data!, health, backups,
    events: [...(watch?.events || []), ...(hev?.events || [])],
    labels: { ...(hev?.labels || {}), ...(watch?.labels || {}) },
    severity: { ...(hev?.severity || {}), ...(watch?.severity || {}) },
  };
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
  const r = await fetch(`${ROOT}api/v1/${path}`, {
    method,
    headers: { "X-CSRF-Token": csrf(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && !path.endsWith("password")) throw new LoginRequired();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${r.status}`);
  if (!READ_ONLY.test(path)) refreshSnapshot();   // a change: every tab shows it now, and follows the collection it may start
  return j as T;
}

/** POST routes that change nothing (try, check, show a secret, sign in): no reload after them */
const READ_ONLY = /(\/test|\/check|\/reveal|^login|^logout|password)$/;

/** Téléchargement d'un fichier produit par une écriture (export) : renvoie le Blob et son nom. */
export async function download(path: string, body: unknown): Promise<{ blob: Blob; name: string }> {
  const r = await fetch(`${ROOT}api/v1/${path}`, {
    method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(typeof j.error === "string" ? j.error : `HTTP ${r.status}`);
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || "export.tar.gz";
  return { blob: await r.blob(), name };
}

/** Lecture de l'API v1 (Réglages). */
export async function read<T>(path: string): Promise<T> {
  return (await get<T>(`api/v1/${path}`))!;
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
