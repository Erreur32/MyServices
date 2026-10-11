// Accueil : à gauche, ce qui demande l'attention puis un paragraphe par onglet ; à droite, les compteurs (StatsColumn, dessous sur mobile).
// Les compteurs ne sont qu'à droite. Chaque carte et chaque lien ouvre son onglet.
import { ArrowRight, ChevronRight } from "lucide-react";
import type { Snapshot } from "../api";
import { paragraphs, type Attention, type TabId } from "../lib/summary";
import { FirstSteps } from "./FirstSteps";
import { DiscoveryReminder } from "./DiscoveryCard";
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

/** Lien-bouton discret : texte + flèche qui avance au survol (ouvre l'onglet) */
const GO = "group/go inline-flex items-center gap-1 rounded-full border border-line bg-bg2/60 px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-link hover:bg-link/10 hover:text-link";

export function Home({ snap, items, go, now }: { snap: Snapshot; items: Attention[]; go: (t: TabId) => void; now: number }) {
  const crit = items.filter((i) => i.level === "crit").length;
  const tone = items.length ? (crit ? "bad" : "warn") : "ok";
  const frame = { bad: "border-bad/50", warn: "border-warn/50", ok: "border-ok/40" }[tone];
  const strip = { bad: "bg-bad/10", warn: "bg-warn/10", ok: "bg-ok/10" }[tone];
  return (
    <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <FirstSteps snap={snap} />
        {snap.me.role === "admin" && <DiscoveryReminder machines={snap.data.machine_list} />}
        <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`}>
          <div className={`flex items-center gap-3 px-5 py-3.5 ${strip}`}>
            {items.length > 0
              ? <span className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-2 text-sm font-bold leading-none text-bg ${crit ? "bg-bad" : "bg-warn"}`}>{items.length}</span>
              : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ok" aria-hidden />}
            {items.length === 0 ? (
              <h2 className="text-lg font-bold text-ok">{tx("✅ Rien à signaler")}</h2>
            ) : (
              <h2 className="text-lg font-bold">
                {items.length} {tx("point")}{items.length > 1 ? "s" : ""} {tx("demande")}{items.length > 1 ? tx("nt") : ""} {tx("ton attention")}
              </h2>
            )}
          </div>
          {items.length > 0 && (
            <div className="px-3 py-2.5">
              <ol className="flex flex-col gap-0.5">
                {items.slice(0, MAX).map((it, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => (it.href ? void (location.hash = it.href) : go(it.tab))}
                      className="group flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-bg2">
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${it.level === "crit" ? "bg-bad" : "bg-warn"}`} />
                      <span className="flex-1"><Rich text={it.text} /></span>
                      <ChevronRight size={16} className="mt-0.5 shrink-0 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-link" />
                    </button>
                  </li>
                ))}
              </ol>
              {items.length > MAX && <p className="mt-1 px-3 pb-1 text-sm text-dim">{tx("… et")} {items.length - MAX} {tx("autres, dans leurs onglets.")}</p>}
            </div>
          )}
        </section>

        {paragraphs({ ...snap, now }).map((p) => (
          <section key={p.tab} className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm transition-colors hover:border-line/80">
            <div className="flex items-center gap-3 border-b border-line/60 bg-bg2/40 px-5 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-link/10 text-link"><TabIcon tab={p.tab} /></span>
              <h2 className="min-w-0 flex-1 truncate text-base font-bold">{p.title}</h2>
              <button type="button" onClick={() => go(p.tab)} className={GO} aria-label={`${tx("Ouvrir")} ${p.title}`}>
                {tx("Ouvrir")}<ArrowRight size={13} className="transition-transform group-hover/go:translate-x-0.5" aria-hidden />
              </button>
            </div>
            <ul className="flex flex-col gap-2 px-5 py-4 text-[15px] leading-relaxed text-muted">
              {p.sentences.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-link/60" />
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
