// Historique : graphe en barres par jour (une couleur par famille d'événement ; clic = filtrer la liste sur ce
// jour), puis la liste. Source : historique SQLite d'un an (API v1).
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadHistory, type Snapshot } from "../api";
import { useFilter, type Facet } from "../lib/filter";
import { dayKey, hm, longDay } from "../lib/format";
import type { StoredEvent } from "../types";
import { Empty, FilterBar } from "../components/ui";
import { LOCALE, tx } from "../lib/i18n";

// Familles d'événements (même regroupement que la page actuelle) et leur couleur dans le graphe
const GROUP: Record<string, string> = {
  panne: "services", retabli: "retours", unhealthy: "services", connecteur: "services", connecteur_ok: "retours",
  hors_ligne: "machines", en_ligne: "retours", ssh_down: "machines", ssh_ok: "retours",
  nouveau: "inventaire", disparu: "inventaire", securite: "securite", ui_hors: "securite", dns: "securite", perime: "veille",
  health_ok: "retours", health_warn: "sante", health_crit: "sante", health_down: "sante",
};
const GROUPS: [string, string, string][] = [
  ["services", tx("Pannes de services"), "bg-bad"], ["machines", tx("Machines / SSH"), "bg-warn"], ["sante", tx("Santé des machines"), "bg-apache"],
  ["securite", tx("Sécurité / DNS"), "bg-npm"], ["inventaire", tx("Nouveaux / disparus"), "bg-loc"], ["retours", tx("Retours à la normale"), "bg-ok"],
  ["veille", "Veille", "bg-dim"],
];
const GROUP_NAME = Object.fromEntries(GROUPS.map(([k, l]) => [k, l]));
const GROUP_COLOR = Object.fromEntries(GROUPS.map(([k, , c]) => [k, c]));
const PERIODS: [number, string][] = [[7, tx("7 jours")], [30, tx("30 jours")], [90, tx("90 jours")], [365, tx("1 an")]];

const groupOf = (kind: string) => GROUP[kind] || "veille";

/** Barres empilées par jour, jours sans événement compris. */
function bars(perDay: { day: string; kind: string; n: number }[], days: number, now = Date.now()) {
  const out: { day: string; total: number; parts: Record<string, number> }[] = [];
  for (let i = days - 1; i >= 0; i--) out.push({ day: dayKey(now - i * 86400e3), total: 0, parts: {} });
  const at = new Map(out.map((b) => [b.day, b]));
  for (const r of perDay) {
    const b = at.get(r.day);
    if (!b) continue;
    const g = groupOf(r.kind);
    b.parts[g] = (b.parts[g] || 0) + r.n;
    b.total += r.n;
  }
  return out;
}

function Chart({ data, day, onDay }: { data: ReturnType<typeof bars>; day: string; onDay: (d: string) => void }) {
  const max = Math.max(1, ...data.map((b) => b.total));
  const total = data.reduce((n, b) => n + b.total, 0);
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{total} {tx("événement")}{total > 1 ? "s" : ""} {tx("sur la période")}</h2>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {GROUPS.map(([k, l, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${c}`} />{l}</span>)}
        </div>
      </div>
      <div className="flex h-40 items-end gap-[2px]" role="img" aria-label={tx("Événements par jour")}>
        {data.map((b) => (
          <button key={b.day} type="button" onClick={() => b.total && onDay(b.day === day ? "" : b.day)}
            title={tx("{0} : {1} événement{2}", longDay(new Date(b.day + "T12:00")), b.total, b.total > 1 ? "s" : "")}
            className={`flex h-full min-w-[3px] flex-1 flex-col-reverse rounded-sm ${b.total ? "cursor-pointer hover:bg-bg2" : "cursor-default"} ${day === b.day ? "bg-link/15 ring-1 ring-link" : ""}`}>
            {GROUPS.filter(([k]) => b.parts[k]).map(([k, , c]) => (
              <span key={k} className={`block w-full ${c}`} style={{ height: `${(b.parts[k] / max) * 100}%` }} />
            ))}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-dim">
        <span>{new Date(data[0].day + "T12:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" })}</span>
        <span>{tx("aujourd'hui")}</span>
      </div>
    </div>
  );
}

export function History({ snap }: { snap: Snapshot }) {
  const [days, setDays] = useState(30);
  const [day, setDay] = useState("");
  const [hist, setHist] = useState<Awaited<ReturnType<typeof loadHistory>> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setHist(null);
    loadHistory(days).then(setHist).catch((e) => setError(String(e.message || e)));
  }, [days]);

  const label = useCallback((k: string) => (snap.labels[k] || k), [snap.labels]);
  const events = useMemo(() => (hist?.events || []).filter((e) => !day || dayKey(e.ts * 1000) === day), [hist, day]);
  const facets = useMemo((): Facet<StoredEvent>[] => [
    { key: "group", label: tx("Type"), get: (e) => groupOf(e.kind), name: (v) => GROUP_NAME[v] || v, order: GROUPS.map(([k]) => k) },
    { key: "machine", label: tx("Machine"), get: (e) => e.machine || "" },
  ], []);
  const text = useCallback((e: StoredEvent) => [e.label, e.machine, e.target, e.detail, label(e.kind)].join(" "), [label]);
  const f = useFilter(events, facets, text);

  if (error) return <Empty>{tx("Historique illisible :")} {error}</Empty>;
  if (!hist) return <p className="py-8 text-muted">{tx("Chargement de l'historique…")}</p>;

  const byDay: [string, StoredEvent[]][] = [];
  for (const e of f.shown) {
    const k = dayKey(e.ts * 1000);
    if (byDay.at(-1)?.[0] !== k) byDay.push([k, []]);
    byDay.at(-1)![1].push(e);
  }

  return (
    <div className="py-4">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map(([d, l]) => (
          <button key={d} type="button" onClick={() => { setDays(d); setDay(""); }}
            className={`rounded-full border px-3 py-1 text-sm ${days === d ? "border-link bg-link/15 text-txt" : "border-line bg-card text-muted hover:text-txt"}`}>{l}</button>
        ))}
        {day && (
          <button type="button" onClick={() => setDay("")} className="ml-2 text-sm text-link hover:underline">
            {tx("Jour :")} {longDay(new Date(day + "T12:00"))} ✕
          </button>
        )}
      </div>
      <Chart data={bars(hist.perDay, days)} day={day} onDay={setDay} />
      <FilterBar f={f} placeholder={tx("Service, machine, détail…")} />
      {f.shown.length === 0 ? (
        <Empty>{hist.events.length ? tx("Aucun événement pour ce filtre.") : tx("Aucun événement sur cette période : rien n'est tombé, rien n'a changé.")}</Empty>
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
                  return (
                    <li key={`${e.ts}-${e.key}-${i}`} className="flex gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                      <span className="w-12 shrink-0 font-mono text-xs text-dim">{hm(e.ts * 1000)}</span>
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${GROUP_COLOR[groupOf(e.kind)]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">
                          <span className={sev >= 3 ? "font-semibold text-bad" : sev === 2 ? "font-semibold text-warn" : "text-muted"}>{label(e.kind)}</span>
                          {" · "}<b className="font-semibold">{e.label || "?"}</b>
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
