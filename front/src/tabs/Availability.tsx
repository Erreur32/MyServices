// Historique → Disponibilité : taux de disponibilité de chaque service, machine et sonde Uptime Kuma, relevé à chaque collecte
// (availability.py, SQLite). Une case par quart d'heure (24 h) ou par jour ; le pire en premier. Les certificats sont dans l'onglet Sécurité.
import { StatTile } from "../components/StatTile";
import { Activity, Boxes, Globe, Monitor } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { read, type Snapshot } from "../api";
import { rootDomain, rowKind, type RowKind } from "../lib/availability";
import { useFilter, type Chip, type Facet, type Selected } from "../lib/filter";
import { input } from "../lib/forms";
import { dateTime, hm, longDay } from "../lib/format";
import { LANG, tx } from "../lib/i18n";
import { ChipButton, Empty } from "../components/ui";
import { Dot } from "../components/marks";
import { InfoNote } from "../components/InfoNote";
import { PageHead } from "../components/PageHead";
import type { ReactNode } from "react";

export interface Cell { t: number; pct: number | null }
export interface Item { key: string; kind: "service" | "machine" | "kuma"; label: string | null; machine: string | null; target: string | null;
  uptime: number; samples: number; down: number; ms: number | null; last: { ts: number; up: boolean } | null; cells: Cell[] }
export interface Report { days: number; step: "hour" | "day"; items: Item[] }

const PERIODS: [number, string][] = [[1, tx("24 h")], [7, tx("7 jours")], [30, tx("30 jours")], [90, tx("90 jours")]];
const KIND: Record<RowKind, [string, typeof Globe, string]> = { machine: [tx("Machine"), Monitor, tx("Machines")], service: [tx("Service"), Boxes, tx("Services")], domain: [tx("Domaine"), Globe, tx("Domaines")], kuma: ["Uptime Kuma", Activity, "Uptime Kuma"] };
const KINDS = Object.keys(KIND) as RowKind[];
const STATES = { bad: tx("En panne maintenant"), warn: tx("Sous 99,9 %"), ok: tx("Sans souci") };
type State = keyof typeof STATES;
const stateOf = (x: Item): State => {
  if (x.last && !x.last.up) return "bad";
  return x.uptime < 99.9 ? "warn" : "ok";
};
const nowColor = (x: Item) => {
  if (!x.last) return "bg-dim";
  return x.last.up ? "bg-ok" : "bg-bad";
};
const lastSeen = (x: Item) => {
  if (!x.last) return "";
  return tx("dernier relevé {0} : {1}", dateTime(x.last.ts * 1000), x.last.up ? tx("répond") : tx("ne répond pas"));
};
const COLUMNS = "grid grid-cols-[minmax(14rem,1.1fr)_5rem_6.5rem_minmax(18rem,1.6fr)] items-center gap-x-3.5 px-4";
const BOX = `${input.replace("w-full", "w-auto")} !py-1 text-sm`;
const CAPTION = "text-[11px] font-bold uppercase tracking-wide text-dim";
const DAYS_KEY = "ms.availability.days", FILTERS_KEY = "ms.availability.filters";
/** The machines first; what the user picks after that is kept in this browser */
const FIRST_FILTERS: Selected = { kind: ["machine"] };
const savedFilters = (): Selected => {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "null");
    return got && typeof got === "object" && Object.values(got).every(Array.isArray) ? got as Selected : FIRST_FILTERS;
  } catch { return FIRST_FILTERS; }
};

export const cellColor = (p: number | null) => (p == null ? "bg-bg2" : p >= 100 ? "bg-ok" : p >= 95 ? "bg-ok/60" : p >= 80 ? "bg-warn" : "bg-bad");
export const pctTone = (p: number) => (p >= 99.9 ? "text-ok" : p >= 95 ? "text-warn" : "text-bad");
export const pct = (p: number) => `${p >= 99.995 ? "100" : p.toFixed(p >= 99 ? 2 : 1).replace(".", LANG === "fr" ? "," : ".")} %`;

function Strip({ cells, step }: Readonly<{ cells: Cell[]; step: Report["step"] }>) {
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
  const items = useMemo(() => (rep?.days === days ? rep.items : []), [rep, days]);
  const facets = useMemo((): Facet<Item>[] => [
    { key: "kind", label: tx("Voir"), get: rowKind, name: (v) => KIND[v as RowKind][2], order: KINDS },
    { key: "state", label: tx("État"), get: stateOf, name: (v) => STATES[v as State], order: Object.keys(STATES) },
    { key: "machine", label: tx("Machine"), get: (x) => x.machine || "" },
    { key: "domain", label: tx("Domaine"), get: (x) => rootDomain(x) },
  ], []);
  const text = useCallback((x: Item) => [x.label, x.machine, x.target].join(" "), []);
  const [firstFilters] = useState(savedFilters);
  const f = useFilter(items, facets, text, firstFilters);
  useEffect(() => { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(f.sel)); } catch { /* stockage refusé */ } }, [f.sel]);
  const avg = (k: RowKind) => {
    const l = items.filter((x) => rowKind(x) === k), n = l.reduce((s, x) => s + x.samples, 0);
    return n ? (100 * l.reduce((s, x) => s + x.samples - x.down, 0)) / n : null;
  };
  // what replaces the list while there is nothing to list (null: show it)
  let notice: ReactNode = null;
  if (error && !rep) notice = <Empty>{tx("Disponibilité illisible :")} {error}</Empty>;
  else if (!rep) notice = <p className="py-8 text-muted">{tx("Chargement…")}</p>;
  else if (!items.length) notice = <Empty>{tx("Pas encore de relevé : la disponibilité se remplit à chaque collecte (toutes les 15 minutes par défaut).")}</Empty>;

  const downNow = items.filter((x) => x.last && !x.last.up).length, under = items.filter((x) => x.uptime < 95).length;
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={Activity} title={tx("Disponibilité")} tags={null} actions={<fieldset className="m-0 inline-flex gap-1.5 border-0 p-0" aria-label={tx("Période")}>
        {PERIODS.map(([d, l]) => <ChipButton key={d} on={days === d} label={l} onClick={() => pick(d)} />)}
      </fieldset>} />
      {items.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {KINDS.map((k) => { const a = avg(k); return a == null ? null : <StatTile key={k} n={pct(a)} label={KIND[k][2]} tone={tileTone(a)} sub={tx("moyenne sur la période")} />; })}
          <StatTile n={downNow} label={tx("En panne maintenant")} tone={downNow ? "bad" : "ok"} />
          <StatTile n={under} label={tx("Sous 95 %")} tone={under ? "warn" : "ok"} />
        </div>
      )}
      {notice ?? (rep && <>
          <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
            <Filters f={f} />
            {f.shown.length === 0 ? <div className="p-4"><Empty>{tx("Rien pour ce filtre.")}</Empty></div> : (
              <div className="overflow-x-auto"><div className="min-w-[48rem]">
                <div className={`${COLUMNS} border-b border-line py-1.5 text-xs text-muted`}><span>{tx("Nom")}</span><span className="text-right">{tx("Dispo.")}</span><span>{tx("Réponse")}</span><span>{rep.step === "hour" ? tx("Par quart d'heure") : tx("Par jour")}</span></div>
                <ul>{f.shown.map((x) => <Row key={x.key} x={x} step={rep.step} />)}</ul>
              </div></div>
            )}
          </section>
          <p className="flex flex-wrap gap-3 text-xs text-muted">
            {([[100, tx("répond")], [85, tx("coupure courte")], [50, tx("en panne")], [null, tx("pas de relevé")]] as const).map(([v, l]) => <span key={l} className="inline-flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-[2px] ${cellColor(v)}`} aria-hidden />{l}</span>)}
          </p>
          <InfoNote>{tx("Les machines et les services dont le port est suivi sont relevés à la minute (le pouls, sans requête de plus) ; le reste à chaque collecte (toutes les 15 minutes par défaut), où une coupure plus courte peut passer inaperçue.")}</InfoNote>
        </>)}
    </div>
  );
}

/** One line: who, its availability, how it answers, a cell per hour or day that lines up from row to row */
function Row({ x, step }: Readonly<{ x: Item; step: Report["step"] }>) {
  const [kind, Icon] = KIND[rowKind(x)];
  return (
    <li className={`${COLUMNS} border-b border-line/60 py-2 last:border-0 even:bg-bg/30`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${nowColor(x)}`} title={lastSeen(x)} />
        <span className="min-w-0 flex-1"><b className="block truncate">{x.label || x.key}</b><span className="block truncate text-xs text-dim">{[x.machine, x.target].filter(Boolean).join(" · ")}</span></span>
        <span title={kind} className="shrink-0 text-dim"><Icon size={14} aria-label={kind} /></span>
      </span>
      <span className={`text-right font-mono text-sm font-bold tabular-nums ${pctTone(x.uptime)}`}>{pct(x.uptime)}</span>
      <span className="text-xs text-dim tabular-nums">{x.ms != null && `${x.ms} ms`}{x.down > 0 && <span className="block text-bad">{tx("{0} relevé(s) en panne", x.down)}</span>}</span>
      <Strip cells={x.cells} step={step} />
    </li>
  );
}

/** The filters that matter, always in sight: what to see and the search, then the machine, the domain and the state */
function Filters({ f }: Readonly<{ f: ReturnType<typeof useFilter<Item>> }>) {
  const chips = (key: string): Chip[] => f.chips.find((g) => g.facet.key === key)?.chips ?? [];
  const one = (key: string, value: string) => f.setSel((s) => {
    const next = { ...s };
    if (value) {
      next[key] = [value];
    } else {
      delete next[key];
    }
    return next;
  });
  const choice = (key: string, label: string, all: string) => (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">{label}
      <select className={BOX} value={f.sel[key]?.[0] ?? ""} onChange={(e) => one(key, e.target.value)}>
        <option value="">{all}</option>
        {[...chips(key)].sort((a, b) => a.label.localeCompare(b.label)).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex flex-col gap-2.5 border-b border-line bg-bg px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={CAPTION}>{tx("Voir")}</span>
        {chips("kind").map((c) => <ChipButton key={c.value} on={c.on} count={c.count} label={c.label} onClick={() => f.toggle("kind", c.value)} />)}
        <input type="search" aria-label={tx("Rechercher")} className={`${input} min-w-[12rem] flex-1 !py-1 text-sm`} value={f.query} onChange={(e) => f.setQuery(e.target.value)} placeholder={tx("Nom, machine, adresse…")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {choice("machine", tx("Machine"), tx("Toutes"))}
        {choice("domain", tx("Domaine"), tx("Tous"))}
        <span className={`${CAPTION} sm:ml-1.5`}>{tx("État")}</span>
        {chips("state").map((c) => <ChipButton key={c.value} on={c.on} count={c.count} mark={<Dot tone={c.value as State} />} label={c.label} onClick={() => f.toggle("state", c.value)} />)}
        <span className="ml-auto text-xs text-muted">{tx("{0} sur {1}", f.shown.length, f.total)}</span>
        {f.active > 0 && <button type="button" className="text-xs text-link hover:underline" onClick={f.reset}>{tx("Tout effacer")}</button>}
      </div>
    </div>
  );
}
