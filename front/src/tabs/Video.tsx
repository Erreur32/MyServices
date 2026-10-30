// « Vidéo et caméras »: what the camera recorders, stream relays and live broadcasts contain (cameras, streams, recordings), from the video
// connectors. No probe and no form of its own: the state is the one of Services, and every card and row leads to the page of its service.
// The picture of a camera is shown with its tile (read at that moment, never kept); its live feed starts on a click. Five sub-pages of the side menu:
// #stream/overview, cameras, flows, recordings, frigate.
import { BarChart3, Camera, Clock, Cpu, Film, HardDrive, ImageOff, Play, Radio, RefreshCw, ScanEye, Square, Video as VideoIcon, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ROOT, type Snapshot } from "../api";
import { useSort } from "../lib/filter";
import { bytes, hm } from "../lib/format";
import { tx } from "../lib/i18n";
import { sinceText } from "../lib/last24h";
import { usePageView } from "../lib/route";
import { cameraPlace, type CameraPlace, SLOW_DETECTOR_MS, STORAGE_FULL, streamAlerts, streamCameras, streamCards, streamFigures, streamDetectors, streamFlows, streamHourly, streamRecent, streamStorage, type CameraRow, type FlowRow, type StreamCard, type StreamRole } from "../lib/video";
import { Badge, Dim, Empty, GradientFill, Td, Th } from "../components/ui";
import { Dot } from "../components/marks";
import { FoldPanel } from "../components/FoldPanel";
import { FamilyCard, WatchPanel } from "../components/FamilyCards";
import { HeadTags } from "../components/HeadTags";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { appIcon } from "../lib/appIcons";
import { InfoNote } from "../components/InfoNote";
import { StatTile } from "../components/StatTile";
import { FrigateStats } from "./FrigateStats";

const VIEWS = ["overview", "cameras", "flows", "recordings", "frigate"] as const;
const ROLE: Record<StreamRole, string> = { nvr: tx("enregistreur"), relay: tx("relais"), live: tx("direct"), other: tx("autre") };
function yesNo(v?: boolean | null): string {
  if (v == null) return "-";
  return v ? tx("oui") : tx("non");
}

export function Video({ snap, route }: Readonly<{ snap: Snapshot; route: string }>) {
  const view = usePageView(route, "stream", VIEWS, "overview");
  const cards = useMemo(() => streamCards(snap), [snap]);
  const cams = useMemo(() => streamCameras(cards), [cards]);
  const admin = snap.me.role === "admin";
  const read = [...new Set(cards.filter((c) => !c.unread && c.conn?.ok).map((c) => c.conn!.label))];
  const unread = [...new Set(cards.filter((c) => c.unread).map((c) => c.title))];
  const machines = new Set(cards.map((c) => c.machine).filter(Boolean)).size;
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={VideoIcon} logo={view === "frigate" ? appIcon(["frigate"]) : null} title={view === "frigate" ? "Frigate" : tx("Vidéo et caméras")} tags={<HeadTags counts={[tx("{0} services", cards.length), tx("{0} machines", machines)]} sources={read} others={unread} at={snap.data.generated} />} actions={admin && <ConnectorsLink />} />
      {!cards.length && <Empty>{tx("Aucun service vidéo pour l'instant : un service de catégorie « Stream » dans Services, ou un connecteur vidéo (Frigate, Shinobi, go2rtc, MediaMTX, Owncast), fait apparaître cette page.")}</Empty>}
      {cards.length > 0 && view === "overview" && <Overview cards={cards} cams={cams} admin={admin} at={snap.data.generated} />}
      {cards.length > 0 && view === "cameras" && <Cameras cams={cams} cards={cards} />}
      {cards.length > 0 && view === "flows" && <Flows cards={cards} />}
      {cards.length > 0 && view === "recordings" && <Recordings cards={cards} cams={cams} />}
      {cards.length > 0 && view === "frigate" && <FrigateStats statuses={snap.data.services_status ?? []} />}
    </div>
  );
}

function Overview({ cards, cams, admin, at }: Readonly<{ cards: StreamCard[]; cams: CameraRow[]; admin: boolean; at: string }>) {
  const f = streamFigures(cards, cams);
  const hourly = streamHourly(cards), recent = streamRecent(cards), detectors = streamDetectors(cards);
  const labels = Object.entries(f.labels).sort((a, b) => b[1] - a[1]), top = labels[0]?.[1] ?? 1;
  const silent = f.cameras - f.filming;
  const slowest = Math.max(0, ...cards.map((c) => c.conn?.stream?.detector_ms ?? 0));
  const peak = hourly ? hourly.indexOf(Math.max(...hourly)) : -1;
  const stamp = Date.parse(at) || Date.now();
  const hourOf = (i: number) => new Date(stamp - (23 - i) * 3600_000).getHours();   // bin 23 is the hour just gone
  const last = recent[0];
  const now = Date.now();
  const watched = cams.filter((c) => c.detect || (c.events ?? 0) > 0);
  const maxEv = Math.max(1, ...watched.map((c) => c.events ?? 0));
  return (
    <>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={f.cameras ? `${f.filming}/${f.cameras}` : "-"} label={tx("Caméras qui filment")} tone={f.filming < f.cameras ? "warn" : undefined} sub={filmingSub(f.cameras, silent)} />
        <StatTile n={f.detecting} label={tx("En détection")} sub={slowest ? tx("détecteur {0} ms", Math.round(slowest)) : tx("{0} enregistrent", f.recording)} tone={slowest > SLOW_DETECTOR_MS ? "warn" : undefined} />
        <StatTile n={f.events ?? "-"} label={tx("Événements 24 h")} sub={hourly && peak >= 0 && hourly[peak] > 0 ? tx("pic à {0} h : {1}", hourOf(peak), hourly[peak]) : tx("aucun lu")} />
        <StatTile n={last ? sinceText(last.t * 1000, now) : "-"} label={tx("Dernier événement")} sub={last ? `${last.label} · ${last.camera}` : tx("aucun lu")} />
        <StatTile n={f.fullest ? `${f.fullest.pct} %` : "-"} label={tx("Stockage des enregistrements")} tone={f.fullest && f.fullest.pct >= STORAGE_FULL ? "warn" : undefined} sub={f.fullest ? f.fullest.card.title : tx("non lu")} />
      </div>
      <WatchPanel id="stream-watch" lines={streamAlerts(cards)} admin={admin} />
      {(hourly || labels.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-3">
          {hourly && <Panel icon={BarChart3} title={tx("Événements des 24 dernières heures")} aside={tx("par heure")} className="lg:col-span-2">
            <div className="grid h-28 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-[3px] border-b border-line" role="img" aria-label={tx("Histogramme des événements par heure")}>
              {hourly.map((n, i) => <i key={i} title={tx("{0} h : {1} événement(s)", hourOf(i), n)} className={`block min-h-[2px] rounded-t-sm ${i === peak && n > 0 ? "bg-warn" : n === 0 ? "bg-line" : "bg-link"}`} style={{ height: `${Math.max(2, (100 * n) / Math.max(1, hourly[peak]))}%` }} />)}
            </div>
            <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] text-center text-[10px] tabular-nums text-dim" aria-hidden>
              {hourly.map((_, i) => <span key={i} className={i % 4 === 0 ? "" : "invisible"}>{hourOf(i)}</span>)}
            </div>
          </Panel>}
          {labels.length > 0 && <Panel icon={ScanEye} title={tx("Objets détectés")} aside="24 h">
            <ul className="flex flex-col gap-2">
              {labels.slice(0, 6).map(([k, n]) => (
                <li key={k} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-sm">
                  <span className="truncate">{k}</span><span className="h-2 overflow-hidden rounded-full bg-bg2"><GradientFill pct={(100 * n) / top} /></span><span className="text-right font-mono text-xs tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </Panel>}
        </div>
      )}
      {watched.length > 0 && <Panel icon={Camera} title={tx("Détection par caméra")} aside={<a href="#stream/cameras" className="text-link hover:underline">{tx("Toutes les caméras")} ›</a>}>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
          <thead><tr><Th>{tx("Caméra")}</Th><Th>{tx("Détection")}</Th><Th className="text-right">{tx("Images/s")}</Th><Th>{tx("Événements 24 h")}</Th><Th>{tx("Objets")}</Th><Th>{tx("Dernier")}</Th></tr></thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">
            {[...watched].sort((a, b) => (b.events ?? 0) - (a.events ?? 0)).map((c) => (
              <tr key={c.key}>
                <Td className="font-semibold"><span className="inline-flex items-center gap-1.5"><Dot tone={camTone(c)} />{c.name}</span></Td>
                <Td className={c.up === false ? "text-bad" : c.detect ? "text-ok" : "text-muted"}>{c.up === false ? tx("muette") : c.detect ? tx("active") : tx("coupée")}</Td>
                <Td className="text-right tabular-nums">{c.fps != null ? Math.round(c.fps * 10) / 10 : "-"}</Td>
                <Td><span className="inline-flex items-center gap-2"><span className="h-1.5 w-[70px] overflow-hidden rounded-full bg-bg2"><GradientFill pct={(100 * (c.events ?? 0)) / maxEv} /></span><span className="tabular-nums">{c.events ?? "-"}</span></span></Td>
                <Td>{Object.entries(c.labels ?? {}).map(([k, n]) => <Badge key={k} tone="off" outline>{k} {n}</Badge>)}{!Object.keys(c.labels ?? {}).length && <Dim>{tx("aucun")}</Dim>}</Td>
                <Td className="whitespace-nowrap">{c.last ? sinceText(c.last * 1000, now) : "-"}</Td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>}
      {(recent.length > 0 || detectors.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {recent.length > 0 && <Panel icon={Clock} title={tx("Derniers événements")} aside={tx("les {0} plus récents", recent.length)}>
            <ul className="flex flex-col gap-1.5 text-sm">
              {recent.map((e, i) => <li key={i} className="grid grid-cols-[3.2rem_minmax(0,1fr)] gap-2"><time className="font-mono text-xs text-dim">{hm(e.t * 1000)}</time><span className="truncate">{e.label} · <b>{e.camera}</b></span></li>)}
            </ul>
            <Dim>{tx("Les images ne sont pas gardées : seuls l'objet, la caméra et l'heure sont montrés.")}</Dim>
          </Panel>}
          {detectors.length > 0 && <Panel icon={Cpu} title={tx("Détecteurs")} aside={cards.some((c) => c.conn?.frigate) ? <a href="#stream/frigate" className="text-link hover:underline">{tx("Page Frigate")} ›</a> : undefined}>
            <div className="flex flex-wrap gap-2.5">
              {detectors.map((d) => (
                <div key={`${d.by}/${d.name}`} className="min-w-[8.5rem] flex-1 rounded-xl border border-line px-3 py-2">
                  <div className="text-xs text-dim">{d.name}</div>
                  <b className={`font-mono text-base ${(d.ms ?? 0) > SLOW_DETECTOR_MS ? "text-warn" : ""}`}>{d.ms == null ? "-" : `${d.ms.toFixed(0)} ms`}</b>
                  {d.cpu != null && <div className="text-xs text-dim">{tx("processeur {0} %", d.cpu.toFixed(1))}</div>}
                </div>
              ))}
            </div>
            <Dim>{tx("Alerte au-dessus de {0} ms de temps d'inférence.", SLOW_DETECTOR_MS)}</Dim>
          </Panel>}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => <ServiceCard key={c.key} c={c} admin={admin} />)}
      </div>
      <Dim>{tx("Tri : ce qui demande un œil d'abord, puis enregistreurs, relais, directs. Bordure en pointillés : service connu de Services dont le contenu n'est pas lu.")}</Dim>
    </>
  );
}

/** A block of the overview in the same frame as the Services page (dark header strip with icon and title, a note or link on its right) */
function Panel({ icon, title, aside, className = "", children }: Readonly<{ icon: LucideIcon; title: string; aside?: ReactNode; className?: string; children: ReactNode }>) {
  return (
    <div className={`min-w-0 ${className}`}>
      <FoldPanel id="stream-overview" icon={icon} title={title} pinned extra={aside && <span className="ml-auto text-xs font-normal text-dim">{aside}</span>}>
        <div className="flex flex-col gap-2.5">{children}</div>
      </FoldPanel>
    </div>
  );
}

/** The line under the filming tile: how many are silent, else all or none read */
function filmingSub(cameras: number, silent: number): string {
  if (silent) return tx("{0} muette(s)", silent);
  return cameras ? tx("toutes") : tx("aucune lue");
}

/** The figures of a card, by role: only what was read */
function cardFacts(c: StreamCard): [string, string][] {
  const s = c.conn?.stream, out: [string, string][] = [];
  if (c.machine || c.ip) out.push([tx("Machine"), [c.machine, c.ip].filter(Boolean).join(" · ")]);
  if (c.version) out.push([tx("Version"), c.version]);
  if (c.unread || !s) return [...out, [tx("Contenu"), tx("non lu")]];
  if (s.cameras) {
    const up = s.cameras.filter((x) => x.up !== false).length, silent = s.cameras.filter((x) => x.up === false).map((x) => x.name);
    out.push([tx("Caméras"), tx("{0} actives sur {1}", up, s.cameras.length)]);
    if (silent.length) out.push([tx("Muettes"), silent.join(", ")]);
  }
  if (s.detector_ms != null) out.push([tx("Détecteur"), tx("{0} ms par image", Math.round(s.detector_ms))]);
  if (s.events != null) out.push([tx("Événements 24 h"), String(s.events)]);
  if (s.storage?.total) out.push([tx("Stockage"), tx("{0} sur {1}", bytes(s.storage.used), bytes(s.storage.total))]);
  if (s.streams) {
    out.push(
      [tx("Flux"), tx("{0} prêts sur {1}", s.streams.filter((x) => x.ready !== false).length, s.streams.length)],
      [tx("Lecteurs"), String(s.streams.reduce((t, x) => t + x.readers, 0))],
    );
  }
  if (s.live) out.push([tx("Direct"), s.live.online ? tx("à l'antenne, {0} spectateur(s)", s.live.viewers) : tx("hors antenne")]);
  return out.slice(0, 5);
}

function ServiceCard({ c, admin }: Readonly<{ c: StreamCard; admin: boolean }>) {
  const s = c.conn?.stream;
  return (
    <FamilyCard c={c} role={ROLE[c.role]} facts={cardFacts(c)} icon={VideoIcon} admin={admin} links={<>
      {!c.unread && !!s?.cameras?.length && <a href="#stream/cameras" className="text-link hover:underline">{tx("Ses caméras")} ›</a>}
      {!c.unread && (!!s?.streams?.length || !!s?.live) && <a href="#stream/flows" className="text-link hover:underline">{tx("Ses flux")} ›</a>}
    </>} />
  );
}

const LIVE_MAX_S = 300;   // the server stops a live feed after this long (routes/services.py)

/** The picture of a camera, shown with its tile (read by the server at that moment, never kept: no-store), refreshed by the button only.
 *  The live feed starts on a click on the play button, stops with the cross, and by itself after LIVE_MAX_S. */
function Picture({ cam }: Readonly<{ cam: CameraRow }>) {
  const [at, setAt] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setLive(false), LIVE_MAX_S * 1000);
    return () => clearTimeout(t);   // closing the picture closes the connection to the server
  }, [live]);
  const conn = cam.card.conn;
  if (!conn?.stream?.snapshot || cam.up === false) return null;
  const q = new URLSearchParams({ connector: conn.connector, name: conn.name, camera: cam.name, t: String(at) });
  const btn = "rounded-full bg-card/90 p-1.5 text-muted hover:text-txt";
  return (
    <div className="relative mt-2 overflow-hidden rounded-lg border border-line bg-bg2">
      {failed ? <div className="flex items-center gap-2 p-3 text-sm text-muted"><ImageOff size={14} aria-hidden />{live ? tx("Flux non lu : l'outil n'a pas répondu.") : tx("Image non lue : l'outil n'a pas répondu.")}</div>
        : <img src={`${ROOT}api/v1/stream/${live ? "live" : "snapshot"}?${q}`} alt={live ? tx("Flux de la caméra {0}", cam.name) : tx("Image de la caméra {0}", cam.name)} loading="lazy" className="block w-full" onError={() => setFailed(true)} />}
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        {live
          ? <button type="button" onClick={() => { setLive(false); setFailed(false); setAt(Date.now()); }} aria-label={tx("Arrêter le flux")} title={tx("Arrêter le flux")} className={btn}><Square size={14} aria-hidden /></button>
          : <>
            <button type="button" onClick={() => { setFailed(false); setAt(Date.now()); }} aria-label={tx("Actualiser l'image")} title={tx("Actualiser l'image")} className={btn}><RefreshCw size={14} aria-hidden /></button>
            <button type="button" onClick={() => { setFailed(false); setLive(true); }} aria-label={tx("Lire le flux")} title={tx("Lire le flux en direct (5 minutes au plus)")} className={btn}><Play size={14} aria-hidden /></button>
          </>}
      </div>
    </div>
  );
}

function camTone(c: CameraRow): "bad" | "ok" | "off" {
  if (c.up === false) return "bad";
  return c.up ? "ok" : "off";
}

function camState(c: CameraRow): string {
  if (c.up === false) return tx("muette");
  return c.up ? tx("filme") : tx("arrêtée");
}

/** What a camera does, in one line: frame rate, detection, recording, last event */
function camWhat(c: CameraRow, now: number): string {
  return [c.fps != null && tx("{0} i/s", Math.round(c.fps)), c.detect && tx("détection"), c.record && tx("enregistrement"), c.last && sinceText(c.last * 1000, now)].filter(Boolean).join(" · ");
}

/** The sort key of a camera for a column of the table */
function camKey(c: CameraRow, k: string): string | number {
  switch (k) {
    case "fps": return c.fps ?? -1;
    case "events": return c.events ?? -1;
    case "last": return c.last ?? -1;
    case "up": return Number(c.up !== false);
    case "by": return c.card.title.toLowerCase();
    case "machine": return (c.card.machine ?? "").toLowerCase();
    case "place": return cameraPlace(c);
    default: return c.name.toLowerCase();
  }
}

/** Is a camera shown by the filter: "all", "silent" or the key of one recorder */
function camShown(c: CameraRow, f: string): boolean {
  if (f === "all") return true;
  if (f === "silent") return c.up === false;
  return c.card.key === f;
}

const PLACES = { int: tx("Intérieur"), ext: tx("Extérieur"), other: tx("Autre") };

function Chip({ label, on, act }: Readonly<{ label: string; on: boolean; act: () => void }>) {
  return <button type="button" onClick={act} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-link text-txt ring-2 ring-link/30" : "border-line text-muted hover:text-txt"}`}>{label}</button>;
}

function CameraTile({ c, now }: Readonly<{ c: CameraRow; now: number }>) {
  const what = camWhat(c, now);
  const logo = appIcon([c.card.title]);
  return (
    <article className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2"><Dot tone={camTone(c)} /><b className="min-w-0 flex-1 truncate">{c.name}</b>{logo ? <img src={logo} alt={c.card.title} title={c.card.title} className="h-5 w-5 shrink-0" /> : <Badge tone="off" outline>{c.card.title}</Badge>}</div>
      <span className="text-sm text-muted">{PLACES[cameraPlace(c)]} · {camState(c)}{what && ` · ${what}`}</span>
      {c.relays.length > 0 && <Dim>{tx("relayée par {0}", c.relays.join(", "))}</Dim>}
      <Picture cam={c} />
    </article>
  );
}

function CameraLine({ c, now }: Readonly<{ c: CameraRow; now: number }>) {
  return (
    <tr className={c.card.serviceHash ? "cursor-pointer hover:bg-bg2" : ""} onClick={() => { if (c.card.serviceHash) location.hash = c.card.serviceHash; }}>
      <Td className="font-semibold">{c.name}</Td>
      <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot tone={camTone(c)} />{camState(c)}</span></Td>
      <Td>{PLACES[cameraPlace(c)]}</Td><Td>{c.card.title}</Td><Td>{c.card.machine ?? "-"}</Td>
      <Td className="text-right tabular-nums">{c.fps == null ? "-" : Math.round(c.fps)}</Td>
      <Td>{yesNo(c.detect)}</Td><Td>{yesNo(c.record)}</Td>
      <Td className="text-right tabular-nums">{c.events ?? "-"}</Td>
      <Td className="whitespace-nowrap">{c.last ? sinceText(c.last * 1000, now) : "-"}</Td>
      <Td>{c.relays.join(", ") || "-"}</Td>
    </tr>
  );
}

function CameraTable({ sort, now }: Readonly<{ sort: ReturnType<typeof useSort<CameraRow>>; now: number }>) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full border-collapse text-sm">
        <thead><tr>
          <Th k="name" sort={sort}>{tx("Caméra")}</Th><Th k="up" sort={sort}>{tx("État")}</Th><Th k="place" sort={sort}>{tx("Emplacement")}</Th><Th k="by" sort={sort}>{tx("Marque ou enregistreur")}</Th><Th k="machine" sort={sort}>{tx("Machine")}</Th>
          <Th k="fps" sort={sort} className="text-right">{tx("Images/s")}</Th><Th k="detect" sort={sort}>{tx("Détection")}</Th><Th k="record" sort={sort}>{tx("Enregistrement")}</Th>
          <Th k="events" sort={sort} className="text-right">{tx("Événements 24 h")}</Th><Th k="last" sort={sort}>{tx("Dernier")}</Th><Th k="relays" sort={sort}>{tx("Relayée par")}</Th>
        </tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">
          {sort.sorted.map((c) => <CameraLine key={c.key} c={c} now={now} />)}
        </tbody>
      </table>
    </div>
  );
}

function Cameras({ cams, cards }: Readonly<{ cams: CameraRow[]; cards: StreamCard[] }>) {
  const [layout, setLayout] = useState<"tiles" | "table">("tiles");
  const [f, setF] = useState("all")   // "all", "silent" or the key of one recorder;
  const [place, setPlace] = useState<CameraPlace | "all">("all");
  const inFilter = cams.filter((c) => camShown(c, f));
  const shown = inFilter.filter((c) => place === "all" || cameraPlace(c) === place);
  const sort = useSort(shown, camKey, "up");
  const recorders = cards.filter((c) => c.conn?.stream?.cameras?.length);
  const unread = cards.filter((c) => c.unread && c.role === "nvr").map((c) => c.title);
  const now = Date.now();
  if (!cams.length) return <Empty>{tx("Aucune caméra lue : reliez un connecteur Frigate ou Shinobi dans Connecteurs.")}</Empty>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={tx("Vignettes")} on={layout === "tiles"} act={() => setLayout("tiles")} /><Chip label={tx("Tableau")} on={layout === "table"} act={() => setLayout("table")} />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Chip label={tx("Toutes")} on={f === "all"} act={() => setF("all")} /><Chip label={tx("Muettes")} on={f === "silent"} act={() => setF("silent")} />
        {recorders.length > 1 && recorders.map((r) => <Chip key={r.title} label={r.title} on={f === r.key} act={() => setF(r.key)} />)}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Chip label={tx("Tous les lieux")} on={place === "all"} act={() => setPlace("all")} />
        {(["int", "ext", "other"] as const).map((p) => {
          const n = inFilter.filter((c) => cameraPlace(c) === p).length;
          return n > 0 && <Chip key={p} label={`${PLACES[p]} ${n}`} on={place === p} act={() => setPlace(place === p ? "all" : p)} />;
        })}
        {unread.length > 0 && <span className="ml-auto text-xs text-dim">{tx("{0} : non lus, absents de la liste", unread.join(", "))}</span>}
      </div>
      <InfoNote>{tx("L'image est celle du moment, lue à l'enregistreur : elle n'est jamais gardée. Le bouton lecture ouvre le flux en direct pour 5 minutes au plus ; son ouverture est notée au journal d'audit.")}</InfoNote>
      {layout === "tiles" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sort.sorted.map((c) => <CameraTile key={c.key} c={c} now={now} />)}
        </div>
      ) : <CameraTable sort={sort} now={now} />}
    </>
  );
}

/** The sort key of a stream for a column of the table */
function flowKey(r: FlowRow, k: string): string | number {
  switch (k) {
    case "readers": return r.readers;
    case "ready": return Number(r.ready !== false);
    case "by": return r.card.title.toLowerCase();
    case "name": return r.name.toLowerCase();
    case "codec": return (r.codec ?? "").toLowerCase();
    case "camera": return (r.camera ?? "").toLowerCase();
    case "kinds": return r.kinds.join(",").toLowerCase();
    default: return "";
  }
}

function flowTone(r: FlowRow): "bad" | "ok" | "off" {
  if (r.ready === false) return r.live ? "off" : "bad";
  return r.ready ? "ok" : "off";
}

function flowState(r: FlowRow): string {
  if (r.live) return r.ready ? tx("à l'antenne") : tx("hors antenne");
  if (r.ready === false) return tx("source injoignable");
  return r.ready ? tx("prêt") : "-";
}

function flowSource(r: FlowRow): string {
  if (r.camera) return tx("caméra {0}", r.camera);
  return r.live ? tx("diffusion") : "-";
}

function FlowLine({ r }: Readonly<{ r: FlowRow }>) {
  return (
    <tr className={r.card.serviceHash ? "cursor-pointer hover:bg-bg2" : ""} onClick={() => { if (r.card.serviceHash) location.hash = r.card.serviceHash; }}>
      <Td className="font-mono text-[13px]">{r.live ? <span className="inline-flex items-center gap-1.5"><Radio size={13} aria-hidden />{r.name}</span> : r.name}</Td>
      <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot tone={flowTone(r)} />
        {flowState(r)}</span></Td>
      <Td>{r.card.title}</Td>
      <Td>{flowSource(r)}</Td>
      <Td>{r.codec ?? "-"}</Td>
      <Td className="text-right tabular-nums">{r.readers}</Td>
      <Td>{r.kinds.join(", ") || "-"}</Td>
    </tr>
  );
}

function Flows({ cards }: Readonly<{ cards: StreamCard[] }>) {
  const rows = useMemo(() => streamFlows(cards), [cards]);
  const sort = useSort(rows, flowKey, "ready");
  const unread = cards.filter((c) => c.unread && (c.role === "relay" || c.role === "live")).map((c) => c.title);
  const readers = rows.reduce((t, r) => t + r.readers, 0);
  if (!rows.length) return <Empty>{tx("Aucun flux lu : reliez un connecteur go2rtc, MediaMTX ou Owncast dans Connecteurs.")}</Empty>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{tx("{0} flux · {1} lecteurs", rows.length, readers)}</span>
        {unread.length > 0 && <span className="ml-auto text-xs text-dim">{tx("{0} : non lus, absents du tableau", unread.join(", "))}</span>}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full border-collapse text-sm">
          <thead><tr>
            <Th k="name" sort={sort}>{tx("Flux")}</Th><Th k="ready" sort={sort}>{tx("État")}</Th><Th k="by" sort={sort}>{tx("Relais")}</Th><Th k="camera" sort={sort}>{tx("Source")}</Th>
            <Th k="codec" sort={sort}>{tx("Format")}</Th><Th k="readers" sort={sort} className="text-right">{tx("Lecteurs")}</Th><Th k="kinds" sort={sort}>{tx("Lus en")}</Th>
          </tr></thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">
            {sort.sorted.map((r) => <FlowLine key={r.key} r={r} />)}
          </tbody>
        </table>
      </div>
      <InfoNote>{tx("Les adresses des sources (souvent avec identifiant et mot de passe dans l'adresse rtsp) ne sont jamais gardées ni affichées : seul le nom du flux reste. La source est la caméra du même nom chez un enregistreur.")}</InfoNote>
    </>
  );
}

function Recordings({ cards, cams }: Readonly<{ cards: StreamCard[]; cams: CameraRow[] }>) {
  const storage = streamStorage(cards);
  const recorders = cards.filter((c) => c.role === "nvr" && !c.unread);
  if (!recorders.length) return <Empty>{tx("Aucun enregistreur lu : reliez un connecteur Frigate ou Shinobi dans Connecteurs.")}</Empty>;
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {recorders.map((c) => {
          const st = storage.find((s) => s.key === c.key), s = c.conn?.stream, mine = cams.filter((x) => x.card.key === c.key);
          return (
            <FoldPanel key={c.key} id={`stream-rec-${c.key}`} icon={HardDrive} title={c.title} tone={st && st.pct >= STORAGE_FULL ? "warn" : "off"}
              extra={<><Dot tone={c.tone} /><Dim>{[c.machine, c.version].filter(Boolean).join(" · ")}</Dim></>}>
              <div className="flex flex-col gap-2 text-sm">
                {st ? (
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)_10rem] items-center gap-3">
                    <span className="text-muted">{tx("Utilisé")}</span>
                    <span className="block h-2.5 overflow-hidden rounded-full border border-line bg-bg2"><GradientFill pct={st.pct} /></span>
                    <span className="text-right tabular-nums">{tx("{0} sur {1} ({2} %)", bytes(st.used), bytes(st.total), st.pct)}</span>
                  </div>
                ) : <Dim>{tx("Place prise non lue : cet outil ne la donne pas par son API.")}</Dim>}
                <span className="text-muted">{tx("{0} caméra(s) qui enregistrent sur {1}", mine.filter((x) => x.record).length, mine.length)}{s?.events != null && ` · ${tx("{0} événements en 24 h", s.events)}`}</span>
                {mine.some((x) => x.events != null) && (
                  <ul className="flex flex-col border-t border-line/60 pt-2 [&>li:nth-child(even)]:bg-bg/50">
                    {mine.filter((x) => x.events != null).sort((a, b) => (b.events ?? 0) - (a.events ?? 0)).map((x) => (
                      <li key={x.key} className="grid grid-cols-[minmax(0,1fr)_5rem] gap-4 rounded px-2 py-1"><span className="truncate">{x.name}</span><span className="text-right tabular-nums">{x.events}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </FoldPanel>
          );
        })}
      </div>
      <InfoNote><Film size={13} className="mr-1 inline" aria-hidden />{tx("Seules les 24 dernières heures sont lues : le rythme de remplissage et la date où le disque sera plein demandent un historique que MyServices ne garde pas encore.")}</InfoNote>
    </>
  );
}
