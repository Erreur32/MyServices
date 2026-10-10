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
  // Pastilles dépliées d'office sur grand écran, repliées sur mobile (elles prendraient tout l'écran)
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const groups = f.chips.filter((g) => g.chips.length > 1 || g.chips.some((c) => c.on));
  const on = f.chips.reduce((n, g) => n + g.chips.filter((c) => c.on).length, 0);
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
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${on ? "border-link text-txt" : "border-line text-muted hover:text-txt"}`}>
            <SlidersHorizontal size={14} />{tx("Filtres")}{on > 0 && <b className="text-link">{on}</b>}
          </button>
        )}
        {extra}
      </div>
      {open && groups.map(({ facet, chips }) => (
        <div key={facet.key} className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-dim">{facet.label}</span>
          {chips.map((c) => (
            <button key={c.value} type="button" onClick={() => f.toggle(facet.key, c.value)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${c.on
                ? "border-link bg-link/15 text-txt" : c.count ? "border-line bg-bg2 text-muted hover:border-link hover:text-txt" : "border-line bg-bg2 text-dim opacity-60"}`}>
              {c.label}<span className="ml-1.5 font-mono text-[11px] text-dim">{c.count}</span>
            </button>
          ))}
        </div>
      ))}
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

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-line bg-card md:block">
      <table className="w-full border-collapse text-sm">
        <thead><tr>{head}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60">{children}</tbody>
      </table>
    </div>
  );
}

/** Version mobile d'un tableau : une fiche par ligne */
export function Cards({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5 md:hidden">{children}</div>;
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
