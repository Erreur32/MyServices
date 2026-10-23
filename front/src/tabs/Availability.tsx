// Historique → Disponibilité : taux de disponibilité de chaque service, machine et sonde Uptime Kuma, relevé à chaque collecte
// (availability.py, SQLite). Une case par heure (24 h) ou par jour ; le pire en premier. Les certificats sont dans l'onglet Sécurité.
import { StatTile } from "../components/StatTile";
import { Activity, Globe, Monitor } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { read, type Snapshot } from "../api";
import { useFilter, type Facet } from "../lib/filter";
import { dateTime, hm, longDay } from "../lib/format";
import { LANG, tx } from "../lib/i18n";
import { Dim, Empty, FilterBar } from "../components/ui";
import { InfoNote } from "../components/InfoNote";
import type { ReactNode } from "react";

export interface Cell { t: number; pct: number | null }
export interface Item { key: string; kind: "service" | "machine" | "kuma"; label: string | null; machine: string | null; target: string | null;
  uptime: number; samples: number; down: number; ms: number | null; last: { ts: number; up: boolean } | null; cells: Cell[] }
export interface Report { days: number; step: "hour" | "day"; items: Item[] }

const PERIODS: [number, string][] = [[1, tx("24 h")], [7, tx("7 jours")], [30, tx("30 jours")], [90, tx("90 jours")]];
const KIND: Record<Item["kind"], [string, typeof Globe]> = { service: [tx("Service"), Globe], machine: [tx("Machine"), Monitor], kuma: ["Uptime Kuma", Activity] };
const DAYS_KEY = "ms.availability.days";

export const cellColor = (p: number | null) => (p == null ? "bg-bg2" : p >= 100 ? "bg-ok" : p >= 95 ? "bg-ok/60" : p >= 80 ? "bg-warn" : "bg-bad");
export const pctTone = (p: number) => (p >= 99.9 ? "text-ok" : p >= 95 ? "text-warn" : "text-bad");
export const pct = (p: number) => `${p >= 99.995 ? "100" : p.toFixed(p >= 99 ? 2 : 1).replace(".", LANG === "fr" ? "," : ".")} %`;

function Strip({ cells, step }: { cells: Cell[]; step: Report["step"] }) {
  return (
    <span className="flex h-5 min-w-[9rem] flex-1 items-stretch gap-px" aria-hidden>
      {cells.map((c) => (
        <span key={c.t} className={`flex-1 rounded-[2px] ${cellColor(c.pct)}`}
          title={`${step === "hour" ? hm(c.t * 1000) : longDay(new Date(c.t * 1000))} : ${c.pct == null ? tx("pas de relevé") : pct(c.pct)}`} />
      ))}
    </span>
  );
}

/** Colour of an availability in a figure */
export const tileTone = (p: number): "ok" | "warn" | "bad" => {
  if (p >= 99.9) return "ok";
  return p >= 95 ? "warn" : "bad";
};

export function Availability({ snap }: Readonly<{ snap: Snapshot }>) {
  const [days, setDays] = useState(() => { try { const v = Number(localStorage.getItem(DAYS_KEY)); return PERIODS.some(([d]) => d === v) ? v : 7; } catch { return 7; } });
  const [rep, setRep] = useState<Report | null>(null), [error, setError] = useState("");
  useEffect(() => { read<Report>(`availability?days=${days}`).then((r) => { setRep(r); setError(""); }).catch((e) => setError(String(e.message || e))); }, [days, snap.data.generated]);
  const pick = (d: number) => { setDays(d); try { localStorage.setItem(DAYS_KEY, String(d)); } catch { /* stockage refusé */ } };
  const items = useMemo(() => (rep && rep.days === days ? rep.items : []), [rep, days]);
  const facets = useMemo((): Facet<Item>[] => [
    { key: "kind", label: tx("Type"), get: (x) => x.kind, name: (v) => KIND[v as Item["kind"]][0], order: ["service", "machine", "kuma"] },
    { key: "state", label: tx("Disponibilité"), get: (x) => (x.uptime >= 99.9 ? "ok" : x.uptime >= 95 ? "warn" : "bad"),
      name: (v) => ({ ok: tx("≥ 99,9 %"), warn: tx("95 à 99,9 %"), bad: tx("< 95 %") } as Record<string, string>)[v], order: ["bad", "warn", "ok"] },
    { key: "machine", label: tx("Machine"), get: (x) => x.machine || "" },
  ], []);
  const text = useCallback((x: Item) => [x.label, x.machine, x.target].join(" "), []);
  const f = useFilter(items, facets, text);
  const avg = (k: Item["kind"]) => {
    const l = items.filter((x) => x.kind === k), n = l.reduce((s, x) => s + x.samples, 0);
    return n ? (100 * l.reduce((s, x) => s + x.samples - x.down, 0)) / n : null;
  };
  // what replaces the list while there is nothing to list (null: show it)
  let notice: ReactNode = null;
  if (error && !rep) notice = <Empty>{tx("Disponibilité illisible :")} {error}</Empty>;
  else if (!rep) notice = <p className="py-8 text-muted">{tx("Chargement…")}</p>;
  else if (!items.length) notice = <Empty>{tx("Pas encore de relevé : la disponibilité se remplit à chaque collecte (toutes les 15 minutes par défaut).")}</Empty>;

  const downNow = items.filter((x) => x.last && !x.last.up).length, under = items.filter((x) => x.uptime < 95).length;
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3 flex gap-2.5 overflow-x-auto pb-1">
          {(["service", "machine", "kuma"] as const).map((k) => { const a = avg(k); return a == null ? null : <StatTile key={k} n={pct(a)} label={KIND[k][0]} tone={tileTone(a)} sub={tx("moyenne sur la période")} />; })}
          <StatTile n={downNow} label={tx("En panne maintenant")} tone={downNow ? "bad" : "ok"} />
          <StatTile n={under} label={tx("Sous 95 %")} tone={under ? "warn" : "ok"} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map(([d, l]) => (
          <button key={d} type="button" onClick={() => pick(d)}
            className={`rounded-full border px-3 py-1 text-sm ${days === d ? "border-link bg-link/15 text-txt" : "border-line bg-card text-muted hover:text-txt"}`}>{l}</button>
        ))}
      </div>
      {notice ?? (rep && <>
          <FilterBar f={f} placeholder={tx("Service, machine, adresse…")} />
          {f.shown.length === 0 ? <Empty>{tx("Rien pour ce filtre.")}</Empty> : (
            <ul className="overflow-hidden rounded-2xl border border-line bg-card">
              {f.shown.map((x) => {
                const [kl, Icon] = KIND[x.kind];
                return (
                  <li key={x.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line/60 px-4 py-2 last:border-0">
                    <span className="flex w-64 min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${x.last ? (x.last.up ? "bg-ok" : "bg-bad") : "bg-dim"}`}
                        title={x.last ? tx("dernier relevé {0} : {1}", dateTime(x.last.ts * 1000), x.last.up ? tx("répond") : tx("ne répond pas")) : ""} />
                      <Icon size={14} className="shrink-0 text-dim" aria-label={kl} />
                      <span className="min-w-0"><b className="block truncate">{x.label || x.key}</b><Dim>{[x.machine, x.target].filter(Boolean).join(" · ")}</Dim></span>
                    </span>
                    <span className={`w-20 text-right font-mono text-sm font-bold tabular-nums ${pctTone(x.uptime)}`}>{pct(x.uptime)}</span>
                    <span className="w-24 text-xs text-dim tabular-nums">{x.ms != null ? tx("{0} ms en moyenne", x.ms) : ""}{x.down > 0 && <span className="block text-bad">{tx("{0} relevé(s) en panne", x.down)}</span>}</span>
                    <Strip cells={x.cells} step={rep.step} />
                  </li>
                );
              })}
            </ul>
          )}
          <InfoNote className="mt-2">{tx("Relevé à chaque collecte (toutes les 15 minutes par défaut) : une coupure plus courte peut passer inaperçue. Uptime Kuma garde le détail à la minute.")}</InfoNote>
        </>)}
    </div>
  );
}
