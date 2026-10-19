// Home page, « what changed since yesterday »: one line per kind of event of the last 24 hours (worst first), who it concerned and when it last
// happened. The full list and the charts are in the History tab.
import { ArrowRight, CircleCheck, ClipboardClock } from "lucide-react";
import type { Snapshot } from "../api";
import { last24h, sinceText, type Last24hRow } from "../lib/last24h";
import { tx } from "../lib/i18n";
import type { TabId } from "../lib/summary";
import { Rich } from "./Rich";
import { Badge } from "./ui";

const WHO_SHOWN = 4;
const GO = "group/go inline-flex items-center gap-1 rounded-full border border-line bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-link hover:bg-link/10 hover:text-link";

function Row({ row, now }: Readonly<{ row: Last24hRow; now: number }>) {
  const more = row.who.length - WHO_SHOWN;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5">
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm ${row.color}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold text-txt">{row.label}<Badge tone={row.severity >= 2 ? "warn" : "off"}>{row.count}</Badge>
          <span className="ml-auto whitespace-nowrap text-xs font-normal text-dim">{sinceText(row.last, now)}</span></span>
        <span className="flex min-w-0 flex-wrap gap-1.5 text-[13px]">
          {row.who.slice(0, WHO_SHOWN).map((w) => <span key={w} className="max-w-[14rem] truncate rounded-md border border-line bg-bg2/60 px-1.5 py-0.5 text-muted"><Rich text={`**${w}**`} /></span>)}
          {more > 0 && <span className="px-1 py-0.5 text-dim">{tx("+ {0} autre(s)", more)}</span>}
        </span>
      </span>
    </li>
  );
}

export function LastDay({ snap, go, now }: Readonly<{ snap: Snapshot; go: (t: TabId) => void; now: number }>) {
  const day = last24h(snap.events, snap.labels, snap.severity, now);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm">
      <div className="flex items-center gap-3 border-b border-line/60 bg-bg px-5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-link/10 text-link"><ClipboardClock size={18} strokeWidth={1.75} aria-hidden /></span>
        <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate text-base font-bold">{tx("Ce qui a changé depuis hier")}<Badge tone={day.total ? "info" : "ok"}>{day.total}</Badge></h2>
        <button type="button" onClick={() => go("history")} className={GO} aria-label={tx("Ouvrir l'historique")}>{tx("Tout l'historique")}<ArrowRight size={13} className="transition-transform group-hover/go:translate-x-0.5" aria-hidden /></button>
      </div>
      <div className="px-5 py-2">
        {day.total === 0 ? (
          <p className="flex items-center gap-2 py-2 text-[15px] text-ok"><CircleCheck size={18} aria-hidden />{tx("Rien n'a changé : rien n'est tombé, rien n'est apparu.")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/50 text-sm">{day.rows.map((r) => <Row key={r.kind} row={r} now={now} />)}</ul>
        )}
      </div>
    </section>
  );
}
