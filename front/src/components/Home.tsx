// Accueil : à gauche, ce qui demande l'attention puis un paragraphe par onglet ; à droite, les compteurs
// (dessous sur mobile). Chaque ligne ouvre son onglet.
import { ChevronRight } from "lucide-react";
import type { Snapshot } from "../api";
import { paragraphs, type Attention, type TabId } from "../lib/summary";
import { FirstSteps } from "./FirstSteps";
import { Rich } from "./Rich";
import { StatsColumn } from "./StatsColumn";
import { TABS } from "../lib/tabs";
import { tx } from "../lib/i18n";

const MAX = 8;

/** Même icône que l'onglet (lucide, monochrome) */
function TabIcon({ tab }: { tab: TabId }) {
  const Icon = TABS.find((t) => t.id === tab)!.icon;
  return <Icon size={18} strokeWidth={1.75} aria-hidden />;
}

export function Home({ snap, items, go, now }: { snap: Snapshot; items: Attention[]; go: (t: TabId) => void; now: number }) {
  const crit = items.filter((i) => i.level === "crit").length;
  return (
    <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <FirstSteps snap={snap} />
        <section className={`rounded-2xl border bg-card p-5 ${items.length ? (crit ? "border-bad/50" : "border-warn/50") : "border-ok/40"}`}>
          {items.length === 0 ? (
            <h2 className="text-lg font-bold text-ok">{tx("✅ Rien à signaler")}</h2>
          ) : (
            <>
              <h2 className="text-lg font-bold">
                {items.length} {tx("point")}{items.length > 1 ? "s" : ""} {tx("demande")}{items.length > 1 ? tx("nt") : ""} {tx("ton attention")}
              </h2>
              <ol className="mt-3 flex flex-col gap-1">
                {items.slice(0, MAX).map((it, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => go(it.tab)}
                      className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-bg2">
                      <span aria-hidden className="mt-0.5">{it.level === "crit" ? "🔴" : "🟠"}</span>
                      <span className="flex-1"><Rich text={it.text} /></span>
                      <ChevronRight size={16} className="mt-0.5 shrink-0 text-dim group-hover:text-link" />
                    </button>
                  </li>
                ))}
              </ol>
              {items.length > MAX && <p className="mt-2 px-2 text-sm text-dim">{tx("… et")} {items.length - MAX} {tx("autres, dans leurs onglets.")}</p>}
            </>
          )}
        </section>

        {paragraphs({ ...snap, now }).map((p) => (
          <section key={p.tab} className="rounded-2xl border border-line bg-card/70 p-5">
            <button type="button" onClick={() => go(p.tab)}
              className="group mb-2 flex items-center gap-2 text-base font-bold hover:text-link">
              <TabIcon tab={p.tab} />{p.title}
              <ChevronRight size={16} className="text-dim group-hover:text-link" />
            </button>
            <ul className="flex flex-col gap-1.5 text-[15px] leading-relaxed text-muted">
              {p.sentences.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-dim" />
                  <span className="min-w-0 flex-1"><Rich text={s} /></span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <StatsColumn snap={snap} go={go} />
    </div>
  );
}
