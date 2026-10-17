// Graphiques de l'historique : points à l'heure exacte (une ligne par famille), barres empilées, courbe empilée, carte de chaleur.
// Tout est dessiné en HTML / SVG sans bibliothèque ; les textes restent en HTML pour ne pas être déformés.
import { useRef, useState } from "react";
import { dateTime, hm, longDay } from "../lib/format";
import { LOCALE, tx } from "../lib/i18n";
import { GROUPS, GROUP_COLOR, GROUP_FILL, GROUP_NAME, groupOf, heat, ticks, yScale, type Bucket } from "../lib/historyChart";
import type { StoredEvent } from "../types";

/** Sélection d'une plage de temps (secondes) qui filtre la liste sous le graphique */
export interface Range { from: number; to: number; label: string }

const sec = (ms: number) => ms / 1000;
const label = (ms: number, days: number) => (days <= 2 ? hm(ms) : new Date(ms).toLocaleDateString(LOCALE, { day: "numeric", month: "short" }));

/** Axe du temps sous le graphique : des repères réguliers, à l'heure près sur 24 h */
function Axis({ from, to, days }: { from: number; to: number; days: number }) {
  return (
    <div className="relative mt-1 h-4 text-[11px] text-dim">
      {ticks(from, to).map((t, i, a) => (
        <span key={t} className="absolute whitespace-nowrap" style={{ left: `${(i / (a.length - 1)) * 100}%`, transform: `translateX(${i === 0 ? "0" : i === a.length - 1 ? "-100%" : "-50%"})` }}>
          {i === a.length - 1 ? tx("maintenant") : label(t, days)}
        </span>
      ))}
    </div>
  );
}

/** Axe vertical du nombre d'événements : repères chiffrés à gauche, traits fins en pointillés derrière le graphique */
function YAxis({ ticks: t, top, children }: { ticks: number[]; top: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className="relative h-40 w-8 shrink-0 text-right text-[11px] tabular-nums text-dim" aria-hidden>
        {t.map((v) => <span key={v} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(v / top) * 100}%` }}>{v}</span>)}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden>
          {t.map((v) => <span key={v} className={`absolute inset-x-0 border-t ${v === 0 ? "border-line" : "border-dashed border-line/80"}`} style={{ bottom: `${(v / top) * 100}%` }} />)}
          {[1, 2, 3, 4, 5].map((i) => <span key={i} className="absolute inset-y-0 border-l border-dashed border-line/60" style={{ left: `${(i / 6) * 100}%` }} />)}  {/* repères verticaux alignés sur l'axe du temps */}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Un point par événement, à son heure exacte ; une ligne par famille. Clic = la liste se limite à ce jour.
 *  Souris dans le graphique : un repère pointillé suit le temps (heure en haut) ; sur un point, le repère descend du point à l'axe et le point est mis en avant. */
export function PointsChart({ events, from, to, days, onRange }: { events: StoredEvent[]; from: number; to: number; days: number; onRange: (r: Range) => void }) {
  const plot = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);   // 0..1 across the plot
  const [hot, setHot] = useState<number | null>(null);          // index of the hovered point
  const lanes = GROUPS.filter(([k]) => events.some((e) => groupOf(e.kind) === k));
  if (!lanes.length) return null;
  const pct = (ts: number) => Math.min(100, Math.max(0, ((ts * 1000 - from) / (to - from)) * 100));
  const x = (ts: number) => `${pct(ts)}%`;
  const move = (ev: React.MouseEvent) => {
    const r = plot.current?.getBoundingClientRect();
    if (r && r.width > 0) setCursor(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
  };
  const point = hot != null ? events[hot] : null;
  const pointLane = point ? lanes.findIndex(([k]) => k === groupOf(point.kind)) : -1;
  const shownAt = point ? point.ts * 1000 : cursor != null ? from + cursor * (to - from) : null;
  const shownX = point ? pct(point.ts) : cursor != null ? cursor * 100 : null;
  return (
    <div className="flex gap-3">
      <div className="flex h-40 w-32 shrink-0 flex-col text-xs text-muted sm:w-40">
        {lanes.map(([k, l, c]) => (
          <span key={k} className="flex flex-1 items-center gap-1.5 truncate" title={l}><span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${c}`} />{l}
            <b className="font-normal text-dim">{events.filter((e) => groupOf(e.kind) === k).length}</b></span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div ref={plot} className="relative h-40 rounded-lg bg-bg2/50" onMouseMove={move} onMouseLeave={() => { setCursor(null); setHot(null); }}>
          {ticks(from, to).map((t, i) => <span key={t} className="absolute inset-y-0 border-l border-dashed border-line/70" style={{ left: `${(i / 6) * 100}%` }} />)}
          {lanes.map(([k], i) => <span key={k} className="absolute inset-x-0 border-t border-dashed border-line/60" style={{ top: `${(i / lanes.length) * 100}%` }} />)}
          {shownX != null && !point && <span className="pointer-events-none absolute inset-y-0 border-l border-dashed border-link/40" style={{ left: `${shownX}%` }} aria-hidden />}
          {point && pointLane >= 0 && <span className="pointer-events-none absolute bottom-0 border-l-2 border-dashed border-link" style={{ left: x(point.ts), top: `${((pointLane + 0.5) / lanes.length) * 100}%` }} aria-hidden />}
          {shownAt != null && shownX != null && (
            <span className="pointer-events-none absolute top-0.5 z-20 whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-[11px] tabular-nums text-txt shadow ring-1 ring-line"
              style={{ left: `${shownX}%`, transform: `translateX(${shownX > 85 ? "-100%" : shownX < 15 ? "0" : "-50%"})` }}>{days <= 2 ? hm(shownAt) : dateTime(shownAt)}</span>
          )}
          {events.map((e, i) => {
            const lane = lanes.findIndex(([k]) => k === groupOf(e.kind));
            if (lane < 0 || e.ts * 1000 < from) return null;
            const d = new Date(e.ts * 1000), day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            return (
              <button key={`${e.ts}-${e.key}-${i}`} type="button" onClick={() => onRange({ from: sec(day0), to: sec(day0 + 86400e3), label: longDay(d) })}
                onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}
                title={`${dateTime(e.ts * 1000)}:${String(d.getSeconds()).padStart(2, "0")} · ${e.label || "?"}${e.machine ? ` · ${e.machine}` : ""}${e.detail ? `\n${e.detail}` : ""}`}
                className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-card hover:z-10 ${hot === i ? "z-10 scale-150 opacity-100 ring-2 ring-link" : "opacity-80"} ${GROUP_COLOR[GROUPS[lane][0]]}`}
                style={{ left: x(e.ts), top: `${((lane + 0.5) / lanes.length) * 100}%` }} />
            );
          })}
        </div>
        <Axis from={from} to={to} days={days} />
      </div>
    </div>
  );
}

/** Barres empilées par famille ; clic sur une barre = la liste se limite à cette plage */
export function BarsChart({ data, days, active, onRange }: { data: Bucket[]; days: number; active: Range | null; onRange: (r: Range | null) => void }) {
  const { top, ticks: yt } = yScale(Math.max(0, ...data.map((b) => b.total)));
  const span = data[0] ? data[0].end - data[0].start : 0;
  const name = (b: Bucket) => (span >= 86400e3 ? longDay(b.start) : `${dateTime(b.start)} – ${hm(b.end)}`);
  return (
    <YAxis ticks={yt} top={top}>
      <div className="relative flex h-40 items-end gap-[2px]" role="img" aria-label={tx("Événements par période")}>
        {data.map((b) => {
          const on = active?.from === sec(b.start);
          return (
            <button key={b.start} type="button" onClick={() => b.total && onRange(on ? null : { from: sec(b.start), to: sec(b.end), label: name(b) })}
              title={tx("{0} : {1} événement{2}", name(b), b.total, b.total > 1 ? "s" : "")}
              className={`flex h-full min-w-[3px] flex-1 flex-col-reverse rounded-sm ${b.total ? "cursor-pointer hover:bg-bg2" : "cursor-default"} ${on ? "bg-link/15 ring-1 ring-link" : ""}`}>
              {GROUPS.filter(([k]) => b.parts[k]).map(([k, , c]) => <span key={k} className={`block w-full ${c}`} style={{ height: `${(b.parts[k] / top) * 100}%` }} />)}
            </button>
          );
        })}
      </div>
      {data[0] && <Axis from={data[0].start} to={data.at(-1)!.end} days={days} />}
    </YAxis>
  );
}

/** Courbe empilée par famille (l'épaisseur de chaque couleur = le nombre d'événements du barreau) */
export function AreaChart({ data, days }: { data: Bucket[]; days: number }) {
  if (data.length < 2) return null;
  const { top: max, ticks: yt } = yScale(Math.max(0, ...data.map((b) => b.total)));
  const W = 1000, H = 160, step = W / (data.length - 1);
  const keys = GROUPS.map(([k]) => k).filter((k) => data.some((b) => b.parts[k]));
  const below = data.map(() => 0);  // sommet de la pile en dessous, par barreau
  const layers = keys.map((k) => {
    const top = data.map((b, i) => below[i] + (b.parts[k] || 0));
    const path = `M0,${H - (below[0] / max) * H} ` + top.map((v, i) => `L${i * step},${H - (v / max) * H}`).join(" ")
      + " " + [...below.keys()].reverse().map((j) => `L${j * step},${H - (below[j] / max) * H}`).join(" ") + " Z";
    top.forEach((v, i) => { below[i] = v; });
    return { k, path };
  });
  return (
    <YAxis ticks={yt} top={max}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="relative h-40 w-full" role="img" aria-label={tx("Événements au fil du temps")}>
        {layers.map((l) => <path key={l.k} d={l.path} fill={GROUP_FILL[l.k]} fillOpacity="0.75"><title>{GROUP_NAME[l.k]}</title></path>)}
      </svg>
      <Axis from={data[0].start} to={data.at(-1)!.end} days={days} />
    </YAxis>
  );
}

/** Carte de chaleur : quels jours de la semaine et à quelle heure les événements arrivent */
/** Weekday names, Monday first */
export const heatDays = (): string[] => [...Array(7)].map((_, i) => new Date(2026, 9, 12 + i).toLocaleDateString(LOCALE, { weekday: "short" }));

/** A cell of the heat map: weekday (0 = Monday) and hour */
export interface HeatCell { d: number; h: number }

/** Events per weekday and hour, every week of the period piled up. A click on a cell limits the list to that weekday and hour. */
export function HeatChart({ events, active, onPick }: { events: StoredEvent[]; active: HeatCell | null; onPick: (c: HeatCell | null) => void }) {
  const grid = heat(events), max = Math.max(1, ...grid.flat());
  const days = heatDays();
  return (
    <div className="text-[11px] text-dim" role="group" aria-label={tx("Événements par jour de la semaine et par heure")}>
      <div className="flex h-40 flex-col gap-[3px]">
      {grid.map((row, d) => (
        <div key={d} className="flex min-h-0 flex-1 items-center gap-[3px]">
          <span className="w-10 shrink-0 capitalize">{days[d]}</span>
          {row.map((n, h) => {
            const on = active?.d === d && active.h === h;
            return (
              <button key={h} type="button" disabled={!n} onClick={() => onPick(on ? null : { d, h })} aria-pressed={on}
                title={tx("{0} {1} h : {2} événement{3}", days[d], h, n, n > 1 ? "s" : "")}
                className={`h-full flex-1 rounded-sm bg-link ${on ? "ring-2 ring-txt" : ""} ${n ? "cursor-pointer hover:ring-1 hover:ring-txt" : "cursor-default"}`}
                style={{ opacity: n ? 0.15 + 0.85 * (n / max) : 0.05 }} />
            );
          })}
        </div>
      ))}
      </div>
      <div className="mt-1 flex h-4 gap-[3px] pl-10">{[...Array(24)].map((_, h) => <span key={h} className="flex-1 whitespace-nowrap text-center">{h % 3 === 0 ? `${h} h` : ""}</span>)}</div>
      <div className="mt-2 flex items-center justify-end gap-1.5" aria-label={tx("Échelle")}>
        <span>0</span>
        {[0.05, 0.25, 0.5, 0.75, 1].map((o) => <span key={o} className="h-3 w-6 rounded-sm bg-link" style={{ opacity: o === 0.05 ? 0.05 : 0.15 + 0.85 * o }} aria-hidden />)}
        <span>{max} {tx("événement(s) par case")}</span>
      </div>
    </div>
  );
}
