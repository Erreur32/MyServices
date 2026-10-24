// « Vidéo et caméras »: what the camera recorders, stream relays and live broadcasts contain (cameras, streams, recordings), from the video
// connectors. No probe and no form of its own: the state is the one of Services, and every card and row leads to the page of its service.
// The picture of a camera is shown only to an admin who asks for it, read at that moment and never kept. Four sub-pages of the side menu:
// #stream/overview, cameras, flows, recordings.
import { Camera, Film, HardDrive, ImageOff, Radio, Video as VideoIcon, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ROOT, type Snapshot } from "../api";
import { useSort } from "../lib/filter";
import { bytes } from "../lib/format";
import { tx } from "../lib/i18n";
import { sinceText } from "../lib/last24h";
import { usePageView } from "../lib/route";
import { STORAGE_FULL, streamAlerts, streamCameras, streamCards, streamFigures, streamFlows, streamStorage, type CameraRow, type StreamCard, type StreamRole } from "../lib/video";
import { Badge, Dim, Empty, GradientFill, Td, Th } from "../components/ui";
import { Dot } from "../components/marks";
import { FoldPanel } from "../components/FoldPanel";
import { FamilyCard, WatchPanel } from "../components/FamilyCards";
import { HeadTags } from "../components/HeadTags";
import { InfoNote } from "../components/InfoNote";
import { StatTile } from "../components/StatTile";

const VIEWS = ["overview", "cameras", "flows", "recordings"] as const;
const ROLE: Record<StreamRole, string> = { nvr: tx("enregistreur"), relay: tx("relais"), live: tx("direct"), other: tx("autre") };
const yesNo = (v?: boolean | null) => (v == null ? "-" : v ? tx("oui") : tx("non"));

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
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><VideoIcon size={18} aria-hidden />{tx("Vidéo et caméras")}</h1>
        <HeadTags counts={[tx("{0} services", cards.length), tx("{0} machines", machines)]} sources={read} others={unread} at={snap.data.generated} />
        {admin && <a href="#settings/connectors" className="ml-auto text-sm text-link hover:underline">{tx("Connecteurs")} ›</a>}
      </div>
      {!cards.length && <Empty>{tx("Aucun service vidéo pour l'instant : un service de catégorie « Stream » dans Services, ou un connecteur vidéo (Frigate, Shinobi, go2rtc, MediaMTX, Owncast), fait apparaître cette page.")}</Empty>}
      {cards.length > 0 && view === "overview" && <Overview cards={cards} cams={cams} admin={admin} />}
      {cards.length > 0 && view === "cameras" && <Cameras cams={cams} cards={cards} admin={admin} />}
      {cards.length > 0 && view === "flows" && <Flows cards={cards} />}
      {cards.length > 0 && view === "recordings" && <Recordings cards={cards} cams={cams} />}
    </div>
  );
}

function Overview({ cards, cams, admin }: Readonly<{ cards: StreamCard[]; cams: CameraRow[]; admin: boolean }>) {
  const f = streamFigures(cards, cams);
  const labels = Object.entries(f.labels).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
  return (
    <>
      <InfoNote>{tx("Ce que contiennent vos outils vidéo : caméras, flux, enregistrements. Leur état (en ligne, en panne) vient de Services, sans sonde en plus. Les adresses des caméras ne sont jamais gardées : seul leur nom reste.")}</InfoNote>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={f.cameras ? `${f.filming}/${f.cameras}` : "-"} label={tx("Caméras qui filment")} tone={f.filming < f.cameras ? "warn" : undefined} sub={f.cameras - f.filming ? tx("{0} muette(s)", f.cameras - f.filming) : f.cameras ? tx("toutes") : tx("aucune lue")} />
        <StatTile n={f.recording} label={tx("Enregistrent")} sub={tx("{0} en détection", f.detecting)} />
        <StatTile n={f.events ?? "-"} label={tx("Événements 24 h")} sub={labels || tx("aucun lu")} />
        <StatTile n={f.fullest ? `${f.fullest.pct} %` : "-"} label={tx("Stockage des enregistrements")} tone={f.fullest && f.fullest.pct >= STORAGE_FULL ? "warn" : undefined} sub={f.fullest ? f.fullest.card.title : tx("non lu")} />
      </div>
      <WatchPanel id="stream-watch" lines={streamAlerts(cards)} admin={admin} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => <ServiceCard key={c.key} c={c} admin={admin} />)}
      </div>
      <Dim>{tx("Tri : ce qui demande un œil d'abord, puis enregistreurs, relais, directs. Bordure en pointillés : service connu de Services dont le contenu n'est pas lu.")}</Dim>
    </>
  );
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
    out.push([tx("Flux"), tx("{0} prêts sur {1}", s.streams.filter((x) => x.ready !== false).length, s.streams.length)]);
    out.push([tx("Lecteurs"), String(s.streams.reduce((t, x) => t + x.readers, 0))]);
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

/** The picture of a camera, asked by an admin: read by the server at that moment, never kept (no-store), closed with the cross */
function Picture({ cam }: Readonly<{ cam: CameraRow }>) {
  const [at, setAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const conn = cam.card.conn;
  if (!conn?.stream?.snapshot) return null;
  if (at == null) {
    return <button type="button" onClick={() => { setFailed(false); setAt(Date.now()); }} className="inline-flex items-center gap-1 text-sm text-link hover:underline"><Camera size={13} aria-hidden />{tx("Voir l'image")}</button>;
  }
  const q = new URLSearchParams({ connector: conn.connector, name: conn.name, camera: cam.name, t: String(at) });
  return (
    <div className="relative mt-2 overflow-hidden rounded-lg border border-line bg-bg2">
      {failed ? <div className="flex items-center gap-2 p-3 text-sm text-muted"><ImageOff size={14} aria-hidden />{tx("Image non lue : l'outil n'a pas répondu.")}</div>
        : <img src={`${ROOT}api/v1/stream/snapshot?${q}`} alt={tx("Image de la caméra {0}", cam.name)} className="block w-full" onError={() => setFailed(true)} />}
      <button type="button" onClick={() => setAt(null)} aria-label={tx("Fermer")} className="absolute right-1.5 top-1.5 rounded-full bg-card/90 p-1 text-muted hover:text-txt"><X size={14} aria-hidden /></button>
    </div>
  );
}

const camTone = (c: CameraRow) => (c.up === false ? "bad" : c.up ? "ok" : "off");

function Cameras({ cams, cards, admin }: Readonly<{ cams: CameraRow[]; cards: StreamCard[]; admin: boolean }>) {
  const [layout, setLayout] = useState<"tiles" | "table">("tiles");
  const [f, setF] = useState("all")   // "all", "silent" or the key of one recorder;
  const shown = cams.filter((c) => f === "all" || (f === "silent" ? c.up === false : c.card.key === f));
  const keyOf = (c: CameraRow, k: string): string | number => (k === "fps" ? c.fps ?? -1 : k === "events" ? c.events ?? -1 : k === "last" ? c.last ?? -1
    : k === "up" ? Number(c.up !== false) : k === "by" ? c.card.title.toLowerCase() : k === "machine" ? (c.card.machine ?? "").toLowerCase() : c.name.toLowerCase());
  const sort = useSort(shown, keyOf, "up");
  const recorders = cards.filter((c) => c.conn?.stream?.cameras?.length);
  const unread = cards.filter((c) => c.unread && c.role === "nvr").map((c) => c.title);
  const now = Date.now();
  const chip = (label: string, on: boolean, act: () => void) => <button key={label} type="button" onClick={act} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-link text-txt ring-2 ring-link/30" : "border-line text-muted hover:text-txt"}`}>{label}</button>;
  const state = (c: CameraRow) => (c.up === false ? tx("muette") : c.up ? tx("filme") : tx("arrêtée"));
  const what = (c: CameraRow) => [c.fps != null && tx("{0} i/s", Math.round(c.fps)), c.detect && tx("détection"), c.record && tx("enregistrement"), c.last && sinceText(c.last * 1000, now)].filter(Boolean).join(" · ");
  if (!cams.length) return <Empty>{tx("Aucune caméra lue : reliez un connecteur Frigate ou Shinobi dans Connecteurs.")}</Empty>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {chip(tx("Vignettes"), layout === "tiles", () => setLayout("tiles"))}{chip(tx("Tableau"), layout === "table", () => setLayout("table"))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {chip(tx("Toutes"), f === "all", () => setF("all"))}{chip(tx("Muettes"), f === "silent", () => setF("silent"))}
        {recorders.length > 1 && recorders.map((r) => chip(r.title, f === r.key, () => setF(r.key)))}
        {unread.length > 0 && <span className="ml-auto text-xs text-dim">{tx("{0} : non lus, absents de la liste", unread.join(", "))}</span>}
      </div>
      <InfoNote>{admin ? tx("« Voir l'image » demande l'image du moment à l'enregistreur : elle n'est jamais gardée, et chaque demande est notée au journal d'audit.") : tx("Seul l'état des caméras est montré ; leur image est réservée aux admins.")}</InfoNote>
      {layout === "tiles" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sort.sorted.map((c) => (
            <article key={c.key} className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-card px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2"><Dot tone={camTone(c)} /><b className="min-w-0 truncate">{c.name}</b><Badge tone="off" outline>{c.card.title}</Badge></div>
              <span className="text-sm text-muted">{state(c)}{what(c) && ` · ${what(c)}`}</span>
              {c.relays.length > 0 && <Dim>{tx("relayée par {0}", c.relays.join(", "))}</Dim>}
              {admin && <Picture cam={c} />}
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full border-collapse text-sm">
            <thead><tr>
              <Th k="name" sort={sort}>{tx("Caméra")}</Th><Th k="up" sort={sort}>{tx("État")}</Th><Th k="by" sort={sort}>{tx("Enregistreur")}</Th><Th k="machine" sort={sort}>{tx("Machine")}</Th>
              <Th k="fps" sort={sort} className="text-right">{tx("Images/s")}</Th><Th k="detect" sort={sort}>{tx("Détection")}</Th><Th k="record" sort={sort}>{tx("Enregistrement")}</Th>
              <Th k="events" sort={sort} className="text-right">{tx("Événements 24 h")}</Th><Th k="last" sort={sort}>{tx("Dernier")}</Th><Th k="relays" sort={sort}>{tx("Relayée par")}</Th>
            </tr></thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:nth-child(even)]:bg-bg/50">
              {sort.sorted.map((c) => (
                <tr key={c.key} className={c.card.serviceHash ? "cursor-pointer hover:bg-bg2" : ""} onClick={() => { if (c.card.serviceHash) location.hash = c.card.serviceHash; }}>
                  <Td className="font-semibold">{c.name}</Td>
                  <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot tone={camTone(c)} />{state(c)}</span></Td>
                  <Td>{c.card.title}</Td><Td>{c.card.machine ?? "-"}</Td>
                  <Td className="text-right tabular-nums">{c.fps == null ? "-" : Math.round(c.fps)}</Td>
                  <Td>{yesNo(c.detect)}</Td><Td>{yesNo(c.record)}</Td>
                  <Td className="text-right tabular-nums">{c.events ?? "-"}</Td>
                  <Td className="whitespace-nowrap">{c.last ? sinceText(c.last * 1000, now) : "-"}</Td>
                  <Td>{c.relays.join(", ") || "-"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Flows({ cards }: Readonly<{ cards: StreamCard[] }>) {
  const rows = useMemo(() => streamFlows(cards), [cards]);
  const sort = useSort(rows, (r, k) => (k === "readers" ? r.readers : k === "ready" ? Number(r.ready !== false) : k === "by" ? r.card.title.toLowerCase() : String((r as unknown as Record<string, unknown>)[k] ?? "").toLowerCase()), "ready");
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
            {sort.sorted.map((r) => (
              <tr key={r.key} className={r.card.serviceHash ? "cursor-pointer hover:bg-bg2" : ""} onClick={() => { if (r.card.serviceHash) location.hash = r.card.serviceHash; }}>
                <Td className="font-mono text-[13px]">{r.live ? <span className="inline-flex items-center gap-1.5"><Radio size={13} aria-hidden />{r.name}</span> : r.name}</Td>
                <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot tone={r.ready === false ? (r.live ? "off" : "bad") : r.ready ? "ok" : "off"} />
                  {r.live ? (r.ready ? tx("à l'antenne") : tx("hors antenne")) : r.ready === false ? tx("source injoignable") : r.ready ? tx("prêt") : "-"}</span></Td>
                <Td>{r.card.title}</Td>
                <Td>{r.camera ? tx("caméra {0}", r.camera) : r.live ? tx("diffusion") : "-"}</Td>
                <Td>{r.codec ?? "-"}</Td>
                <Td className="text-right tabular-nums">{r.readers}</Td>
                <Td>{r.kinds.join(", ") || "-"}</Td>
              </tr>
            ))}
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
