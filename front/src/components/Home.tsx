// Accueil : à gauche, ce qui demande l'attention puis les dernières 24 h ; à droite, les compteurs (StatsColumn, dessous sur mobile).
// Les compteurs ne sont qu'à droite. Chaque carte et chaque lien ouvre son onglet.
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Snapshot } from "../api";
import { groupAttention, limitGroups, type Attention, type TabId } from "../lib/summary";
import { AssistantBanner } from "./AssistantBanner";
import { AttentionGroups } from "./AttentionGroups";
import { DiscoveryReminder } from "./DiscoveryCard";
import { LastDay } from "./LastDay";
import { NewServices } from "./NewServices";
import { StatsColumn } from "./StatsColumn";
import { tx } from "../lib/i18n";
import type { Selected } from "../lib/filter";

/** Lignes affichées dans la carte d'attention : 12 par défaut, au choix 25, 50 ou toutes (0) ; le choix est retenu par le navigateur */
const SIZES = [12, 25, 50, 0];
const SIZE_KEY = "ms.home.attention.rows";
const FOLD_KEY = "ms.home.attention.folded";
const savedSize = (): number => { try { const v = Number(localStorage.getItem(SIZE_KEY)); return SIZES.includes(v) && localStorage.getItem(SIZE_KEY) !== null ? v : 12; } catch { return 12; } };

export function Home({ snap, items, go, goFilter, now }: { snap: Snapshot; items: Attention[]; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void; now: number }) {
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  const [size, setSize] = useState(savedSize);
  const pickSize = (n: number) => { setSize(n); try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* stockage refusé : le choix ne dure que cette visite */ } };
  const visible = limitGroups(groupAttention(items), size);
  const shownCount = visible.reduce((n, g) => n + g.shown.length, 0);
  const crit = items.filter((i) => i.level === "crit").length;
  const tone = items.length ? (crit ? "bad" : "warn") : "ok";
  const frame = { bad: "border-bad/50", warn: "border-warn/50", ok: "border-ok/40" }[tone];
  const strip = { bad: "bg-bad/10", warn: "bg-warn/10", ok: "bg-ok/10" }[tone];
  return (
    <div className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-5">
        {snap.me.role === "admin" && <AssistantBanner snap={snap} />}
        {snap.me.role === "admin" && <DiscoveryReminder machines={snap.data.machine_list} />}
        {snap.me.role === "admin" && <NewServices generated={snap.data.generated} />}
        <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`}>
          {items.length > 0 ? (
            <button type="button" onClick={() => fold(!folded)} aria-expanded={!folded} title={folded ? tx("Déplier") : tx("Replier")}
              className={`flex w-full items-center gap-3 px-5 py-3.5 text-left ${strip}`}>
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
              <ChevronRight size={18} className={`ml-auto shrink-0 text-txt transition-transform ${folded ? "" : "rotate-90"}`} aria-hidden />
            </button>
          ) : (
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
          )}
          {items.length > 0 && !folded && (
            <div className="px-3 py-2.5">
              <AttentionGroups groups={visible} go={go} />
              {items.length > SIZES[0] && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/60 px-3 pt-2.5 pb-1 text-xs text-dim">
                  <span>{shownCount < items.length ? tx("{0} sur {1} affichés", shownCount, items.length) : tx("Tout est affiché ({0})", items.length)}</span>
                  <span className="ml-auto inline-flex items-center gap-1.5" role="group" aria-label={tx("Lignes à afficher")}>
                    {tx("Lignes")}
                    {SIZES.map((n) => (
                      <button key={n} type="button" aria-pressed={size === n} onClick={() => pickSize(n)}
                        className={`rounded-full border px-2.5 py-0.5 font-medium transition-colors ${size === n ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
                        {n || tx("Toutes")}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        <LastDay snap={snap} go={go} now={now} />
      </div>
      <StatsColumn snap={snap} go={go} goFilter={goFilter} />
    </div>
  );
}
