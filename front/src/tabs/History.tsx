// Historique : un graphique au choix (points à l'heure exacte, barres, courbe, chaleur) au-dessus de la liste des événements. Un clic sur
// un point ou une barre limite la liste à ce jour ou à cette plage. Source : historique SQLite d'un an (API v1).
import { Activity, BarChart3, Flame, LineChart, ListOrdered, ScatterChart } from "lucide-react";
import { Availability } from "./Availability";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadHistory, type Snapshot } from "../api";
import { useFilter, type Facet } from "../lib/filter";
import { dayKey, hm, longDay, splitHostName } from "../lib/format";
import { localVia, originOf } from "../lib/eventOrigin";
import type { StoredEvent } from "../types";
import { AreaChart, BarsChart, HeatChart, PointsChart, heatDays, type HeatCell, type Range } from "../components/HistoryCharts";
import { Badge, Count, Empty, FilterBar } from "../components/ui";
import { Square } from "../components/marks";
import { tx } from "../lib/i18n";
import { NOISE, collapse, saveHidden, savedHidden, unmasked, type NoiseId } from "../lib/historyNoise";
import { EVENT_LIMIT, GROUPS, GROUP_COLOR, GROUP_NAME, STYLES, buckets, dayBuckets, groupOf, stepFor, type ChartStyle } from "../lib/historyChart";

/** Severity of an event kind (0 to 3) as the filter groups it */
function severityGroup(n: number): string {
  if (n >= 3) return "bad";
  return n === 2 ? "warn" : "info";
}
const SEVERITY_NAME: Record<string, string> = { bad: tx("grave"), warn: tx("avertissement"), info: tx("information") };
const SEVERITY_CLS: Record<string, string> = { bad: "bg-bad", warn: "bg-warn", info: "bg-dim" };
const severityMark = (v: string) => <Square cls={SEVERITY_CLS[v] ?? "bg-dim"} />;

const PERIODS: [number, string][] = [[1, tx("24 h")], [7, tx("7 jours")], [30, tx("30 jours")], [90, tx("90 jours")], [365, tx("1 an")]];
const STYLE_ICON: Record<ChartStyle, typeof BarChart3> = { points: ScatterChart, bars: BarChart3, area: LineChart, heat: Flame };
const STYLE_KEY = "ms.history.style";

const DAYS_KEY = "ms.history.days";

// Par défaut : les dernières 24 h, en barres ; le dernier choix de la personne est gardé
const savedStyle = (): ChartStyle => {
  try { const v = localStorage.getItem(STYLE_KEY); return STYLES.some(([k]) => k === v) ? (v as ChartStyle) : "bars"; } catch { return "bars"; }
};
const savedDays = (): number => {
  try { const v = Number(localStorage.getItem(DAYS_KEY)); return PERIODS.some(([d]) => d === v) ? v : 1; } catch { return 1; }
};

type Loaded = Awaited<ReturnType<typeof loadHistory>> & { days: number; at: number };

const VIEW_KEY = "ms.history.view";

/** Historique : les événements, ou la disponibilité dans le temps (choix gardé) */
export function History({ snap }: { snap: Snapshot }) {
  const [view, setView] = useState<"events" | "availability">(() => { try { return localStorage.getItem(VIEW_KEY) === "availability" ? "availability" : "events"; } catch { return "events"; } });
  const pickView = (v: typeof view) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* stockage refusé */ } };
  // the switch sits in the middle of the period / chart-style row of the events view, and in a row of its own above the availability
  const switcher = (
    <fieldset className="m-0 inline-flex rounded-lg border border-line bg-card p-0.5" aria-label={tx("Vue de l'historique")}>
      {([["events", tx("Événements"), ListOrdered], ["availability", tx("Disponibilité"), Activity]] as const).map(([k, l, Icon]) => (
        <button key={k} type="button" onClick={() => pickView(k)} aria-pressed={view === k}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${view === k ? "bg-link/15 font-semibold text-txt" : "text-muted hover:text-txt"}`}><Icon size={14} aria-hidden />{l}</button>
      ))}
    </fieldset>
  );
  return view === "events" ? <Events snap={snap} middle={switcher} /> : <Availability snap={snap} middle={switcher} />;
}

/** Period chips, the view switch in the middle, the chart style on the right */
function Toolbar({ days, onDays, style, onStyle, middle }: Readonly<{ days: number; onDays: (d: number) => void; style: ChartStyle; onStyle: (k: ChartStyle) => void; middle: ReactNode }>) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {PERIODS.map(([d, l]) => (
        <button key={d} type="button" onClick={() => onDays(d)}
          className={`rounded-full border px-3 py-1 text-sm ${days === d ? "border-link bg-link/15 text-txt" : "border-line bg-card text-muted hover:text-txt"}`}>{l}</button>
      ))}
      <span className="mx-auto">{middle}</span>
      <span className="inline-flex rounded-lg border border-line bg-card p-0.5" role="group" aria-label={tx("Style du graphique")}>
        {STYLES.map(([k, l]) => {
          const Icon = STYLE_ICON[k];
          return (
            <button key={k} type="button" onClick={() => onStyle(k)} aria-pressed={style === k} title={l}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${style === k ? "bg-link/15 text-txt" : "text-muted hover:text-txt"}`}><Icon size={14} aria-hidden />{l}</button>
          );
        })}
      </span>
    </div>
  );
}

/** The chart of the chosen style, or the empty note */
function Chart({ style, events, bars, from, to, days, range, setRange, cell, setCell }: Readonly<{
  style: ChartStyle; events: StoredEvent[]; bars: ReturnType<typeof buckets>; from: number; to: number; days: number; range: Range | null; setRange: (r: Range | null) => void; cell: HeatCell | null; setCell: (c: HeatCell | null) => void;
}>) {
  if (events.length === 0) return <p className="flex h-[180px] items-center justify-center text-sm text-muted">{tx("Aucun événement sur cette période.")}</p>;
  if (style === "points") return <PointsChart events={events} from={from} to={to} days={days} onRange={setRange} />;
  if (style === "bars") return <BarsChart data={bars} days={days} active={range} onRange={setRange} />;
  if (style === "area") return <AreaChart data={bars} days={days} />;
  return <HeatChart events={events} active={cell} onPick={setCell} />;
}

/** The events grouped by day, in the order given */
function groupByDay(listed: StoredEvent[]): [string, StoredEvent[]][] {
  const byDay: [string, StoredEvent[]][] = [];
  for (const e of listed) {
    const k = dayKey(e.ts * 1000);
    if (byDay.at(-1)?.[0] !== k) byDay.push([k, []]);
    byDay.at(-1)![1].push(e);
  }
  return byDay;
}

function Events({ snap, middle }: Readonly<{ snap: Snapshot; middle: ReactNode }>) {
  const [days, setDays] = useState(savedDays);
  const [style, setStyle] = useState<ChartStyle>(savedStyle);
  const [range, setRange] = useState<Range | null>(null);
  const [cell, setCell] = useState<HeatCell | null>(null);   // heat map: one weekday and hour
  const [hist, setHist] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  // Relu à chaque passage de la collecte (sans effacer le graphique pendant la lecture)
  useEffect(() => {
    loadHistory(days).then((h) => { setHist({ ...h, days, at: Date.now() }); setError(""); }).catch((e) => setError(String(e.message || e)));
  }, [days, snap.data.generated]);
  const pickDays = (d: number) => { setDays(d); try { localStorage.setItem(DAYS_KEY, String(d)); } catch { /* idem */ } };
  const pick = (k: ChartStyle) => { setStyle(k); try { localStorage.setItem(STYLE_KEY, k); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };

  const label = useCallback((k: string) => (snap.labels[k] || k), [snap.labels]);
  const ready = hist && hist.days === days ? hist : null;
  // Noise hidden by default (fail2ban threats, connectors back within an hour, devices found by the scan): display only, one click shows them
  const [hidden, setHidden] = useState<NoiseId[]>(savedHidden);
  const setHide = (v: NoiseId[]) => { setHidden(v); saveHidden(v); };
  const masked = useMemo(() => unmasked(ready?.events ?? [], hidden), [ready, hidden]);
  const all = masked.shown;
  const nHidden = hidden.reduce((n, k) => n + masked.counts[k], 0);
  const facets = useMemo((): Facet<StoredEvent>[] => [
    { key: "group", label: tx("Type"), get: (e) => groupOf(e.kind), name: (v) => GROUP_NAME[v] || v, order: GROUPS.map(([k]) => k), mark: (v) => <Square cls={GROUP_COLOR[v] ?? "bg-dim"} /> },
    { key: "kind", label: tx("Événement"), get: (e) => e.kind, name: (v) => label(v), mark: (v) => <Square cls={GROUP_COLOR[groupOf(v)] ?? "bg-dim"} /> },
    { key: "method", label: tx("Méthode"), get: (e) => originOf(e).method },
    { key: "via", label: tx("Lu par"), get: (e) => originOf(e).via },
    { key: "machine", label: tx("Machine"), get: (e) => e.machine || "" },
    { key: "service", label: tx("Service"), get: (e) => e.label || "" },
    { key: "severity", label: tx("Gravité"), get: (e) => severityGroup(snap.severity[e.kind] || 0), name: (v) => SEVERITY_NAME[v] || v, order: ["bad", "warn", "info"], mark: severityMark },
  ], [label, snap.severity]);
  const text = useCallback((e: StoredEvent) => [e.label, e.machine, e.target, e.detail, label(e.kind)].join(" "), [label]);
  const f = useFilter(all, facets, text);  // les graphiques suivent la recherche et les pastilles
  const listed = useMemo(() => {
    const inRange = range ? f.shown.filter((e) => e.ts >= range.from && e.ts < range.to) : f.shown;
    return cell ? inRange.filter((e) => { const d = new Date(e.ts * 1000); return (d.getDay() + 6) % 7 === cell.d && d.getHours() === cell.h; }) : inRange;
  }, [f.shown, range, cell]);

  if (error && !ready) return <Empty>{tx("Historique illisible :")} {error}</Empty>;
  if (!ready) return <p className="py-8 text-muted">{tx("Chargement de l'historique…")}</p>;

  const to = ready.at, from = to - days * 86400e3, truncated = ready.events.length >= EVENT_LIMIT;
  const counts = Object.fromEntries(GROUPS.map(([k]) => [k, f.shown.filter((e) => groupOf(e.kind) === k).length]));
  const busiest = (f.chips.find((g) => g.facet.key === "service")?.chips ?? []).filter((c) => c.count > 1).slice(0, 6);   // services with the most events
  const bars = truncated && !f.active ? dayBuckets(ready.perDay, days, to) : buckets(f.shown, from, to, stepFor(days));

  const sources = new Map((snap.health?.hosts ?? []).map((h) => [splitHostName(h.name)[1], h.sources ?? []]));  // IP -> sources de la santé
  // Services locaux d'aujourd'hui : ce qui les lit (Docker, ports par SSH ou par l'agent) ; une ligne disparue n'y est plus
  const localRows = new Map(snap.data.hosts.filter((r) => r.type === "local").map((r) => [`local:${r.id}`, r]));
  const agentIps = new Set(snap.data.machine_list.filter((m) => m.agent).map((m) => m.ip));
  const viaOf = (e: StoredEvent) => {
    if (!e.key.startsWith("local:")) return undefined;
    const r = localRows.get(e.key);
    return r ? localVia(r.service?.kind, agentIps.has(r.host_ip || r.ip || "")) : undefined;
  };
  const byDay = groupByDay(listed);

  return (
    <div>
      <Toolbar days={days} onDays={(d) => { pickDays(d); setRange(null); setCell(null); }} style={style} onStyle={pick} middle={middle} />

      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold"><Count n={f.shown.length} />{tx("événement")}{f.shown.length > 1 ? "s" : ""} {tx("sur la période")}</h2>
          {/* the points chart has its own legend on its left, with the counts */}
          {style !== "points" && (
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              {GROUPS.filter(([k]) => counts[k]).map(([k, l, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${c}`} />{l} <b className="text-dim">{counts[k]}</b></span>)}
            </div>
          )}
        </div>
        <Chart style={style} events={f.shown} bars={bars} from={from} to={to} days={days} range={range} setRange={setRange} cell={cell} setCell={setCell} />
        {busiest.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/60 pt-3 text-xs">
            <span className="text-dim">{tx("Les plus actifs :")}</span>
            {busiest.map((c) => (
              <button key={c.value} type="button" onClick={() => f.toggle("service", c.value)} aria-pressed={c.on} title={tx("Filtrer sur ce service")}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${c.on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
                <span className="max-w-[16rem] truncate">{c.label}</span><span className="font-mono text-[11px] text-dim">{c.count}</span></button>
            ))}
          </div>
        )}
        {truncated && style !== "bars" && <p className="mt-2 text-xs text-warn">{tx("Les {0} événements les plus récents seulement : choisissez une période plus courte pour tout voir.", EVENT_LIMIT)}</p>}
      </div>

      <FilterBar f={f} placeholder={tx("Service, machine, détail…")}
        optionsLabel={tx("Masquer")}
        options={NOISE.map(([k, l]) => ({ id: k, label: l, on: hidden.includes(k), count: masked.counts[k],
          toggle: () => setHide(hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]) }))}
        extra={<>
          {range && <button type="button" onClick={() => setRange(null)} className="rounded-lg border border-link px-2.5 py-1.5 text-sm text-txt">{range.label} ✕</button>}
          {cell && <button type="button" onClick={() => setCell(null)} className="rounded-lg border border-link px-2.5 py-1.5 text-sm capitalize text-txt">{heatDays()[cell.d]} {cell.h} h ✕</button>}
          {nHidden > 0 && <button type="button" onClick={() => setHide([])} className="text-sm text-link hover:underline" title={tx("Les menaces fail2ban, les connecteurs revenus vite et les appareils de la recherche réseau sont masqués")}>
            {tx("{0} masqué(s) : tout afficher", nHidden)}</button>}
        </>} />
      {listed.length === 0 ? (
        <Empty>{ready.events.length ? tx("Aucun événement pour ce filtre.") : tx("Aucun événement sur cette période : rien n'est tombé, rien n'a changé.")}</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {byDay.map(([k, evs]) => (
            <section key={k}>
              <h3 className="mb-1.5 text-sm font-bold capitalize text-muted">
                {longDay(new Date(k + "T12:00"))} <span className="font-normal text-dim">· {evs.length} {tx("événement")}{evs.length > 1 ? "s" : ""}</span>
              </h3>
              <ol className="overflow-hidden rounded-2xl border border-line bg-card">
                {collapse(evs).map((it, i) => "events" in it ? (
                  <li key={`g-${it.ts}-${i}`} className="border-b border-line/60 last:border-0">
                    <details className="group">
                      <summary className="flex cursor-pointer gap-3 px-4 py-2.5 hover:bg-bg2/50">
                        <span className="w-12 shrink-0 font-mono text-xs text-dim">{hm(it.ts * 1000)}</span>
                        <span className="flex w-52 shrink-0 flex-wrap content-start items-start gap-1"><Badge tone={(snap.severity[it.kind] || 0) >= 2 ? "warn" : it.kind === "connecteur_ok" ? "ok" : "off"}>{label(it.kind)}</Badge><Badge tone="off">×{it.events.length}</Badge></span>
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${GROUP_COLOR[groupOf(it.kind)]}`} />
                        <span className="min-w-0 flex-1 text-sm"><b className="font-semibold">{it.title}</b><span className="block truncate text-xs text-dim">{it.detail} · {tx("cliquer pour le détail")}</span></span>
                      </summary>
                      <ul className="border-t border-line/40 bg-bg2/30 px-4 py-1.5 text-xs">
                        {it.events.map((e, j) => <li key={`${e.ts}-${j}`} className="flex gap-3 py-0.5"><span className="w-12 shrink-0 font-mono text-dim">{hm(e.ts * 1000)}</span><span className="text-txt">{e.label || "?"}</span><span className="truncate text-dim">{[e.target, e.detail].filter(Boolean).join(" · ")}</span></li>)}
                      </ul>
                    </details>
                  </li>
                ) : (() => {
                  const e = it.one;
                  const sev = snap.severity[e.kind] || 0;
                  const o = originOf(e, e.kind.startsWith("health_") ? sources.get(e.target ?? "") : undefined, viaOf(e));
                  return (
                    <li key={`${e.ts}-${e.key}-${i}`} className="flex gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                      <span className="w-12 shrink-0 font-mono text-xs text-dim">{hm(e.ts * 1000)}</span>
                      <span className="flex w-52 shrink-0 flex-wrap content-start items-start gap-1" aria-label={tx("Type et méthode")}>
                        <Badge tone={sev >= 3 ? "bad" : sev === 2 ? "warn" : groupOf(e.kind) === "retours" ? "ok" : "off"} title={tx("Type d'événement")}>{label(e.kind)}</Badge>
                        <Badge tone="info" title={tx("Méthode de détection")}>{o.method}</Badge>
                      </span>
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${GROUP_COLOR[groupOf(e.kind)]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <b className="font-semibold">{e.label || "?"}</b>
                          {o.via.map((v) => <Badge key={v} tone="off" title={tx("Lu par")}>{v}</Badge>)}
                        </div>
                        <div className="truncate text-xs text-dim" title={[e.machine, e.target, e.detail].filter(Boolean).join(" · ")}>
                          {[e.machine, e.target, e.detail].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </li>
                  );
                })())}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
