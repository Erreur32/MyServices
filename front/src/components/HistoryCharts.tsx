// Graphiques de l'historique : points à l'heure exacte (une ligne par famille), barres empilées, courbe empilée, carte de chaleur.
// Tout est dessiné en HTML / SVG sans bibliothèque ; les textes restent en HTML pour ne pas être déformés.
import { dateTime, hm, longDay } from "../lib/format";
import { LOCALE, tx } from "../lib/i18n";
import { GROUPS, GROUP_COLOR, GROUP_FILL, GROUP_NAME, groupOf, heat, ticks, type Bucket } from "../lib/historyChart";
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

/** Un point par événement, à son heure exacte ; une ligne par famille. Clic = la liste se limite à ce jour. */
export function PointsChart({ events, from, to, days, onRange }: { events: StoredEvent[]; from: number; to: number; days: number; onRange: (r: Range) => void }) {
  const lanes = GROUPS.filter(([k]) => events.some((e) => groupOf(e.kind) === k));
  if (!lanes.length) return null;
  const x = (ts: number) => `${Math.min(100, Math.max(0, ((ts * 1000 - from) / (to - from)) * 100))}%`;
  return (
    <div className="flex gap-3">
      <div className="flex w-32 shrink-0 flex-col text-xs text-muted sm:w-40">
        {lanes.map(([k, l, c]) => <span key={k} className="flex h-8 items-center gap-1.5 truncate" title={l}><span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${c}`} />{l}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative rounded-lg bg-bg2/50" style={{ height: lanes.length * 32 }}>
          {ticks(from, to).map((t, i) => <span key={t} className="absolute inset-y-0 border-l border-line/50" style={{ left: `${(i / 6) * 100}%` }} />)}
          {lanes.map(([k], i) => <span key={k} className="absolute inset-x-0 border-t border-line/40" style={{ top: i * 32 }} />)}
          {events.map((e, i) => {
            const lane = lanes.findIndex(([k]) => k === groupOf(e.kind));
            if (lane < 0 || e.ts * 1000 < from) return null;
            const d = new Date(e.ts * 1000), day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            return (
              <button key={`${e.ts}-${e.key}-${i}`} type="button" onClick={() => onRange({ from: sec(day0), to: sec(day0 + 86400e3), label: longDay(d) })}
                title={`${dateTime(e.ts * 1000)}:${String(d.getSeconds()).padStart(2, "0")} · ${e.label || "?"}${e.machine ? ` · ${e.machine}` : ""}${e.detail ? `\n${e.detail}` : ""}`}
                className={`absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full opacity-80 ring-1 ring-card hover:z-10 hover:scale-150 hover:opacity-100 ${GROUP_COLOR[GROUPS[lane][0]]}`}
                style={{ left: x(e.ts), top: lane * 32 + 11 }} />
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
  const max = Math.max(1, ...data.map((b) => b.total));
  const span = data[0] ? data[0].end - data[0].start : 0;
  const name = (b: Bucket) => (span >= 86400e3 ? longDay(b.start) : `${dateTime(b.start)} – ${hm(b.end)}`);
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]" role="img" aria-label={tx("Événements par période")}>
        {data.map((b) => {
          const on = active?.from === sec(b.start);
          return (
            <button key={b.start} type="button" onClick={() => b.total && onRange(on ? null : { from: sec(b.start), to: sec(b.end), label: name(b) })}
              title={tx("{0} : {1} événement{2}", name(b), b.total, b.total > 1 ? "s" : "")}
              className={`flex h-full min-w-[3px] flex-1 flex-col-reverse rounded-sm ${b.total ? "cursor-pointer hover:bg-bg2" : "cursor-default"} ${on ? "bg-link/15 ring-1 ring-link" : ""}`}>
              {GROUPS.filter(([k]) => b.parts[k]).map(([k, , c]) => <span key={k} className={`block w-full ${c}`} style={{ height: `${(b.parts[k] / max) * 100}%` }} />)}
            </button>
          );
        })}
      </div>
      {data[0] && <Axis from={data[0].start} to={data.at(-1)!.end} days={days} />}
    </div>
  );
}

/** Courbe empilée par famille (l'épaisseur de chaque couleur = le nombre d'événements du barreau) */
export function AreaChart({ data, days }: { data: Bucket[]; days: number }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data.map((b) => b.total)), W = 1000, H = 160, step = W / (data.length - 1);
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
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={tx("Événements au fil du temps")}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(var(--line))" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {layers.map((l) => <path key={l.k} d={l.path} fill={GROUP_FILL[l.k]} fillOpacity="0.75"><title>{GROUP_NAME[l.k]}</title></path>)}
      </svg>
      <Axis from={data[0].start} to={data.at(-1)!.end} days={days} />
    </div>
  );
}

/** Carte de chaleur : quels jours de la semaine et à quelle heure les événements arrivent */
export function HeatChart({ events }: { events: StoredEvent[] }) {
  const grid = heat(events), max = Math.max(1, ...grid.flat());
  const days = [...Array(7)].map((_, i) => new Date(2026, 9, 12 + i).toLocaleDateString(LOCALE, { weekday: "short" }));  // lundi → dimanche
  return (
    <div className="flex flex-col gap-[3px] text-[11px] text-dim" role="img" aria-label={tx("Événements par jour de la semaine et par heure")}>
      <div className="flex gap-[3px] pl-10">{[...Array(24)].map((_, h) => <span key={h} className="flex-1 text-center">{h % 3 === 0 ? `${h} h` : ""}</span>)}</div>
      {grid.map((row, d) => (
        <div key={d} className="flex items-center gap-[3px]">
          <span className="w-10 shrink-0 capitalize">{days[d]}</span>
          {row.map((n, h) => (
            <span key={h} title={tx("{0} {1} h : {2} événement{3}", days[d], h, n, n > 1 ? "s" : "")}
              className="h-6 flex-1 rounded-sm bg-link" style={{ opacity: n ? 0.15 + 0.85 * (n / max) : 0.05 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
