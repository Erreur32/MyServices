// A figure tile with its history at the right of the figure: a strip of states (reachability) or a stepped curve (health), over the
// period chosen for the row. The pointer reads one moment of it; a click filters the list under the tiles.
import { useEffect, useState, type MouseEvent } from "react";
import { read } from "../api";
import { StatTile } from "./StatTile";
import { periodLabel } from "./PeriodSwitch";
import { curve, delta, nearest, stripCells, type Period, type TilePoint } from "../lib/tileHistory";
import { tx } from "../lib/i18n";

/** What /machines/history and /services/history answer for a period */
interface MachinesHistory { hours: Period; reach: TilePoint[]; health: TilePoint[]; cpu: TilePoint[]; mem: TilePoint[] }
interface BackupsHistory { hours: Period; ok: TilePoint[]; late: TilePoint[]; bad: TilePoint[] }
interface AgentsHistory { hours: Period; running: TilePoint[]; late: TilePoint[] }
interface ServicesHistory { hours: Period; up: TilePoint[]; warn: TilePoint[] }
interface NetworkHistory { hours: Period; gear: TilePoint[]; clients: TilePoint[]; devices: TilePoint[]; bw?: Record<"fbx.down" | "fbx.up" | "unifi.down" | "unifi.up", TilePoint[]> }

/** The history of the tiles of a page for a period; read again at each collection (`stamp`). null while it loads or when it cannot be read. */
function useHistory<T extends { hours: Period }>(path: string, hours: Period, stamp: string): T | null {
  const [got, setGot] = useState<T | null>(null);
  useEffect(() => {
    let off = false;
    read<T>(`${path}?hours=${hours}`).then((r) => { if (!off) setGot(r); }).catch(() => { if (!off) setGot(null); });
    return () => { off = true; };
  }, [path, hours, stamp]);
  return got?.hours === hours ? got : null;
}

export const useMachinesHistory = (hours: Period, stamp: string) => useHistory<MachinesHistory>("machines/history", hours, stamp);
export const useNetworkHistory = (hours: Period, stamp: string) => useHistory<NetworkHistory>("network/history", hours, stamp);
export const useBackupsHistory = (hours: Period, stamp: string) => useHistory<BackupsHistory>("backups/history", hours, stamp);
export const useAgentsHistory = (hours: Period, stamp: string) => useHistory<AgentsHistory>("agents/history", hours, stamp);
export const useServicesHistory = (hours: Period, stamp: string) => useHistory<ServicesHistory>("services/history", hours, stamp);

const CELL = ["bg-ok/40", "bg-warn", "bg-bad"];   // all answered, one missing, two or more
/** Mouse handlers of a chart: where the pointer is along it (0 left edge, 1 right edge), and when it leaves */
const hover = (onMove: (f: number) => void, onLeave: () => void) => ({
  onMouseMove: (e: MouseEvent<Element>) => { const r = e.currentTarget.getBoundingClientRect(); onMove((e.clientX - r.left) / r.width); },
  onMouseLeave: onLeave,
});
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Strip({ points, hours, now, at, onMove, onLeave }: Readonly<{ points: TilePoint[]; hours: Period; now: number; at: number | null; onMove: (f: number) => void; onLeave: () => void }>) {
  const cells = stripCells(points, hours, now);
  const hot = at === null ? -1 : Math.min(cells.length - 1, Math.floor(at * cells.length));   // the column under the pointer
  return (
    <div aria-hidden className="grid h-6 min-w-[90px] flex-1 cursor-crosshair items-stretch gap-px" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}
      {...hover(onMove, onLeave)}>
      {cells.map((c, i) => <i key={c.t} className={`rounded-[1.5px] ${c.level === null ? "bg-bg2" : CELL[c.level]} ${i === hot ? "outline outline-1 outline-offset-1 outline-txt" : ""}`} />)}
    </div>
  );
}

function Curve({ points, hours, now, good, scale, dips, onMove, onLeave }: Readonly<{ points: TilePoint[]; hours: Period; now: number; good: boolean; scale?: number; dips: boolean; onMove: (f: number) => void; onLeave: () => void }>) {
  const c = curve(points, hours, now, 120, 34, scale);
  if (!c.last) return null;
  const tone = good ? "rgb(var(--ok))" : "rgb(var(--warn))";
  return (
    <svg aria-hidden viewBox="0 0 120 34" preserveAspectRatio="none" className="h-[34px] min-w-[70px] flex-1 cursor-crosshair overflow-visible"
      {...hover(onMove, onLeave)}>
      <path d={c.area} fill={tone} opacity="0.12" />
      <path d={c.line} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" className="text-dim" opacity="0.7" />
      {dips && c.dips && <path d={c.dips} fill="none" stroke="rgb(var(--warn))" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />}
      <path d={`M${c.last[0].toFixed(1)} ${c.last[1].toFixed(1)}h0.01`} stroke={tone} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HistoryTile({ label, n, tone, hint, fact, scale, dips = true, kind, points, hours, now, figure, fmt, goodHigh, onClick, pressed }: Readonly<{
  label: string; n: string | number; tone?: "ok" | "warn" | "bad"; hint?: string; kind: "strip" | "curve";
  dips?: boolean;   // the stretches of a curve below the total drawn in orange; off when the total is never reached (devices online)
  scale?: number;   // a curve of levels out of this value (100 for a percentage), not of machines out of a total
  fact?: string;   // what the tile says under the figure instead of the change over the period (the pointer still reads a moment)
  points: TilePoint[] | null;   // null: not read (yet)
  hours: Period; now: number;
  figure: (p: TilePoint) => number;   // the number the tile counts, for the change over the period
  fmt: (p: TilePoint) => string;   // one reading, as the pointer shows it
  goodHigh: boolean;   // more is better (reachable, healthy)
  onClick?: () => void; pressed?: boolean;
}>) {
  const [at, setAt] = useState<number | null>(null);
  const shown = points && at !== null ? nearest(points, hours, now, at, kind === "curve") : null;
  const change = points ? delta(points, hours, now, figure) : null;
  let sub: string;
  if (shown) sub = `${when(shown[0])} : ${fmt(shown)}`;
  else if (fact !== undefined) sub = fact;
  else if (change === null) sub = tx("historique en cours");
  else if (change === 0) sub = tx("stable sur {0}", periodLabel(hours));
  else sub = tx("{0} en {1}", `${change > 0 ? "+" : "−"}${Math.abs(change)}`, periodLabel(hours));
  const ready = !!points && change !== null;
  const leave = () => setAt(null);
  let chart = null;   // right of the figure: a strip of states, or a curve
  if (ready) chart = kind === "strip" ? <Strip points={points} hours={hours} now={now} at={at} onMove={setAt} onLeave={leave} /> : <Curve points={points} hours={hours} now={now} good={goodHigh} scale={scale} dips={dips} onMove={setAt} onLeave={leave} />;
  return (
    <StatTile n={n} label={label} tone={tone} hint={hint} aside={chart} onClick={onClick} pressed={pressed}>
      <div className="truncate text-xs text-dim" title={sub}>{sub}</div>
    </StatTile>
  );
}

/** A tile whose history is a count per slot already given by the source (bans per hour or per day): bars right of the figure, the pointer reads one slot.
 *  `values`: oldest first, the last one being the slot in course. */
export function BarsTile({ label, n, tone, sub, values, perDay = false }: Readonly<{ label: string; n: string | number; tone?: "ok" | "warn" | "bad"; sub: string; values: number[]; perDay?: boolean }>) {
  const [at, setAt] = useState<number | null>(null);
  const top = Math.max(1, ...values);
  const hot = at === null ? -1 : Math.min(values.length - 1, Math.floor(at * values.length));
  const slotOf = (i: number) => {
    const d = new Date(Date.now() - (values.length - 1 - i) * (perDay ? 86_400_000 : 3_600_000));
    return perDay ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) : `${String(d.getHours()).padStart(2, "0")} h`;
  };
  const bars = (
    <div aria-hidden className="flex h-6 min-w-[90px] flex-1 cursor-crosshair items-end gap-px" {...hover(setAt, () => setAt(null))}>
      {values.map((v, i) => <i key={`${i}-${v}`} style={{ height: `${Math.max(v ? 12 : 4, (v / top) * 100)}%` }} className={`flex-1 rounded-[1.5px] ${v ? "bg-warn" : "bg-bg2"} ${i === hot ? "outline outline-1 outline-offset-1 outline-txt" : ""}`} />)}
    </div>
  );
  return (
    <StatTile n={n} label={label} tone={tone} aside={values.length ? bars : null} sub={hot >= 0 ? tx("{0} : {1} bannissement(s)", slotOf(hot), values[hot]) : sub} />
  );
}
