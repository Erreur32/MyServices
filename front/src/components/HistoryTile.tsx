// A figure tile with its history at the right of the figure: a strip of states (reachability) or a stepped curve (health), over the
// period chosen for the row. The pointer reads one moment of it; a click filters the list under the tiles.
import { useEffect, useState, type MouseEvent } from "react";
import { read } from "../api";
import { StatTile } from "./StatTile";
import { periodLabel } from "./PeriodSwitch";
import { curve, delta, nearest, stripCells, type Period, type TilePoint } from "../lib/tileHistory";
import { tx } from "../lib/i18n";

/** What /machines/history answers for a period */
interface MachinesHistory { hours: Period; reach: TilePoint[]; health: TilePoint[] }

/** The history of the Machines tiles for a period; read again at each collection (`stamp`). null while it loads or when it cannot be read. */
export function useMachinesHistory(hours: Period, stamp: string): MachinesHistory | null {
  const [got, setGot] = useState<MachinesHistory | null>(null);
  useEffect(() => {
    let off = false;
    read<MachinesHistory>(`machines/history?hours=${hours}`).then((r) => { if (!off) setGot(r); }).catch(() => { if (!off) setGot(null); });
    return () => { off = true; };
  }, [hours, stamp]);
  return got?.hours === hours ? got : null;
}

const CELL = ["bg-ok/25", "bg-warn", "bg-bad"];   // all answered, one missing, two or more
/** Mouse handlers of a chart: where the pointer is along it (0 left edge, 1 right edge), and when it leaves */
const hover = (onMove: (f: number) => void, onLeave: () => void) => ({
  onMouseMove: (e: MouseEvent<Element>) => { const r = e.currentTarget.getBoundingClientRect(); onMove((e.clientX - r.left) / r.width); },
  onMouseLeave: onLeave,
});
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Strip({ points, hours, now, onMove, onLeave }: Readonly<{ points: TilePoint[]; hours: Period; now: number; onMove: (f: number) => void; onLeave: () => void }>) {
  const cells = stripCells(points, hours, now);
  return (
    <div aria-hidden className="grid h-6 min-w-[70px] max-w-[150px] flex-1 cursor-crosshair items-stretch gap-px" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}
      {...hover(onMove, onLeave)}>
      {cells.map((c) => <i key={c.t} className={`rounded-[1.5px] ${c.level === null ? "bg-bg2" : CELL[c.level]}`} />)}
    </div>
  );
}

function Curve({ points, hours, now, good, onMove, onLeave }: Readonly<{ points: TilePoint[]; hours: Period; now: number; good: boolean; onMove: (f: number) => void; onLeave: () => void }>) {
  const c = curve(points, hours, now);
  if (!c.last) return null;
  const tone = good ? "rgb(var(--ok))" : "rgb(var(--warn))";
  return (
    <svg aria-hidden viewBox="0 0 120 34" preserveAspectRatio="none" className="h-[34px] min-w-[70px] max-w-[130px] flex-1 cursor-crosshair overflow-visible"
      {...hover(onMove, onLeave)}>
      <path d={c.area} fill={tone} opacity="0.12" />
      <path d={c.line} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" className="text-dim" opacity="0.7" />
      {c.dips && <path d={c.dips} fill="none" stroke="rgb(var(--warn))" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />}
      <circle cx={c.last[0]} cy={c.last[1]} r="2.6" fill={tone} />
    </svg>
  );
}

export function HistoryTile({ label, n, tone, hint, kind, points, hours, now, figure, fmt, goodHigh, onClick, pressed }: Readonly<{
  label: string; n: string | number; tone?: "ok" | "warn" | "bad"; hint?: string; kind: "strip" | "curve";
  points: TilePoint[] | null;   // null: not read (yet)
  hours: Period; now: number;
  figure: (p: TilePoint) => number;   // the number the tile counts, for the change over the period
  fmt: (p: TilePoint) => string;   // one reading, as the pointer shows it
  goodHigh: boolean;   // more is better (reachable, healthy)
  onClick?: () => void; pressed?: boolean;
}>) {
  const [at, setAt] = useState<number | null>(null);
  const shown = points && at !== null ? nearest(points, hours, now, at) : null;
  const change = points ? delta(points, hours, now, figure) : null;
  let sub: string;
  if (shown) sub = `${when(shown[0])} : ${fmt(shown)}`;
  else if (change === null) sub = tx("historique en cours");
  else if (change === 0) sub = tx("stable sur {0}", periodLabel(hours));
  else sub = tx("{0} en {1}", `${change > 0 ? "+" : "−"}${Math.abs(change)}`, periodLabel(hours));
  const ready = !!points && change !== null;
  const leave = () => setAt(null);
  let chart = null;   // right of the figure: a strip of states, or a curve
  if (ready) chart = kind === "strip" ? <Strip points={points} hours={hours} now={now} onMove={setAt} onLeave={leave} /> : <Curve points={points} hours={hours} now={now} good={goodHigh} onMove={setAt} onLeave={leave} />;
  return (
    <StatTile n={n} label={label} tone={tone} hint={hint} aside={chart} onClick={onClick} pressed={pressed}>
      <div className="truncate text-xs text-dim" title={sub}>{sub}</div>
    </StatTile>
  );
}
