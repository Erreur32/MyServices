// Éléments communs des onglets : barre de recherche et pastilles, en-têtes triables, badges d'état.
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from "lucide-react";
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

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-4 ${className}`}>{children}</section>;
}

/** Barre d'un onglet : recherche, compteur, pastilles de filtre. */
export function FilterBar<T>({ f, placeholder, extra }: {
  f: { query: string; setQuery: (q: string) => void; shown: unknown[]; total: number; active: number; reset: () => void;
       chips: { facet: Facet<T>; chips: Chip[] }[]; toggle: (k: string, v: string) => void };
  placeholder: string; extra?: ReactNode;
}) {
  // Filtres repliés d'office (sur tous les écrans) : la barre de recherche suffit le plus souvent ; ce qui est actif
  // reste visible en pastilles retirables, et le bouton « Filtres » déplie le reste.
  const [open, setOpen] = useState(false), [more, setMore] = useState<Record<string, boolean>>({});
  const groups = f.chips.filter((g) => g.chips.length > 1 || g.chips.some((c) => c.on));
  const active = f.chips.flatMap((g) => g.chips.filter((c) => c.on).map((c) => ({ facet: g.facet, chip: c })));
  const LIMIT = 12;
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
        {groups.length > 0 && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${active.length ? "border-link text-txt" : "border-line text-muted hover:text-txt"}`}>
            <SlidersHorizontal size={14} />{tx("Filtres")}{active.length > 0 && <b className="text-link">{active.length}</b>}
            {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
        )}
        {extra}
      </div>
      {!open && active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.map(({ facet, chip }) => (
            <button key={`${facet.key}/${chip.value}`} type="button" onClick={() => f.toggle(facet.key, chip.value)} title={tx("Retirer ce filtre")}
              className="inline-flex items-center gap-1 rounded-full border border-link bg-link/15 px-2.5 py-1 text-xs font-medium text-txt hover:bg-link/25">
              <span className="text-dim">{facet.label} :</span>{facet.mark?.(chip.value)}{chip.label}<X size={11} aria-hidden />
            </button>
          ))}
        </div>
      )}
      {open && groups.map(({ facet, chips }) => {
        const all = more[facet.key] || chips.length <= LIMIT, list = all ? chips : chips.filter((c, i) => i < LIMIT || c.on);
        return (
          <div key={facet.key} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-dim">{facet.label}</span>
            {list.map((c) => (
              <button key={c.value} type="button" onClick={() => f.toggle(facet.key, c.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${c.on
                  ? "border-link bg-link/15 text-txt" : c.count ? "border-line bg-bg2 text-muted hover:border-link hover:text-txt" : "border-line bg-bg2 text-dim opacity-60"}`}>
                {facet.mark?.(c.value)}{c.label}<span className="font-mono text-[11px] text-dim">{c.count}</span>
              </button>
            ))}
            {!all && <button type="button" onClick={() => setMore({ ...more, [facet.key]: true })} className="text-xs text-link hover:underline">+{chips.length - list.length} {tx("autres")}</button>}
          </div>
        );
      })}
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
