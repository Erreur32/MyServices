// « Vidéo et caméras » page: the camera recorders, stream relays and live broadcasts that Services and the video connectors see, put
// together (the « Stream » category). Nothing is probed here: the state is the one of Services, the content the one the connectors read.
import type { Snapshot } from "../api";
import type { StreamCamera, StreamFlow } from "../types";
import { tx } from "./i18n";
import { cardAlerts, serviceCards, sortCards, unreadAlerts, type Family, type ServiceCard, type WatchLine } from "./serviceCards";

export type StreamRole = "nvr" | "relay" | "live" | "other";
export type StreamCard = ServiceCard<StreamRole>;

/** The video connector types, with their role and name when their row has no « stream » block yet (data written before it existed) */
const STREAM_TYPES: Record<string, [StreamRole, string]> = {
  frigate: ["nvr", "Frigate"], shinobi: ["nvr", "Shinobi"], go2rtc: ["relay", "go2rtc"], mediamtx: ["relay", "MediaMTX"], owncast: ["live", "Owncast"],
};
/** The video apps of known_apps.py, whatever category the rules of this install give them */
const ROLE_OF_APP: Record<string, StreamRole> = {
  frigate: "nvr", shinobi: "nvr", zoneminder: "nvr", motioneye: "nvr", "agent-dvr": "nvr", viseron: "nvr", kerberos: "nvr", scrypted: "nvr",
  go2rtc: "relay", mediamtx: "relay", restreamer: "relay", owncast: "live",
};
const ROLE_ORDER: StreamRole[] = ["nvr", "relay", "live", "other"];
export const STORAGE_FULL = 90;
export const SLOW_DETECTOR_MS = 100;

const STREAM: Family<StreamRole> = {
  conn: (c) => {
    const known = STREAM_TYPES[c.connector];
    return c.stream || known ? { role: c.stream?.role ?? known?.[0] ?? "other", title: c.stream?.engine ?? known?.[1] ?? c.label } : null;
  },
  row: (r) => r.category === "Stream" || !!ROLE_OF_APP[r.app?.key ?? ""],
  roleOfApp: (key) => ROLE_OF_APP[key ?? ""] ?? "other",
};

export function streamCards(snap: Snapshot): StreamCard[] {
  return sortCards(serviceCards(snap, STREAM), ROLE_ORDER);
}

export const hasStream = (snap: Snapshot): boolean =>
  (snap.data.services_status ?? []).some((c) => !!STREAM.conn(c)) || (snap.data.hosts ?? []).some(STREAM.row);

/** One camera row, with the recorder that films it and the relays that carry a stream of the same name */
export interface CameraRow extends StreamCamera { key: string; card: StreamCard; relays: string[] }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function streamCameras(cards: StreamCard[]): CameraRow[] {
  const relays = cards.filter((c) => c.role === "relay").flatMap((c) => (c.conn?.stream?.streams ?? []).map((s) => ({ s, by: c.title })));
  return cards.flatMap((c) => (c.conn?.stream?.cameras ?? []).map((cam) => ({
    ...cam, key: `${c.key}/${cam.name}`, card: c, relays: [...new Set(relays.filter((x) => same(x.s.name, cam.name)).map((x) => x.by))],
  }))).sort((x, y) => Number(x.up !== false) - Number(y.up !== false) || x.name.localeCompare(y.name));
}

/** One line of the Flows page: a relayed stream, or a live broadcast */
export interface FlowRow extends StreamFlow { key: string; card: StreamCard; camera?: string; live?: boolean }

export function streamFlows(cards: StreamCard[]): FlowRow[] {
  const cams = cards.flatMap((c) => c.conn?.stream?.cameras ?? []).map((x) => x.name);
  const out: FlowRow[] = cards.flatMap((c) => (c.conn?.stream?.streams ?? []).map((s) => ({ ...s, key: `${c.key}/${s.name}`, card: c, camera: cams.find((n) => same(n, s.name)) })));
  for (const c of cards) {
    const l = c.conn?.stream?.live;
    if (l) out.push({ name: c.title, ready: l.online, readers: l.viewers, kinds: [], key: `${c.key}/live`, card: c, live: true });
  }
  return out.sort((x, y) => Number(x.ready !== false) - Number(y.ready !== false) || x.name.localeCompare(y.name));
}

/** The storage of a recorder, as the connector read it */
export interface StorageRow { key: string; card: StreamCard; used: number; total: number; pct: number }

export function streamStorage(cards: StreamCard[]): StorageRow[] {
  return cards.flatMap((c) => {
    const st = c.conn?.stream?.storage;
    return st?.total ? [{ key: c.key, card: c, used: st.used, total: st.total, pct: Math.round((st.used / st.total) * 100) }] : [];
  });
}

export interface StreamFigures { cameras: number; filming: number; recording: number; detecting: number; events: number | null; labels: Record<string, number>; fullest: StorageRow | null }

export function streamFigures(cards: StreamCard[], cams = streamCameras(cards)): StreamFigures {
  const read = cards.map((c) => c.conn?.stream?.events).filter((n): n is number => n != null);
  const labels: Record<string, number> = {};
  for (const c of cards) for (const [k, n] of Object.entries(c.conn?.stream?.labels ?? {})) labels[k] = (labels[k] ?? 0) + n;
  const storage = streamStorage(cards);
  return {
    cameras: cams.length, filming: cams.filter((c) => c.up !== false).length, recording: cams.filter((c) => c.record).length,
    detecting: cams.filter((c) => c.detect).length, events: read.length ? read.reduce((a, b) => a + b, 0) : null, labels,
    fullest: storage.reduce<StorageRow | null>((a, b) => (a == null || b.pct > a.pct ? b : a), null),
  };
}

/** What needs an eye: a connector in error, a silent camera, a full storage, a slow detector, a relayed stream whose source is gone */
export function streamAlerts(cards: StreamCard[]): WatchLine[] {
  const out = cardAlerts(cards, (c) => (c.role === "relay" ? "#stream/flows" : "#stream/cameras"));
  for (const s of streamStorage(cards))
    if (s.pct >= STORAGE_FULL) out.push({ tone: "warn", title: tx("Enregistrements de {0} à {1} %", s.card.title, s.pct), detail: s.card.machine, hash: "#stream/recordings" });
  for (const c of cards) {
    const ms = c.conn?.stream?.detector_ms;
    if (ms != null && ms > SLOW_DETECTOR_MS) out.push({ tone: "warn", title: tx("Détecteur de {0} lent : {1} ms par image", c.title, Math.round(ms)), detail: c.machine, hash: "#stream/cameras" });
    for (const s of (c.conn?.stream?.streams ?? []).filter((x) => x.ready === false))
      out.push({ tone: "warn", title: tx("Flux « {0} » sans source", s.name), detail: tx("{0} sur {1}", c.title, c.machine ?? c.ip ?? "?"), hash: "#stream/flows" });
  }
  return [...out, ...unreadAlerts(cards, ["nvr", "relay", "live"])];
}
