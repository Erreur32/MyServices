// Home page, three fixed blocks: « À traiter maintenant » (every alert with a button to the place that fixes it), « Ce qui a changé depuis
// hier » (events of the last 24 h) and, for an administrator, « Il manque » (sources that would unlock a page). The inventory counters live in
// their tabs; the header line only says how many things are followed.
import { ChevronDown, ChevronUp, CircleCheck, Siren } from "lucide-react";
import { useState } from "react";
import type { Snapshot } from "../api";
import { hm, longDay } from "../lib/format";
import type { Selected } from "../lib/filter";
import { tx } from "../lib/i18n";
import type { Attention, Category, TabId } from "../lib/summary";
import { History } from "../tabs/History";
import { AssistantBanner } from "./AssistantBanner";
import { DiscoveryReminder } from "./DiscoveryCard";
import { LastDay } from "./LastDay";
import { Missing } from "./Missing";
import { Rich } from "./Rich";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { useStoredFlag } from "../lib/storedFlag";
import { StatsPage } from "./StatsPage";

/** Lines shown before « Tout voir » */
const LIMIT = 8;
const KIND: Record<Category, string> = {
  machines: tx("Machines"), services: tx("Services"), sante: tx("Santé"), dns: tx("DNS"), sauvegardes: tx("Sauvegardes"), connecteurs: tx("Connecteurs"),
};
const ACT = "inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors";

/** A line leads to the exact address it names, else to its tab filtered on what it talks about, else to the tab */
export function openAttention(it: Attention, go: (t: TabId) => void, goFilter: (t: TabId, sel: Selected) => void): void {
  if (it.href) location.hash = it.href;
  else if (it.sel) goFilter(it.tab, it.sel);
  else go(it.tab);
}

/** « 12 machines, 41 services, 6 jeux de sauvegarde suivis » */
export function followedLine(snap: Snapshot): string {
  const parts = [tx("{0} machine(s)", snap.data.machine_list.filter((m) => !m.disabled).length), tx("{0} service(s)", snap.data.hosts.filter((r) => r.enabled).length)];
  if (snap.backups) parts.push(tx("{0} jeu(x) de sauvegarde", snap.backups.summary.sets));
  return tx("{0} suivis", parts.join(", "));
}

function Line({ it, go, goFilter }: Readonly<{ it: Attention; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }>) {
  const crit = it.level === "crit";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-bg/60 px-3 py-2.5">
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${crit ? "bg-bad" : "bg-warn"}`} />
      <span className="min-w-0 flex-1 text-sm text-muted"><Rich text={it.text} /></span>
      <span className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim sm:inline">{KIND[it.category]}</span>
      <button type="button" onClick={() => openAttention(it, go, goFilter)}
        className={`${ACT} ${crit ? "bg-link text-bg hover:brightness-110" : "border border-line bg-bg2 text-txt hover:border-link hover:text-link"}`}>{it.action}</button>
    </li>
  );
}

export type HomeSub = "overview" | "history" | "stats";

const FRAME = { bad: "border-l-4 border-l-bad border-bad/40", warn: "border-l-4 border-l-warn border-warn/40", ok: "border-ok/40" };

/** « À traiter maintenant »: every alert with a button to the place that fixes it; folds to its title and count, the choice kept in this browser */
function ToDeal({ items, go, goFilter }: Readonly<{ items: Attention[]; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }>) {
  const [all, setAll] = useState(false);
  const [folded, setFolded] = useStoredFlag("myservices.home.todo.folded", false);
  const shown = all ? items : items.slice(0, LIMIT);
  const crit = items.some((i) => i.level === "crit");
  let tone: keyof typeof FRAME = "ok";
  if (items.length) tone = crit ? "bad" : "warn";
  const frame = FRAME[tone];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`} aria-label={tx("À traiter maintenant")}>
      <div className={`flex items-center gap-3 px-5 py-3.5 ${items.length ? FOLD_HEADER : ""}`} {...(items.length ? foldHeaderProps(() => setFolded(!folded)) : {})}>
        {items.length > 0
          ? <span className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-2 text-sm font-bold leading-none text-bg ${crit ? "bg-bad" : "bg-warn"}`}>{items.length}</span>
          : <CircleCheck size={22} className="shrink-0 text-ok" aria-hidden />}
        <h2 className={`text-lg font-bold ${items.length ? "" : "text-ok"}`}>{items.length ? tx("À traiter maintenant") : tx("Rien à traiter")}</h2>
        {items.length > 0 && <Siren size={18} className="ml-auto shrink-0 text-dim" aria-hidden />}
        {items.length > 0 && (
          <button type="button" className="text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!folded)} title={folded ? tx("Déplier") : tx("Replier")}>
            {folded ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
          </button>
        )}
      </div>
      {items.length > 0 && !folded && (
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          <ol className="flex flex-col gap-1">{shown.map((it) => <Line key={`${it.category}/${it.text}`} it={it} go={go} goFilter={goFilter} />)}</ol>
          {items.length > LIMIT && (
            <button type="button" onClick={() => setAll(!all)} aria-expanded={all}
              className="mx-auto mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-bg2 px-3 py-1 text-xs font-semibold text-muted hover:border-link hover:text-link">
              {all ? tx("Réduire") : tx("Tout voir ({0})", items.length)}{all ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function Home({ snap, items, go, goFilter, now, sub = "overview" }: Readonly<{ snap: Snapshot; items: Attention[]; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void; now: number; sub?: HomeSub }>) {
  const admin = snap.me.role === "admin";
  const day = longDay(now);
  if (sub === "history") return <div className="flex flex-col gap-5 py-5"><History snap={snap} /></div>;
  if (sub === "stats") return <div className="flex flex-col gap-5 py-5"><StatsPage snap={snap} go={go} goFilter={goFilter} /></div>;
  return (
    <div className="flex flex-col gap-5 py-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold">{day.charAt(0).toUpperCase() + day.slice(1)}, {hm(now)}</h1>
        <span className="text-sm text-muted">{followedLine(snap)}</span>
      </div>
      {admin && <AssistantBanner snap={snap} />}

      <ToDeal items={items} go={go} goFilter={goFilter} />

      <div className="grid gap-5 lg:grid-cols-2">
        <LastDay snap={snap} go={go} now={now} />
        {admin && <Missing snap={snap} />}
      </div>
      {admin && <DiscoveryReminder machines={snap.data.machine_list} />}
    </div>
  );
}
