// The Download or Upload tile of the Network page: the rate of the Internet link per source (Freebox, UniFi), one curve each on a shared
// scale, and a legend that switches a curve off. The pointer reads one moment of every curve shown.
import { useState } from "react";
import { StatTile } from "./StatTile";
import { curve, inPeriod, nearest, type Period, type TilePoint } from "../lib/tileHistory";
import { lastOf, rateText, topOf } from "../lib/bandwidth";
import { tx } from "../lib/i18n";

export interface BandwidthSource { id: string; name: string; color: string; points: TilePoint[] | null }

const HIDDEN_KEY = "ms.bandwidth.hidden";
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]; } catch { return []; } };
const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

export function BandwidthTile({ label, sources, hours, now }: Readonly<{ label: string; sources: BandwidthSource[]; hours: Period; now: number }>) {
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [at, setAt] = useState<number | null>(null);
  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* the choice is only not kept */ }
  };
  const shown = sources.filter((s) => !hidden.includes(s.id) && inPeriod(s.points ?? [], hours, now).length >= 2);
  const top = topOf(shown.map((s) => s.points));
  // one axis for every curve, from the moment both have a reading to the newest one: curves start and end side by side
  const kept = shown.map((s) => inPeriod(s.points!, hours, now));
  const from = Math.max(...kept.map((k) => k[0][0])), end = Math.max(...kept.map((k) => k.at(-1)![0]));
  const clipped = (points: TilePoint[]): TilePoint[] => {
    const before = points.filter((p) => p[0] <= from).at(-1);
    return [...(before ? [[from, before[1], before[2]] as TilePoint] : []), ...points.filter((p) => p[0] > from)];
  };
  const reading = (s: BandwidthSource): TilePoint | null => (at !== null && s.points ? nearest(clipped(s.points), hours, end, at, true, from) : lastOf(s.points));
  const live = sources.filter((s) => !hidden.includes(s.id)).map((s) => lastOf(s.points)?.[1]).filter((v): v is number => v !== undefined);
  const first = at !== null ? shown.map((s) => reading(s)).find(Boolean) : null;
  const chart = shown.length === 0 ? null : (
    <svg aria-hidden viewBox="0 0 120 34" preserveAspectRatio="none" className="h-[34px] min-w-[90px] flex-1 cursor-crosshair overflow-visible"
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt((e.clientX - r.left) / r.width); }} onMouseLeave={() => setAt(null)}>
      {shown.map((s) => {
        const c = curve(clipped(s.points!), hours, end, 120, 34, top, from, true);
        return c.last && (
          <g key={s.id} style={{ color: s.color }}>
            <path d={c.area} fill="currentColor" opacity="0.10" />
            <path d={c.line} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            <path d={`M${c.last[0].toFixed(1)} ${c.last[1].toFixed(1)}h0.01`} stroke="currentColor" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
  return (
    <StatTile n={live.length ? rateText(Math.max(...live)) : "-"} label={label} aside={chart} wide>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        {sources.map((s) => {
          const off = hidden.includes(s.id), p = reading(s);
          return (
            <button key={s.id} type="button" aria-pressed={!off} onClick={() => toggle(s.id)} title={off ? tx("Afficher la courbe") : tx("Masquer la courbe")}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 hover:bg-bg2 ${off ? "text-dim line-through opacity-60" : "text-muted"}`}>
              <i className="inline-block size-2 rounded-full" style={{ background: s.color }} />{s.name} <b className="font-mono font-semibold text-txt">{p ? rateText(p[1]) : "-"}</b>
            </button>
          );
        })}
        {first && <span className="text-dim">{when(first[0])}</span>}
      </div>
    </StatTile>
  );
}
