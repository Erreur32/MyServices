// Éléments communs des onglets : barre de recherche et pastilles, en-têtes triables, badges d'état.
import { ChevronDown, ChevronUp, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Chip, Facet } from "../lib/filter";

import { LEVEL, type Tone } from "../lib/level";
import { tx } from "../lib/i18n";

export type { Tone };

const TONE: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
  off: "border-line bg-bg2 text-muted",
  info: "border-link/40 bg-link/10 text-link",
};

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  );
}


export function Level({ level, children }: { level: string; children?: ReactNode }) {
  const [tone, label] = LEVEL[level] || ["off", level];
  return <Badge tone={tone}>{children ?? label}</Badge>;
}

export function Dim({ children }: { children: ReactNode }) {
  return <span className="text-dim">{children}</span>;
}

/** Titre de carte (h2) : plus grand, barre d'accent à gauche, icône à la couleur du lien ; une couleur de texte déjà posée (text-ok…) est gardée */
const TITLE = "[&_h2]:border-l-2 [&_h2]:border-link [&_h2]:pl-2.5 [&_h2]:text-[1.0625rem] [&_h2]:font-extrabold [&_h2]:leading-snug [&_h2]:tracking-tight [&_h2_svg]:text-link";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-4 ${TITLE} ${className}`}>{children}</section>;
}

/** Barre d'un onglet : recherche, compteur, pastilles de filtre. */
/** Réglage d'affichage rangé avec les filtres (ex. « Désactivées ») : une pastille qui s'allume et s'éteint, comptée dans le bouton « Filtres » */
export interface FilterOption { id: string; label: string; on: boolean; toggle: () => void; mark?: ReactNode; count?: number }

export function FilterBar<T>({ f, placeholder, extra, options = [] }: {
  f: { query: string; setQuery: (q: string) => void; shown: unknown[]; total: number; active: number; reset: () => void;
       chips: { facet: Facet<T>; chips: Chip[] }[]; toggle: (k: string, v: string) => void };
  placeholder: string; extra?: ReactNode; options?: FilterOption[];
}) {
  // Filtres repliés d'office (sur tous les écrans) : la barre de recherche suffit le plus souvent ; ce qui est actif
  // reste visible en pastilles retirables, et le bouton « Filtres » déplie le reste.
  const [open, setOpen] = useState(false);
  const groups = f.chips.filter((g) => g.chips.length > 1 || g.chips.some((c) => c.on));
  const active = f.chips.flatMap((g) => g.chips.filter((c) => c.on).map((c) => ({ facet: g.facet, chip: c })));
  const nActive = active.length + options.filter((o) => o.on).length;
  // Les filtres déjà actifs un jour sur cette page restent affichés en pastilles, même retirés : un clic les désactive, un autre clic les réactive
  const keyOf = (facet: Facet<T>, chip: Chip) => `${facet.key}\u0000${chip.value}`;
  const [seen, setSeen] = useState<string[]>([]);
  const fresh = active.map((a) => keyOf(a.facet, a.chip)).filter((k) => !seen.includes(k));
  if (fresh.length) setSeen([...seen, ...fresh]);   // mise à jour pendant le rendu : autorisée pour un état de ce composant
  const toggles = seen.flatMap((k) => f.chips.flatMap((g) => g.chips.filter((c) => keyOf(g.facet, c) === k).map((c) => ({ facet: g.facet, chip: c }))));
  return (
    <div className="my-4 flex flex-col gap-3 rounded-2xl border border-line bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-bg2 px-3 py-2 focus-within:border-link">
          <Search size={16} className="text-dim" />
          <input value={f.query} onChange={(e) => f.setQuery(e.target.value)} placeholder={placeholder} type="search"
            className="w-full bg-transparent text-sm text-txt outline-none placeholder:text-dim" />
        </label>
        <span className="text-sm text-muted"><b className="text-txt">{f.shown.length}</b> / {f.total}</span>
        {f.active > 0 && (
          <button type="button" onClick={f.reset} className="inline-flex items-center gap-1 text-sm text-link hover:underline">
            <X size={14} />{tx("Tout effacer")}
          </button>
        )}
        {extra}
        {(groups.length > 0 || options.length > 0) && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold text-link transition-colors hover:bg-link/10 ${open || nActive ? "border-link bg-link/10" : "border-link/50"}`}>
            <SlidersHorizontal size={14} />{tx("Filtres")}{nActive > 0 && <b className="grid h-5 min-w-5 place-items-center rounded-full bg-link px-1 text-[11px] leading-none text-white">{nActive}</b>}
            {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
        )}
      </div>
      {!open && (toggles.length > 0 || options.some((o) => o.on)) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {options.filter((o) => o.on).map((o) => (
            <button key={o.id} type="button" onClick={o.toggle} aria-pressed title={tx("Désactiver ce filtre")}
              className="inline-flex items-center gap-1 rounded-full border border-link bg-link/15 px-2.5 py-1 text-xs font-medium text-txt hover:bg-link/25">
              <span className="text-dim">{tx("Affichage")} :</span>{o.mark}{o.label}<X size={11} aria-hidden />
            </button>
          ))}
          {toggles.map(({ facet, chip }) => (
            <button key={`${facet.key}/${chip.value}`} type="button" onClick={() => f.toggle(facet.key, chip.value)} aria-pressed={chip.on}
              title={chip.on ? tx("Désactiver ce filtre") : tx("Réactiver ce filtre")}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${chip.on
                ? "border-link bg-link/15 text-txt hover:bg-link/25" : "border-line bg-bg2 text-dim line-through decoration-dim/60 hover:border-link hover:text-txt hover:no-underline"}`}>
              <span className="text-dim">{facet.label} :</span>{facet.mark?.(chip.value)}{chip.label}{chip.on ? <X size={11} aria-hidden /> : <Plus size={11} aria-hidden />}
            </button>
          ))}
        </div>
      )}
      {open && (
        // Une colonne par catégorie de filtre, de largeur fixe : toutes les pastilles sont visibles (rien n'est replié derrière un « +N »)
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {options.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-line/60 bg-bg2/40 p-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-dim">{tx("Affichage")}</span>
              <div className="flex flex-wrap gap-1.5">
                {options.map((o) => (
                  <button key={o.id} type="button" onClick={o.toggle} aria-pressed={o.on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${o.on ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link hover:text-txt"}`}>
                    {o.mark}{o.label}{o.count != null && <span className="font-mono text-[11px] text-dim">{o.count}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.map(({ facet, chips }) => (
            <div key={facet.key} className="flex flex-col gap-1.5 rounded-xl border border-line/60 bg-bg2/40 p-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-dim">{facet.label}</span>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <button key={c.value} type="button" onClick={() => f.toggle(facet.key, c.value)} aria-pressed={c.on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${c.on
                      ? "border-link bg-link/15 text-txt" : c.count ? "border-line bg-bg2 text-muted hover:border-link hover:text-txt" : "border-line bg-bg2 text-dim opacity-60"}`}>
                    {facet.mark?.(c.value)}{c.label}<span className="font-mono text-[11px] text-dim">{c.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** En-tête de colonne triable */
export function Th({ k, sort, children, className = "" }: {
  k?: string; sort?: { key: string; asc: boolean; by: (k: string) => void }; children?: ReactNode; className?: string;
}) {
  const on = k && sort?.key === k;
  return (
    <th className={`sticky top-0 z-10 whitespace-nowrap border-b border-line bg-bg2 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-dim ${className}`}>
      {k && sort ? (
        <button type="button" onClick={() => sort.by(k)} className={`inline-flex items-center gap-1 uppercase hover:text-txt ${on ? "text-txt" : ""}`}>
          {children}{on && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
      ) : children}
    </th>
  );
}

export function Table({ head, children, fit = false }: { head: ReactNode; children: ReactNode; fit?: boolean }) {  // fit : jamais de défilement horizontal (les colonnes se serrent)
  return (
    <div className={`hidden rounded-2xl border border-line bg-card md:block ${fit ? "overflow-hidden" : "overflow-x-auto"}`}>
      <table className="w-full border-collapse text-sm">
        <thead><tr>{head}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60">{children}</tbody>
      </table>
    </div>
  );
}

/** Version mobile d'un tableau : une fiche par ligne */
export function Cards({ children, always = false }: { children: ReactNode; always?: boolean }) {  // always : aussi sur grand écran (choix « Cartes »)
  return <div className={always ? "grid gap-2.5 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2.5 md:hidden"}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-muted">{children}</p>;
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}

/** Barre de remplissage (disque) */
export function Fill({ pct, tone }: { pct: number; tone: Tone }) {
  const color = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-ok";
  return (
    <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full border border-line bg-bg2 align-middle">
      <span className={`block h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}
