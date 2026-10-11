// Historique : un graphique au choix (points à l'heure exacte, barres, courbe, chaleur) au-dessus de la liste des événements. Un clic sur
// un point ou une barre limite la liste à ce jour ou à cette plage. Source : historique SQLite d'un an (API v1).
import { BarChart3, Flame, LineChart, ScatterChart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadHistory, type Snapshot } from "../api";
import { useFilter, type Facet } from "../lib/filter";
import { dayKey, hm, longDay, splitHostName } from "../lib/format";
import { originOf } from "../lib/eventOrigin";
import type { StoredEvent } from "../types";
import { AreaChart, BarsChart, HeatChart, PointsChart, type Range } from "../components/HistoryCharts";
import { Badge, Empty, FilterBar } from "../components/ui";
import { Square } from "../components/marks";
import { tx } from "../lib/i18n";
import { EVENT_LIMIT, GROUPS, GROUP_COLOR, GROUP_NAME, STYLES, buckets, dayBuckets, groupOf, stepFor, type ChartStyle } from "../lib/historyChart";

const PERIODS: [number, string][] = [[1, tx("24 h")], [7, tx("7 jours")], [30, tx("30 jours")], [90, tx("90 jours")], [365, tx("1 an")]];
const STYLE_ICON: Record<ChartStyle, typeof BarChart3> = { points: ScatterChart, bars: BarChart3, area: LineChart, heat: Flame };
const STYLE_KEY = "ms.history.style";

const savedStyle = (): ChartStyle => {
  try { const v = localStorage.getItem(STYLE_KEY); return STYLES.some(([k]) => k === v) ? (v as ChartStyle) : "points"; } catch { return "points"; }
};

type Loaded = Awaited<ReturnType<typeof loadHistory>> & { days: number; at: number };

export function History({ snap }: { snap: Snapshot }) {
  const [days, setDays] = useState(7);
  const [style, setStyle] = useState<ChartStyle>(savedStyle);
  const [range, setRange] = useState<Range | null>(null);
  const [hist, setHist] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  // Relu à chaque passage de la collecte (sans effacer le graphique pendant la lecture)
  useEffect(() => {
    loadHistory(days).then((h) => { setHist({ ...h, days, at: Date.now() }); setError(""); }).catch((e) => setError(String(e.message || e)));
  }, [days, snap.data.generated]);
  const pick = (k: ChartStyle) => { setStyle(k); try { localStorage.setItem(STYLE_KEY, k); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };

  const label = useCallback((k: string) => (snap.labels[k] || k), [snap.labels]);
  const ready = hist && hist.days === days ? hist : null;
  const all = useMemo(() => ready?.events ?? [], [ready]);
  const facets = useMemo((): Facet<StoredEvent>[] => [
    { key: "group", label: tx("Type"), get: (e) => groupOf(e.kind), name: (v) => GROUP_NAME[v] || v, order: GROUPS.map(([k]) => k), mark: (v) => <Square cls={GROUP_COLOR[v] ?? "bg-dim"} /> },
    { key: "method", label: tx("Méthode"), get: (e) => originOf(e).method },
    { key: "via", label: tx("Lu par"), get: (e) => originOf(e).via },
    { key: "machine", label: tx("Machine"), get: (e) => e.machine || "" },
  ], []);
  const text = useCallback((e: StoredEvent) => [e.label, e.machine, e.target, e.detail, label(e.kind)].join(" "), [label]);
  const f = useFilter(all, facets, text);  // les graphiques suivent la recherche et les pastilles
  const listed = useMemo(() => (range ? f.shown.filter((e) => e.ts >= range.from && e.ts < range.to) : f.shown), [f.shown, range]);

  if (error && !ready) return <Empty>{tx("Historique illisible :")} {error}</Empty>;
  if (!ready) return <p className="py-8 text-muted">{tx("Chargement de l'historique…")}</p>;

  const to = ready.at, from = to - days * 86400e3, truncated = ready.events.length >= EVENT_LIMIT;
  const counts = Object.fromEntries(GROUPS.map(([k]) => [k, f.shown.filter((e) => groupOf(e.kind) === k).length]));
  const bars = truncated && !f.active ? dayBuckets(ready.perDay, days, to) : buckets(f.shown, from, to, stepFor(days));

  const sources = new Map((snap.health?.hosts ?? []).map((h) => [splitHostName(h.name)[1], h.sources ?? []]));  // IP -> sources de la santé
  const byDay: [string, StoredEvent[]][] = [];
  for (const e of listed) {
    const k = dayKey(e.ts * 1000);
    if (byDay.at(-1)?.[0] !== k) byDay.push([k, []]);
    byDay.at(-1)![1].push(e);
  }

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map(([d, l]) => (
          <button key={d} type="button" onClick={() => { setDays(d); setRange(null); }}
            className={`rounded-full border px-3 py-1 text-sm ${days === d ? "border-link bg-link/15 text-txt" : "border-line bg-card text-muted hover:text-txt"}`}>{l}</button>
        ))}
        <span className="ml-auto inline-flex rounded-lg border border-line bg-card p-0.5" role="group" aria-label={tx("Style du graphique")}>
          {STYLES.map(([k, l]) => {
            const Icon = STYLE_ICON[k];
            return (
              <button key={k} type="button" onClick={() => pick(k)} aria-pressed={style === k} title={l}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${style === k ? "bg-link/15 text-txt" : "text-muted hover:text-txt"}`}><Icon size={14} aria-hidden />{l}</button>
            );
          })}
        </span>
      </div>

      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">{f.shown.length} {tx("événement")}{f.shown.length > 1 ? "s" : ""} {tx("sur la période")}</h2>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {GROUPS.filter(([k]) => counts[k]).map(([k, l, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${c}`} />{l} <b className="text-dim">{counts[k]}</b></span>)}
          </div>
        </div>
        {f.shown.length === 0 ? <p className="flex h-[180px] items-center justify-center text-sm text-muted">{tx("Aucun événement sur cette période.")}</p>
          : style === "points" ? <PointsChart events={f.shown} from={from} to={to} days={days} onRange={setRange} />
          : style === "bars" ? <BarsChart data={bars} days={days} active={range} onRange={setRange} />
          : style === "area" ? <AreaChart data={bars} days={days} />
          : <HeatChart events={f.shown} />}
        {truncated && style !== "bars" && <p className="mt-2 text-xs text-warn">{tx("Les {0} événements les plus récents seulement : choisissez une période plus courte pour tout voir.", EVENT_LIMIT)}</p>}
      </div>

      <FilterBar f={f} placeholder={tx("Service, machine, détail…")}
        extra={range && <button type="button" onClick={() => setRange(null)} className="rounded-lg border border-link px-2.5 py-1.5 text-sm text-txt">{range.label} ✕</button>} />
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
                {evs.map((e, i) => {
                  const sev = snap.severity[e.kind] || 0;
                  const o = originOf(e, e.kind.startsWith("health_") ? sources.get(e.target ?? "") : undefined);
                  return (
                    <li key={`${e.ts}-${e.key}-${i}`} className="flex gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                      <span className="w-12 shrink-0 font-mono text-xs text-dim">{hm(e.ts * 1000)}</span>
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${GROUP_COLOR[groupOf(e.kind)]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <b className="font-semibold">{e.label || "?"}</b>
                          <Badge tone={sev >= 3 ? "bad" : sev === 2 ? "warn" : groupOf(e.kind) === "retours" ? "ok" : "off"} title={tx("Type d'événement")}>{label(e.kind)}</Badge>
                          <Badge tone="info" title={tx("Méthode de détection")}>{o.method}</Badge>
                          {o.via.map((v) => <Badge key={v} tone="off" title={tx("Lu par")}>{v}</Badge>)}
                        </div>
                        <div className="truncate text-xs text-dim" title={[e.machine, e.target, e.detail].filter(Boolean).join(" · ")}>
                          {[e.machine, e.target, e.detail].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
