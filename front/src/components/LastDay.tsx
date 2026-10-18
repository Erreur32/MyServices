// Home page, the last 24 hours: a chart of the events hour by hour, then one row per kind of event with who it concerned and when it last happened.
import { ArrowRight, CircleCheck, Clock } from "lucide-react";
import type { Snapshot } from "../api";
import { last24h, sinceText, type Last24hRow } from "../lib/last24h";
import { tx } from "../lib/i18n";
import type { TabId } from "../lib/summary";
import { Rich } from "./Rich";
import { Badge } from "./ui";

const WHO_SHOWN = 4;
const GO = "group/go inline-flex items-center gap-1 rounded-full border border-line bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-link hover:bg-link/10 hover:text-link";

function Chart({ hours }: Readonly<{ hours: { n: number; color: string }[] }>) {
  const max = Math.max(1, ...hours.map((h) => h.n));
  return (
    <div>
      <div className="flex h-14 items-end gap-0.5" role="img" aria-label={tx("Événements par heure sur les dernières 24 h")}>
        {hours.map((h, i) => (
          <span key={`ago${23 - i}`} title={h.n ? tx("{0} événement(s), il y a {1} h", h.n, 23 - i) : tx("rien, il y a {0} h", 23 - i)}
            className={`flex-1 rounded-sm ${h.n ? h.color : "bg-line/60"}`} style={{ height: h.n ? `${Math.max(14, (h.n / max) * 100)}%` : "6%" }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-dim"><span>{tx("il y a 24 h")}</span><span>{tx("maintenant")}</span></div>
    </div>
  );
}

function Row({ row, now }: Readonly<{ row: Last24hRow; now: number }>) {
  const more = row.who.length - WHO_SHOWN;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 py-2.5 md:grid-cols-[auto_11rem_minmax(0,1fr)_6rem] md:items-center">
      <span aria-hidden className={`mt-1 h-3 w-3 shrink-0 rounded-sm md:mt-0 ${row.color}`} />
      <span className="flex min-w-0 items-center justify-between gap-2 font-semibold text-txt"><span className="truncate">{row.label}</span><Badge tone={row.severity >= 2 ? "warn" : "off"}>{row.count}</Badge></span>
      <span className="col-span-3 col-start-1 row-start-2 flex min-w-0 flex-wrap gap-1.5 text-[13px] md:col-span-1 md:col-start-3 md:row-start-1">
        {row.who.slice(0, WHO_SHOWN).map((w) => <span key={w} className="max-w-[14rem] truncate rounded-md border border-line bg-bg2/60 px-1.5 py-0.5 text-muted"><Rich text={`**${w}**`} /></span>)}
        {more > 0 && <span className="px-1 py-0.5 text-dim">{tx("+ {0} autre(s)", more)}</span>}
      </span>
      <span className="col-start-3 row-start-1 whitespace-nowrap text-right text-xs text-dim md:col-start-4">{sinceText(row.last, now)}</span>
    </li>
  );
}

export function LastDay({ snap, go, now }: Readonly<{ snap: Snapshot; go: (t: TabId) => void; now: number }>) {
  const day = last24h(snap.events, snap.labels, snap.severity, now);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm">
      <div className="flex items-center gap-3 border-b border-line/60 bg-bg px-5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-link/10 text-link"><Clock size={18} strokeWidth={1.75} aria-hidden /></span>
        <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate text-base font-bold">{tx("Dernières 24 h")}<Badge tone={day.total ? "info" : "ok"}>{day.total}</Badge></h2>
        <button type="button" onClick={() => go("history")} className={GO} aria-label={tx("Ouvrir l'historique")}>{tx("Historique")}<ArrowRight size={13} className="transition-transform group-hover/go:translate-x-0.5" aria-hidden /></button>
      </div>
      <div className="px-5 py-4">
        {day.total === 0 ? (
          <p className="flex items-center gap-2 text-[15px] text-ok"><CircleCheck size={18} aria-hidden />{tx("Aucun événement : rien n'est tombé, rien n'a changé.")}</p>
        ) : (
          <>
            <Chart hours={day.hours} />
            <ul className="mt-3 flex flex-col divide-y divide-line/50 text-sm">{day.rows.map((r) => <Row key={r.kind} row={r} now={now} />)}</ul>
          </>
        )}
      </div>
    </section>
  );
}
