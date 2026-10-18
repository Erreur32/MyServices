// Home page, the attention card's lines sorted into their category (machines, services, health, DNS, backups, connectors): a header per category with its
// red and orange counts, folded by a click on it (kept in this browser), the red lines first inside each.
import { ChevronDown, ChevronRight, Globe, HardDrive, HeartPulse, Monitor, Network, Plug, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { tx } from "../lib/i18n";
import type { Attention, AttentionGroup, Category, TabId } from "../lib/summary";
import { Rich } from "./Rich";
import { Count } from "./ui";

const KIND: Record<Category, { label: string; icon: LucideIcon }> = {
  machines: { label: tx("Machines"), icon: Monitor }, services: { label: tx("Services"), icon: Globe }, sante: { label: tx("Santé"), icon: HeartPulse },
  dns: { label: tx("DNS"), icon: Network }, sauvegardes: { label: tx("Sauvegardes"), icon: HardDrive }, connecteurs: { label: tx("Connecteurs"), icon: Plug },
};
const CLOSED_KEY = "ms.home.attention.closed";

const savedClosed = (): Category[] => { try { const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

function Line({ it, go }: Readonly<{ it: Attention; go: (t: TabId) => void }>) {
  return (
    <li>
      <button type="button" onClick={() => (it.href ? void (location.hash = it.href) : go(it.tab))}
        className="group flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-bg2">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${it.level === "crit" ? "bg-bad" : "bg-warn"}`} />
        <span className="flex-1"><Rich text={it.text} /></span>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-link" aria-hidden />
      </button>
    </li>
  );
}

export function AttentionGroups({ groups, go }: Readonly<{ groups: (AttentionGroup & { shown: Attention[] })[]; go: (t: TabId) => void }>) {
  const [closed, setClosed] = useState<Category[]>(savedClosed);
  const toggle = (c: Category) => {
    const next = closed.includes(c) ? closed.filter((x) => x !== c) : [...closed, c];
    setClosed(next);
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(next)); } catch { /* storage refused: the choice lasts this visit */ }
  };
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const { label, icon: Icon } = KIND[g.category], shut = closed.includes(g.category), Chevron = shut ? ChevronRight : ChevronDown;
        return (
          <section key={g.category} aria-label={label}>
            <div className={`flex items-center gap-2 rounded-lg bg-bg/60 px-3 py-1.5 ${FOLD_HEADER}`} {...foldHeaderProps(() => toggle(g.category))}>
              <Icon size={15} className="text-link" aria-hidden />
              <h3 className="text-sm font-bold">{label}</h3>
              {g.crit > 0 && <Count n={g.crit} tone="bad" />}
              {g.warn > 0 && <Count n={g.warn} tone="warn" />}
              <button type="button" className="ml-auto text-dim hover:text-txt" aria-expanded={!shut} onClick={() => toggle(g.category)} title={shut ? tx("Déplier") : tx("Replier")}>
                <Chevron size={16} aria-hidden />
              </button>
            </div>
            {!shut && <ol className="mt-1 flex flex-col gap-0.5">{g.shown.map((it) => <Line key={`${it.category}/${it.text}`} it={it} go={go} />)}</ol>}
          </section>
        );
      })}
    </div>
  );
}
