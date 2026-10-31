// Éléments communs des onglets : barre de recherche et pastilles, en-têtes triables, badges d'état.
import { ChevronDown, ChevronUp, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Chip, Facet } from "../lib/filter";

import { LEVEL, type Tone } from "../lib/level";
import { tx } from "../lib/i18n";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { fieldFrame, fieldText } from "../lib/forms";

export type { Tone };

const TONE: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
  off: "border-line bg-bg2 text-muted",
  info: "border-link/40 bg-link/10 text-link",
};

/** The search field of every list (all the words, in any order, without accents nor case: searchHit), then « N of M » when given */
export function SearchBox({ value, onChange, placeholder, count, className = "" }: Readonly<{ value: string; onChange: (q: string) => void; placeholder: string; count?: [number, number]; className?: string }>) {
  return (
    <>
      <label className={`flex min-w-[220px] max-w-sm flex-1 items-center gap-2 px-3 py-1.5 ${fieldFrame} ${className}`}>
        <Search size={16} className="text-field-txt/75" aria-hidden />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} type="search"
          className={`w-full bg-transparent ${fieldText}`} />
      </label>
      {count && <span className="whitespace-nowrap text-sm text-muted" title={tx("Lignes affichées sur le total, après la recherche et les filtres")}><b className="text-txt">{count[0]}</b> {tx("sur")} {count[1]}</span>}
    </>
  );
}

export function Badge({ tone, children, title, outline = false, plainText = false }: Readonly<{ tone: Tone; children: ReactNode; title?: string; outline?: boolean; plainText?: boolean }>) {   // outline: the border and the text colour only, no filled background ; plainText: the text in the normal colour (white on dark), the state is carried by the border
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-semibold ${(outline ? TONE[tone].replace(/bg-\S+/, "bg-transparent") : TONE[tone]).replace(plainText ? /text-\S+/ : /$^/, "text-txt")}`}>
      {children}
    </span>
  );
}


export function Level({ level, children, outline, plainText }: Readonly<{ level: string; children?: ReactNode; outline?: boolean; plainText?: boolean }>) {   // outline: border and text colour only; always so for « to watch »
  const [tone, label] = LEVEL[level] || ["off", level];
  return <Badge tone={tone} outline={outline ?? level === "warn"} plainText={plainText ?? level === "warn"}>{children ?? label}</Badge>;
}

export type CardTone = "bad" | "warn" | "info" | "ok";
const FRAME: Record<CardTone, string> = { bad: "border-bad/50", warn: "border-warn/50", info: "border-line", ok: "border-ok/40" };
// the header strip of every card is the darkest tone of the theme; the state is carried by the frame and the count bubble
const DARK_STRIP = "border-b border-line/60 bg-bg";
const STRIP: Record<CardTone, string> = { bad: DARK_STRIP, warn: DARK_STRIP, info: DARK_STRIP, ok: DARK_STRIP };
const BUBBLE: Record<CardTone, "bad" | "warn" | "off" | "ok"> = { bad: "bad", warn: "warn", info: "off", ok: "ok" };

/** Card with a coloured header strip (title, count in a round bubble) over a table with fixed columns and headers. Nothing is shown without a row,
 *  unless `empty` (the "all good" message) is given. `footer` goes under the table. */
export function TableCard({ title, tone, count, cols, rows, sort, note, empty, footer, className = "", zebra = false, foldable = false, folded = false }: Readonly<{
  title: ReactNode; tone: CardTone; count?: number; cols: { label: string; className?: string; k?: string }[]; rows: ReactNode[][]; sort?: ColumnSort; note?: ReactNode; empty?: ReactNode; footer?: ReactNode; className?: string; zebra?: boolean; foldable?: boolean; folded?: boolean;   // zebra: every other row darker; foldable: the header strip folds the frame, `folded` is its starting state
}>) {
  const [shut, setShut] = useState(foldable && folded);
  const n = count ?? rows.length;
  const clickable = foldable ? FOLD_HEADER + " hover:bg-bg2/40" : "";
  if (!n && !empty) return null;
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${FRAME[tone]} ${className}`}>
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${STRIP[tone]} ${clickable}`} {...(foldable ? foldHeaderProps(() => setShut(!shut)) : {})}>
        <h3 className="font-bold">{title}</h3><Count n={n} tone={BUBBLE[tone]} />
        {foldable && <button type="button" className="ml-auto text-dim hover:text-txt" aria-expanded={!shut} onClick={() => setShut(!shut)} title={shut ? tx("Déplier") : tx("Replier")}>{shut ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}</button>}
      </div>
      {!shut && note && <p className="border-b border-line/60 px-4 py-2 text-sm text-muted">{note}</p>}
      {shut ? null : rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
                {cols.map((c) => <th key={c.label} className={`px-4 py-2 ${c.className ?? ""}`}>{c.k && sort ? <SortLabel k={c.k} sort={sort}>{c.label}</SortLabel> : c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r, i) => (
                <tr key={i} className={`hover:!bg-bg2/40 ${zebra ? "even:bg-bg/50" : ""}`}>
                  {r.map((cell, j) => <td key={j} className={`break-words px-4 py-2 align-top ${cols[j]?.className ?? ""}`}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="px-4 py-3 text-sm text-ok">{empty}</p>}
      {!shut && footer && <div className="border-t border-line/60 px-4 py-2 text-xs text-dim">{footer}</div>}
    </section>
  );
}

/** Nombre d'un titre de carte, dans une bulle ronde (teinte au choix : info par défaut) */
export function Count({ n, tone = "info" }: Readonly<{ n: ReactNode; tone?: "info" | "ok" | "warn" | "bad" | "off" }>) {
  const c = { info: "bg-link/15 text-link", ok: "bg-ok/15 text-ok", warn: "bg-warn text-bg", bad: "bg-bad text-bg", off: "bg-bg2 text-muted" }[tone];
  return <span className={`inline-grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full px-1.5 align-middle font-mono text-xs font-bold leading-none ${c}`}>{n}</span>;
}

/** What a page shows before its data: « Loading… », or the error that stopped it */
export function Loading({ error }: Readonly<{ error?: string }>) {
  return <p className="text-sm text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;
}

export function Dim({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="text-dim">{children}</span>;
}

/** Card title (h2): when it opens the card, directly or inside a row that also holds buttons, it becomes a header strip across the card (same look as
 *  TableCard and the card grids); otherwise it is just a larger bold title. The icon takes the link colour; a text colour already set (text-ok…) is kept. */
// Written out in full: Tailwind only generates classes it finds as complete strings in the source.
export const TITLE =
  "[&_h2]:text-[1.0625rem] [&_h2]:font-extrabold [&_h2]:leading-snug [&_h2]:tracking-tight [&_h2_svg]:text-link " +
  "[&>h2:first-child]:-mx-4 [&>div:first-child:has(>h2)]:-mx-4 [&>h2:first-child]:-mt-4 [&>div:first-child:has(>h2)]:-mt-4 [&>h2:first-child]:mb-3 [&>div:first-child:has(>h2)]:mb-3 [&>h2:first-child]:border-b [&>div:first-child:has(>h2)]:border-b [&>h2:first-child]:border-line/60 [&>div:first-child:has(>h2)]:border-line/60 [&>h2:first-child]:bg-bg [&>div:first-child:has(>h2)]:bg-bg [&>h2:first-child]:px-4 [&>div:first-child:has(>h2)]:px-4 [&>h2:first-child]:py-3 [&>div:first-child:has(>h2)]:py-3 [&>h2:first-child]:rounded-t-[15px] [&>div:first-child:has(>h2)]:rounded-t-[15px] [&>div:first-child>h2]:mb-0";

// Tint of the frame (written in full for Tailwind); the header strip stays dark whatever the state.
const CARD_TONE: Record<"ok" | "warn" | "bad", string> = {
  ok: "border-ok/40",
  warn: "border-warn/50",
  bad: "border-bad/50",
};

export function Card({ children, className = "", tone }: Readonly<{ children: ReactNode; className?: string; tone?: "ok" | "warn" | "bad" }>) {
  return <section className={`rounded-2xl border ${tone ? "" : "border-line"} bg-card p-4 shadow-sm ${TITLE} ${tone ? CARD_TONE[tone] : ""} ${className}`}>{children}</section>;
}

/** Barre d'un onglet : recherche, compteur, pastilles de filtre. */
/** Réglage d'affichage rangé avec les filtres (ex. « Désactivées ») : une pastille qui s'allume et s'éteint, comptée dans le bouton « Filtres » */
export interface FilterOption { id: string; label: string; on: boolean; toggle: () => void; mark?: ReactNode; count?: number }

/** Pastille d'un filtre : active, disponible (avec son nombre) ou vide */
function chipTone(on: boolean, count: number): string {
  if (on) return "border-link bg-link/15 text-txt";
  return count ? "border-line bg-bg2 text-muted hover:border-link hover:text-txt" : "border-line bg-bg2 text-dim opacity-60";
}

export function ChipButton({ on, count, mark, label, onClick }: Readonly<{ on: boolean; count: number; mark?: ReactNode; label: string; onClick: () => void }>) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${chipTone(on, count)}`}>
      {mark}{label}<span className="font-mono text-[11px] text-dim">{count}</span>
    </button>
  );
}

export function FilterBar<T>({ f, placeholder, extra, side, options: allOptions = [], optionsLabel, primary: primaryProp = [], oneLine = false, bare = false }: Readonly<{
  f: { query: string; setQuery: (q: string) => void; shown: unknown[]; total: number; active: number; reset: () => void;
       chips: { facet: Facet<T>; chips: Chip[] }[]; toggle: (k: string, v: string) => void };
  placeholder: string; extra?: ReactNode; side?: ReactNode; options?: FilterOption[];   // side : à droite, sous le bouton « Filtres »
  /** Clés des filtres toujours visibles sous la recherche ; les autres restent derrière le bouton « Filtres » */
  primary?: string[];
  /** Filtres visibles sur la même ligne que la recherche ; au-delà de 10 pastilles ou si la ligne déborde, ils passent derrière le bouton « Filtres » */
  oneLine?: boolean; bare?: boolean   // bare: no frame of its own (the page's list right under it has one);
  /** Given: the options are toggles shown on the search line under this caption (« Masquer »), not behind the « Filtres » button */
  optionsLabel?: string;
}>) {
  const options = optionsLabel ? [] : allOptions;
  // Filtres repliés d'office (sur tous les écrans) : la barre de recherche suffit le plus souvent ; ce qui est actif
  // reste visible en pastilles retirables, et le bouton « Filtres » déplie le reste.
  const [open, setOpen] = useState(false);
  const shownGroups = f.chips.filter((g) => g.chips.length > 1 || g.chips.some((c) => c.on) || (g.chips.length > 0 && primaryProp.includes(g.facet.key)));
  // Une seule ligne : si les pastilles demandées sont trop nombreuses (plus de 10) ou ne tiennent pas, elles vont derrière le bouton « Filtres »
  const wanted = shownGroups.filter((g) => primaryProp.includes(g.facet.key));
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [tooWide, setTooWide] = useState(false);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!oneLine || !row) return;
    const check = () => setTooWide(220 + 400 + (measureRef.current?.scrollWidth ?? 0) > row.clientWidth);   // 220 = search field, 400 = counter, buttons and gaps
    check();
    const ro = new ResizeObserver(check);
    ro.observe(row);
    return () => ro.disconnect();
  }, [oneLine, wanted.length]);
  const collapsed = oneLine && (tooWide || wanted.reduce((n, g) => n + g.chips.length, 0) > 10);
  const primary = collapsed ? [] : primaryProp;
  const inline = shownGroups.filter((g) => primary.includes(g.facet.key));
  const groups = shownGroups.filter((g) => !primary.includes(g.facet.key));
  const active = f.chips.filter((g) => !primary.includes(g.facet.key)).flatMap((g) => g.chips.filter((c) => c.on).map((c) => ({ facet: g.facet, chip: c })));
  const nActive = active.length + options.filter((o) => o.on).length;
  // Les filtres déjà actifs un jour sur cette page restent affichés en pastilles, même retirés : un clic les désactive, un autre clic les réactive
  const keyOf = (facet: Facet<T>, chip: Chip) => `${facet.key}\u0000${chip.value}`;
  const [seen, setSeen] = useState<string[]>([]);
  const fresh = active.map((a) => keyOf(a.facet, a.chip)).filter((k) => !seen.includes(k));
  if (fresh.length) setSeen([...seen, ...fresh]);   // mise à jour pendant le rendu : autorisée pour un état de ce composant
  const toggles = seen.flatMap((k) => f.chips.flatMap((g) => g.chips.filter((c) => keyOf(g.facet, c) === k).map((c) => ({ facet: g.facet, chip: c }))));
  const renderInline = (list: typeof inline, nowrap: boolean) => list.length > 0 && (
    <div className={`flex items-center gap-x-5 gap-y-2 ${nowrap ? "flex-nowrap whitespace-nowrap" : "flex-wrap"}`}>
      {list.map(({ facet, chips }) => (
        <div key={facet.key} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-dim">{facet.label}</span>
          {chips.map((c) => <ChipButton key={c.value} on={c.on} count={c.count} mark={facet.mark?.(c.value)} label={c.label} onClick={() => f.toggle(facet.key, c.value)} />)}
        </div>
      ))}
    </div>
  );
  const inlineFilters = renderInline(inline, oneLine);
  return (
    <div className={`my-4 flex flex-col gap-3 ${bare ? "" : "rounded-2xl border border-line bg-card/70 p-3"}`}>
      <div ref={rowRef} className={`flex items-center gap-3 ${oneLine && !collapsed ? "flex-nowrap" : "flex-wrap"}`}>
        <SearchBox value={f.query} onChange={f.setQuery} placeholder={placeholder} count={[f.shown.length, f.total]} />
        {oneLine && inlineFilters}
        {optionsLabel && allOptions.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-dim">{optionsLabel}</span>
            {allOptions.map((o) => <ChipButton key={o.id} on={o.on} count={o.count ?? 0} mark={o.mark} label={o.label} onClick={o.toggle} />)}
          </span>
        )}
        {oneLine && <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute h-0 overflow-hidden">{renderInline(wanted, true)}</div>}
        {f.active > 0 && (
          <button type="button" onClick={f.reset} className="inline-flex shrink-0 items-center whitespace-nowrap gap-1 text-sm text-link hover:underline">
            <X size={14} />{tx("Tout effacer")}
          </button>
        )}
        {((groups.length > 0 || options.length > 0) || side || extra) && (
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {extra}
              {(groups.length > 0 || options.length > 0) && (
                <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold text-link transition-colors hover:bg-link/10 ${open || nActive ? "border-link bg-link/10" : "border-link/50"}`}>
                  <SlidersHorizontal size={14} />{primary.length ? tx("Plus de filtres") : tx("Filtres")}{nActive > 0 && <b className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] leading-none text-white">{nActive}</b>}
                  {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              )}
            </div>
            {side}
          </div>
        )}
      </div>
      {!oneLine && inlineFilters}
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
                {chips.map((c) => <ChipButton key={c.value} on={c.on} count={c.count} mark={facet.mark?.(c.value)} label={c.label} onClick={() => f.toggle(facet.key, c.value)} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** En-tête de colonne triable */
export function Chip({ label, on, act }: Readonly<{ label: string; on: boolean; act: () => void }>) {
  return <button type="button" onClick={act} aria-pressed={on} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-link text-txt ring-2 ring-link/30" : "border-line text-muted hover:text-txt"}`}>{label}</button>;
}

type ColumnSort = { key: string; asc: boolean; by: (k: string) => void };

function SortLabel({ k, sort, children }: Readonly<{ k: string; sort: ColumnSort; children?: ReactNode }>) {
  const on = sort.key === k;
  return (
    <button type="button" onClick={() => sort.by(k)} className={`inline-flex items-center gap-1 uppercase hover:text-txt ${on ? "text-txt" : ""}`}>
      {children}{on && (sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  );
}

export function Th({ k, sort, children, className = "", title }: Readonly<{
  title?: string; k?: string; sort?: ColumnSort; children?: ReactNode; className?: string;
}>) {
  return (
    <th title={title} className={`sticky top-0 z-10 whitespace-nowrap border-b border-line bg-bg2 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-dim ${className}`}>
      {k && sort ? <SortLabel k={k} sort={sort}>{children}</SortLabel> : children}
    </th>
  );
}

export function Table({ head, children, fit = false, fixed = false }: Readonly<{ head: ReactNode; children: ReactNode; fit?: boolean; fixed?: boolean }>) {  // fixed : largeurs données par l'en-tête, identiques pour toutes les lignes  // fit : jamais de défilement horizontal (les colonnes se serrent)
  return (
    <div className={`hidden rounded-2xl border border-line bg-card md:block ${fit ? "overflow-hidden" : "overflow-x-auto"}`}>
      <table className={`w-full border-collapse text-sm ${fixed ? "table-fixed" : ""}`}>
        <thead className="bg-bg2"><tr className="bg-bg2">{head}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60">{children}</tbody>
      </table>
    </div>
  );
}

/** Version mobile d'un tableau : une fiche par ligne */
export function Cards({ children, always = false, dense = false }: Readonly<{ children: ReactNode; always?: boolean; dense?: boolean }>) {  // always : aussi sur grand écran (choix « Cartes ») ; dense : cartes compactes, une colonne de plus
  if (!always) return <div className="flex flex-col gap-2.5 md:hidden">{children}</div>;
  return <div className={`grid gap-2.5 md:grid-cols-2 ${dense ? "lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" : "xl:grid-cols-3"}`}>{children}</div>;
}

export function Empty({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-muted">{children}</p>;
}

export function Td({ children, className = "" }: Readonly<{ children?: ReactNode; className?: string }>) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}

/** Barre de remplissage (disque) */
/** Green to amber to red gradient laid over the whole track; the fill only shows its first part (a full bar is red, a short one green) */
export function GradientFill({ pct }: Readonly<{ pct: number }>) {
  const fill = Math.min(100, Math.max(2, pct));
  return <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 saturate-150" style={{ width: `${fill}%`, backgroundSize: `${10000 / fill}% 100%` }} />;
}

/** A value next to a bar: the number on one line with its unit (« % », « °C »), the unit smaller and dimmed than the value */
export function Pct({ value, unit = "%" }: Readonly<{ value: number | string; unit?: string }>) {
  return <span className="whitespace-nowrap tabular-nums">{value}<span className="ml-0.5 text-[0.8em] text-dim">{unit}</span></span>;
}

export function Fill({ pct }: Readonly<{ pct: number }>) {
  return (
    <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full border border-line bg-bg2 align-middle">
      <GradientFill pct={pct} />
    </span>
  );
}
