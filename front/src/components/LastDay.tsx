// Home page, « what changed since yesterday »: one line per kind of problem of the last 24 hours (worst first; what came back is left out), who it
// concerned and when it last happened. The full list and the charts are in the History tab.
import { ArrowRight, CircleCheck, ClipboardClock } from "lucide-react";
import type { Snapshot } from "../api";
import { serviceIcon } from "../lib/appIcons";
import { imageService, last24h, logoOf, serviceOfRow, sinceText, type Last24hRow } from "../lib/last24h";
import { cardHash } from "../lib/serviceCards";
import { tx } from "../lib/i18n";
import type { TabId } from "../lib/summary";
import type { Host } from "../types";
import { Rich } from "./Rich";
import { Badge } from "./ui";

const WHO_SHOWN = 4;
const GO = "group/go inline-flex items-center gap-1 rounded-full border border-line bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-link hover:bg-link/10 hover:text-link";

/** A name of a row: with the service's logo when one is known, and a link to its card when it is a service */
function Who({ name, row, hosts }: Readonly<{ name: string; row: Last24hRow; hosts: Host[] }>) {
  const host = serviceOfRow(hosts, row, name), image = imageService(row, name);
  const icon = (host && serviceIcon(logoOf(host))) ?? (image && serviceIcon(image));
  const body = <>{icon && <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0" />}<span className="truncate"><Rich text={name} /></span></>;
  const frame = "inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-line/70 bg-bg px-1.5 py-0.5 text-muted";
  return host ? <a href={cardHash(host)} className={`${frame} no-underline hover:border-link hover:text-link`}>{body}</a> : <span className={frame}>{body}</span>;
}

/** One row on a grid shared by every row: colour mark and label in a fixed first column, the names in the middle, the time on the right;
 *  on a narrow screen the names take a line of their own under the label. */
function Row({ row, now, hosts }: Readonly<{ row: Last24hRow; now: number; hosts: Host[] }>) {
  const more = row.who.length - WHO_SHOWN;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[13rem_minmax(0,1fr)_6.5rem]">
      <span className="flex min-w-0 items-center gap-2.5 font-semibold text-txt">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-sm ${row.color}`} />
        <span className="truncate">{row.label}</span>
        <Badge tone={row.severity >= 2 ? "warn" : "off"}>{row.count}</Badge>
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap gap-1.5 pl-5 text-[13px] sm:col-span-1 sm:pl-0">
        {row.who.slice(0, WHO_SHOWN).map((w) => <Who key={w} name={w} row={row} hosts={hosts} />)}
        {more > 0 && <span className="px-1 py-0.5 text-dim">{tx("+ {0} autre(s)", more)}</span>}
      </span>
      <span className="row-start-1 col-start-2 whitespace-nowrap text-right text-xs tabular-nums text-dim sm:col-start-3">{sinceText(row.last, now)}</span>
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
          <p className="flex items-center gap-2 py-2 text-[15px] text-ok"><CircleCheck size={18} aria-hidden />{tx("Aucun souci depuis hier : ce qui est tombé est revenu.")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/50 text-sm">{day.rows.map((r) => <Row key={r.kind} row={r} now={now} hosts={snap.data.hosts} />)}</ul>
        )}
      </div>
    </section>
  );
}
