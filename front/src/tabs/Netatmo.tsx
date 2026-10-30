// « Domotique › Netatmo »: the state of the house, the 24 hours of every sensor in view, what to deal with, then the shutters, the heating and the cameras.
import { House, ImageOff, RefreshCw, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { read, ROOT, type Snapshot } from "../api";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { StatTile } from "../components/StatTile";
import { batteryTone, co2Pin, house, linePath, measures, moduleState, scaleOf, shutterState, type HouseTone, type Point } from "../lib/domotique";
import { appIcon } from "../lib/appIcons";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import type { HouseCurves, NetatmoModule } from "../types";

const TEXT: Record<HouseTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };
const DOT: Record<HouseTone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };
const BAT: Record<"low" | "mid" | "hi", string> = { low: "bg-bad", mid: "bg-warn", hi: "bg-ok" };
// Netatmo's orange, from its logo
const ORANGE = "#ff8d15";
const PANEL = "overflow-hidden rounded-2xl border border-[#ff8d15]/30 bg-card/70 shadow-sm";
const HEAD = "flex items-baseline justify-between gap-3 border-b border-[#ff8d15]/30 bg-[#ff8d15]/10 px-4 py-2.5";
const TRACK = "relative h-2 rounded-full bg-muted/20";
const PINNED = "absolute -top-[3px] h-3.5 w-1 -translate-x-1/2 rounded-sm bg-txt shadow-[0_0_0_2px_rgb(var(--card))]";
const COLORS = [ORANGE, "#4aa8ff", "#c792ea", "#4cd07f", "#e8a33d", "#f06a6a", "#4acbd6", "#a3e635"];
const CO2_ZONES = "linear-gradient(90deg, rgb(var(--ok)) 0 36.4%, rgb(var(--warn)) 36.4% 54.5%, rgb(var(--bad)) 54.5% 100%)";

type Curves = Record<string, HouseCurves>;

/** The 24 hours of every sensor, read once when the page opens (the connector keeps them 10 minutes): none for a device Netatmo itself does not serve */
function useCurves(sensors: NetatmoModule[]): Curves {
  const [all, setAll] = useState<Curves>({});
  const wanted = sensors.filter((m) => m.id && m.source?.connector === "netatmo"), key = wanted.map((m) => m.id).join(",");
  useEffect(() => {
    let live = true;
    for (const m of wanted) {
      const q = new URLSearchParams({ connector: m.source?.connector ?? "", name: m.source?.name ?? "", module: m.id ?? "" });
      read<{ series: HouseCurves }>(`domotique/curves?${q}`).then((r) => live && setAll((x) => ({ ...x, [m.id ?? ""]: r.series })), () => undefined);
    }
    return () => { live = false; };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps -- the ids tell when the devices change
  return all;
}

const foot = (m: NetatmoModule): string => !m.reachable && m.last_seen ? tx("Dernier signal : {0}", dateTime(m.last_seen * 1000)) : m.battery != null ? tx("Pile {0} %", Math.round(m.battery)) : "";
const first = (m: NetatmoModule) => (typeof m.values.temperature === "number" ? "temperature" : "");

/** The line of a sensor, filled below, in a 200 × 44 box: the temperature, else the first measure it has */
function Spark({ m, series, color }: Readonly<{ m: NetatmoModule; series?: HouseCurves; color: string }>) {
  const key = first(m) || Object.keys(series ?? {}).find((k) => (series?.[k]?.length ?? 0) > 1) || "";
  const pts = series?.[key] ?? [], sc = scaleOf([pts]);
  if (!sc) return <div className="flex-1" />;
  const d = linePath(pts, sc, 200, 44, 4);
  return (
    <svg viewBox="0 0 200 44" preserveAspectRatio="none" className="h-11 min-w-0 flex-1" role="img" aria-label={tx("{0} sur 24 h : de {1} à {2}", m.name, Math.round(sc.lo * 10) / 10, Math.round(sc.hi * 10) / 10)}>
      <path d={`${d} L200 44 L0 44 Z`} fill={color} opacity={0.16} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Meter({ label, value, children }: Readonly<{ label: string; value: string; children: React.ReactNode }>) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11.5px] text-muted"><span>{label}</span><b className="font-mono text-xs font-semibold text-txt">{value}</b></div>
      {children}
    </div>
  );
}

function Room({ m, series, color }: Readonly<{ m: NetatmoModule; series?: HouseCurves; color: string }>) {
  const state = moduleState(m), v = m.values, temp = typeof v.temperature === "number" ? v.temperature : null;
  const rest = measures(m).filter((x) => !["temperature", "humidity", "co2"].includes(x.key)), under = [m.room, foot(m)].filter(Boolean).join(" · ");
  return (
    <article className={`flex min-w-0 flex-col gap-2 rounded-2xl border bg-card px-3.5 py-3 shadow-sm ${state.tone === "warn" ? "border-warn" : "border-[#ff8d15]/30"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="truncate text-[14.5px] font-bold">{m.name}</h3>{under && <p className="truncate text-[11.5px] text-muted">{under}</p>}</div>
        <span className={`flex items-center gap-1.5 whitespace-nowrap text-xs font-bold ${TEXT[state.tone]}`}><span className={`size-2 rounded-full ${DOT[state.tone]}`} />{state.label}</span>
      </div>
      {temp !== null && (
        <div className="flex items-end justify-between gap-2.5">
          <div className="font-mono text-[34px] font-extrabold leading-none tabular-nums">{temp.toLocaleString(undefined, { maximumFractionDigits: 1 })}<small className="text-base font-semibold text-muted">°</small></div>
          <Spark m={m} series={series} color={color} />
        </div>
      )}
      {temp === null && series && <div className="flex"><Spark m={m} series={series} color={color} /></div>}
      <div className="grid gap-2">
        {typeof v.humidity === "number" && (
          <Meter label={tx("Humidité")} value={`${Math.round(v.humidity)} %`}>
            <div className={TRACK}><span className="absolute inset-y-0 left-[40%] w-1/5 rounded-full bg-ok/35" /><span className={PINNED} style={{ left: `${Math.min(100, v.humidity)}%` }} /></div>
          </Meter>
        )}
        {typeof v.co2 === "number" && (
          <Meter label="CO2" value={`${Math.round(v.co2)} ppm`}>
            <div className={TRACK} style={{ background: CO2_ZONES }}><span className={PINNED} style={{ left: `${co2Pin(v.co2)}%` }} /></div>
          </Meter>
        )}
        {m.battery != null && (
          <div className="flex items-center gap-2 text-[11.5px] text-muted"><span>{tx("Pile")}</span>
            <div className={`${TRACK} flex-1`}><span className={`absolute inset-y-0 left-0 rounded-full ${BAT[batteryTone(m.battery)]}`} style={{ width: `${Math.min(100, m.battery)}%` }} /></div>
            <b className="font-mono font-semibold text-txt">{Math.round(m.battery)} %</b></div>
        )}
      </div>
      {rest.length > 0 && (
        <dl className="grid gap-0.5 border-t border-dashed border-line pt-1.5 text-xs text-muted">
          {rest.map((x) => <div key={x.key} className="flex justify-between gap-2"><dt>{x.label}</dt><dd className="font-semibold text-txt">{x.value}</dd></div>)}
        </dl>
      )}
    </article>
  );
}

const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The curves worth a chart of their own: each on its own scale, in a column of the page grid */
const METRICS = [
  { key: "temperature", unit: "°", round: 2, title: () => tx("Températures sur 24 h"), note: () => tx("toutes les pièces, même échelle") },
  { key: "humidity", unit: " %", round: 10, title: () => tx("Humidité sur 24 h"), note: () => tx("confort entre 40 et 60 %") },
  { key: "co2", unit: " ppm", round: 200, title: () => tx("CO2 sur 24 h"), note: () => tx("à aérer au-dessus de 1 000") },
];

/** One measure of every sensor that has it on one scale: a coloured line each, a legend that switches a line on or off */
function Chart({ metric, sensors, curves, colors }: Readonly<{ metric: (typeof METRICS)[number]; sensors: NetatmoModule[]; curves: Curves; colors: Map<string, string> }>) {
  const lines = sensors.map((m) => ({ m, pts: (curves[m.id ?? ""]?.[metric.key] ?? []) as Point[] })).filter((l) => l.pts.length > 1);
  const [off, setOff] = useState<Set<string>>(new Set());
  const shown = lines.filter((l) => !off.has(l.m.id ?? ""));
  const sc = useMemo(() => scaleOf(shown.map((l) => l.pts), metric.round), [shown.map((l) => l.m.id).join(","), curves]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!lines.length) return null;
  const W = 560, H = 230, L = 42, R = 10, T = 10, B = 24, w = W - L - R, h = H - T - B;
  const step = sc ? metric.round * Math.max(1, Math.ceil((sc.hi - sc.lo) / metric.round / 5)) : 1;
  const ticks = sc ? Array.from({ length: Math.floor((sc.hi - sc.lo) / step) + 1 }, (_, i) => sc.lo + i * step) : [];
  const toggle = (id: string) => setOff((x) => { const n = new Set(x); if (!n.delete(id)) n.add(id); return n; });
  return (
    <section className={PANEL} aria-label={metric.title()}>
      <div className={HEAD}><h2 className="text-sm font-bold">{metric.title()}</h2><span className="text-xs text-muted">{metric.note()}</span></div>
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {lines.map(({ m }) => {
          const id = m.id ?? "", on = !off.has(id);
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => toggle(id)} className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-bg2 px-2 py-0.5 text-[11.5px] font-semibold ${on ? "" : "opacity-40"}`}>
              <i className="h-[3px] w-2.5 rounded-sm" style={{ background: colors.get(id) }} />{m.name}
            </button>
          );
        })}
      </div>
      <div className="px-3 py-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={metric.title()}>
          {sc && ticks.map((v) => {
            const y = T + h - ((v - sc.lo) / (sc.hi - sc.lo)) * h;
            return <g key={v}><line x1={L} x2={W - R} y1={y} y2={y} className="stroke-line" /><text x={L - 6} y={y + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">{v}{metric.unit.trim()}</text></g>;
          })}
          {sc && [0, 1, 2, 3, 4].map((i) => <text key={i} x={L + (i / 4) * w} y={H - 7} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} className="fill-muted font-mono text-[10px]">{hhmm(sc.t0 + (i / 4) * (sc.t1 - sc.t0))}</text>)}
          {sc && shown.map(({ m, pts }) => {
            const last = pts[pts.length - 1], c = colors.get(m.id ?? "");
            return (
              <g key={m.id} transform={`translate(${L} ${T})`}>
                <path d={linePath(pts, sc, w, h)} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
                <circle cx={((last[0] - sc.t0) / (sc.t1 - sc.t0 || 1)) * w} cy={h - ((last[1] - sc.lo) / (sc.hi - sc.lo)) * h} r={3.2} fill={c} />
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function Shutters({ list, title }: Readonly<{ list: NetatmoModule[]; title: string }>) {
  return (
    <section className={PANEL} aria-label={title}>
      <div className={HEAD}><h2 className="text-sm font-bold">{title}</h2><span className="text-xs text-muted">{tx("{0} appareil(s)", list.length)}</span></div>
      <ul className="px-4 py-2">
        {list.map((m) => {
          const pos = typeof m.values.current_position === "number" ? m.values.current_position : null;
          return (
            <li key={m.id ?? m.name} className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-line py-2 first:border-t-0">
              <div className="relative size-[34px] overflow-hidden rounded-[5px] border-2 border-muted bg-bg2" aria-hidden>
                <i className="absolute inset-x-0 top-0 bg-[repeating-linear-gradient(180deg,#ff8d15_0_2px,transparent_2px_5px)]" style={{ height: `${100 - (pos ?? 100)}%` }} />
              </div>
              <div className="min-w-0 truncate text-[13px] font-semibold">{m.name}{m.room && <small className="block text-[11.5px] font-normal text-muted">{m.room}</small>}</div>
              <span className="min-w-16 text-right font-mono text-[13px] font-bold">{shutterState(m).replace(/^ouvert à /, "")}</span>
              {pos !== null && <div className={`${TRACK} col-span-2 col-start-2`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pos} aria-label={m.name}><span className="absolute inset-y-0 left-0 rounded-full bg-[#ff8d15]" style={{ width: `${pos}%` }} /></div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A heated room: the measured temperature (full mark) and the setpoint (hollow mark) on a cold to warm scale of 10 to 30° */
function Heating({ rooms }: Readonly<{ rooms: { name: string; temperature: number | null; setpoint: number | null }[] }>) {
  const at = (t: number) => `${Math.min(100, Math.max(0, ((t - 10) / 20) * 100))}%`;
  return (
    <section className={PANEL} aria-label={tx("Chauffage")}>
      <div className={HEAD}><h2 className="text-sm font-bold">{tx("Chauffage")}</h2><span className="text-xs text-muted">{tx("température, consigne")}</span></div>
      <ul className="grid gap-3 px-4 py-3">
        {rooms.map((r) => (
          <li key={r.name} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3"><b className="truncate text-sm">{r.name}</b><span className="font-mono text-sm"><b className="text-lg">{r.temperature ?? "-"}°</b> <span className="text-xs text-muted">{tx("consigne {0}°", r.setpoint ?? "-")}</span></span></div>
            <div className="relative h-2.5 rounded-full opacity-90" style={{ background: "linear-gradient(90deg,#4aa8ff,#4cd07f 50%,#ff8d15)" }} aria-hidden>
              {r.temperature != null && <b className="absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded-sm bg-txt shadow-[0_0_0_2px_rgb(var(--card))]" style={{ left: at(r.temperature) }} />}
              {r.setpoint != null && <u className="absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded-sm border-2 border-txt no-underline" style={{ left: at(r.setpoint) }} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Plain({ title, aside, rows }: Readonly<{ title: string; aside?: React.ReactNode; rows: { key: string; name: string; note: string }[] }>) {
  return (
    <section className={PANEL} aria-label={title}>
      <div className={HEAD}><h2 className="text-sm font-bold">{title}</h2>{aside}</div>
      <ul className="px-4 py-2">{rows.map((r) => <li key={r.key} className="flex justify-between gap-3 py-1 text-sm"><span className="min-w-0 truncate">{r.name}</span><span className="shrink-0 text-muted">{r.note}</span></li>)}</ul>
    </section>
  );
}

const OUTDOOR_CAMERAS = ["NOC", "NDB"];

/** A camera: its picture of the moment as a thumbnail (read by the server, never kept), its place and whether it watches */
function CameraCard({ m, picture }: Readonly<{ m: NetatmoModule; picture: boolean }>) {
  const [at, setAt] = useState(() => Date.now()), [failed, setFailed] = useState(false);
  const up = m.reachable, watching = m.values.monitoring === "on", shows = picture && up && !failed;
  const q = new URLSearchParams({ connector: m.source?.connector ?? "", name: m.source?.name ?? "", camera: m.name, t: String(at) });
  return (
    <article className={PANEL}>
      <div className="relative aspect-video bg-bg2">
        {shows
          ? <img src={`${ROOT}api/v1/stream/snapshot?${q}`} alt={tx("Image de la caméra {0}", m.name)} loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
          : <div className="grid size-full place-items-center text-muted">{picture && up ? <ImageOff size={30} aria-hidden /> : <Video size={30} aria-hidden />}</div>}
        <span className={`absolute left-2 top-2 rounded-full border border-line bg-card/90 px-2 py-0.5 text-[11px] font-bold ${up ? "text-ok" : "text-bad"}`}>{up ? tx("en ligne") : tx("Hors ligne")}</span>
        {picture && up && <button type="button" onClick={() => { setFailed(false); setAt(Date.now()); }} aria-label={tx("Actualiser l'image")} title={tx("Actualiser l'image")} className="absolute right-2 top-2 rounded-full bg-card/90 p-1.5 text-muted hover:text-txt"><RefreshCw size={14} aria-hidden /></button>}
      </div>
      <div className="grid gap-0.5 px-3.5 py-2.5">
        <h3 className="truncate text-sm font-bold">{m.name}</h3>
        <p className="truncate text-xs text-muted">{[m.room, OUTDOOR_CAMERAS.includes(m.type ?? "") ? tx("extérieure") : tx("intérieure"), watching ? tx("surveillance active") : tx("surveillance coupée")].filter(Boolean).join(" · ")}</p>
      </div>
    </article>
  );
}

const place = (m: NetatmoModule, note: string) => [m.room, note].filter(Boolean).join(" · ");

export function Netatmo({ snap }: Readonly<{ snap: Snapshot }>) {
  const h = house(snap), curves = useCurves(h.sensors);
  const colors = new Map(h.sensors.map((m, i) => [m.id ?? m.name, COLORS[i % COLORS.length]]));
  return (
    <div className="flex flex-col gap-5 py-4">
      <PageHead icon={House} logo={appIcon(["netatmo"])} title="Netatmo" tags={null} actions={snap.me.role === "admin" ? <ConnectorsLink /> : undefined} />
      <section>
        <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">{h.title}</h2>
        <p className="mt-1.5 text-[15px] text-muted">{h.text}</p>
      </section>
      <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label={tx("Chiffres clés")}>
        {h.tiles.map((t) => <StatTile key={t.label} n={t.value} label={t.label} sub={t.sub} tone={t.tone} />)}
      </nav>
      <div className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {METRICS.map((mt) => <Chart key={mt.key} metric={mt} sensors={h.sensors.filter((m) => typeof m.values[mt.key] === "number")} curves={curves} colors={colors} />)}
      </div>
      <section aria-label={tx("Pièce par pièce")}>
        <h2 className="mb-2.5 text-base font-bold">{tx("Pièce par pièce")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{h.sensors.map((m) => <Room key={m.id ?? m.name} m={m} series={curves[m.id ?? ""]} color={colors.get(m.id ?? m.name) ?? ORANGE} />)}</div>
      </section>
      <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {h.shutters.length > 0 && <Shutters list={h.shutters} title={tx("Volets roulants")} />}
        {h.blinds.length > 0 && <Shutters list={h.blinds} title={tx("Stores extérieurs")} />}
        {(h.rooms.length > 0 || h.others.length > 0) && (
          <div className="grid gap-3">
            {h.rooms.length > 0 && <Heating rooms={h.rooms} />}
            {h.others.length > 0 && <Plain title={tx("Autres appareils")} rows={h.others.map((m) => ({ key: m.id ?? m.name, name: m.name, note: place(m, moduleState(m).label) }))} />}
          </div>
        )}
      </div>
      {h.cameras.length > 0 && (
        <section aria-label={tx("Caméras")}>
          <div className="mb-2.5 flex items-baseline justify-between gap-3"><h2 className="text-base font-bold">{tx("Caméras")}</h2>{h.pictures && <a href="#stream/cameras" className="text-xs font-semibold">{tx("Voir les images")}</a>}</div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">{h.cameras.map((m) => <CameraCard key={m.id ?? m.name} m={m} picture={h.pictures && m.source?.connector === "netatmo"} />)}</div>
        </section>
      )}
    </div>
  );
}
