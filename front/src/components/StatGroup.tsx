// One group of counters of the home page's right column: a title that opens the tab, and up to four counters that open it already filtered.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { appIcon } from "../lib/appIcons";
import type { Selected } from "../lib/filter";
import { tx } from "../lib/i18n";
import type { TabId } from "../lib/summary";

type Tone = "ok" | "warn" | "bad" | "off";
const TONE: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", off: "text-muted" };

/** Vrai logo de l'appli quand il existe, sinon une icône du thème */
export function Mark({ app, Icon, tone = "text-muted" }: Readonly<{ app?: string; Icon: LucideIcon; tone?: string }>) {
  const src = app ? appIcon([app]) : null;
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg2">{src ? <img src={src} alt="" className="h-4 w-4" /> : <Icon size={14} className={tone} aria-hidden />}</span>;
}

/** Un compteur : [teinte, nombre, libellé, filtre à appliquer à l'ouverture de l'onglet, ou sous-page à ouvrir (adresse, ou action) quand il n'y a pas de filtre] */
export type Cell = [Tone, number, string, Selected?, (string | (() => void))?];
export type Open = { go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void };

function Counter({ cell: [tone, n, label, filter, to], tab, nav }: Readonly<{ cell: Cell; tab: TabId; nav: Open }>) {
  const body = (
    <>
      <div className={`font-mono text-sm font-bold leading-tight ${TONE[tone]}`}>{n}</div>
      <div className="truncate text-[10px] leading-tight text-muted" title={label}>{label}</div>
    </>
  );
  const open = filter ? () => nav.goFilter(tab, filter) : typeof to === "string" ? () => { location.hash = to; } : to;
  return n && open
    ? <button type="button" onClick={open} title={tx("Afficher : {0}", label)} className="flex min-w-0 flex-col justify-center rounded-lg bg-bg2 px-1 py-0.5 text-center transition-colors hover:bg-link/15 hover:ring-1 hover:ring-link">{body}</button>
    : <div className={`flex min-w-0 flex-col justify-center rounded-lg bg-bg2 px-1 py-0.5 text-center ${n ? "" : "opacity-40"}`}>{body}</div>;
}

const ROW = "grid auto-cols-[minmax(0,1fr)] grid-flow-col gap-1";

export function Group({ title, sub, accent, tab, nav, cells = [], sides, mark, href }: Readonly<{
  mark: ReactNode; title: string; sub: string; accent: string; tab: TabId; nav: Open; cells?: Cell[]; href?: string;   // href: a sub-page to open instead of the tab
  sides?: [string, Cell[]][];   // counters split under captions, side by side, instead of `cells`
}>) {
  return (
    <div className={`flex h-full w-full flex-col rounded-xl border border-line border-l-4 ${accent} bg-card px-2.5 py-1.5`}>
      <button type="button" onClick={() => { if (href) location.hash = href; else nav.go(tab); }} className="flex w-full items-center justify-between gap-2 text-left hover:text-link" title={tx("Ouvrir l'onglet")}>
        <b className="flex min-w-0 items-center gap-2 text-sm">{mark}<span className="truncate">{title.replace(/^\p{Extended_Pictographic}\s*/u, "")}</span></b><span className="max-w-[40%] shrink-0 truncate text-[11px] text-dim" title={sub}>{sub}</span>
      </button>
      {sides
        ? <div className={`mt-1 flex-1 ${ROW} gap-2`}>{sides.map(([caption, list]) => (
            <div key={caption} className="min-w-0">
              <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-dim">{caption}</div>
              <div className={`mt-0.5 ${ROW}`}>{list.map((c) => <Counter key={c[2]} cell={c} tab={tab} nav={nav} />)}</div>
            </div>
          ))}</div>
        : <div className={`mt-1 flex-1 ${ROW}`}>{cells.map((c) => <Counter key={c[2]} cell={c} tab={tab} nav={nav} />)}</div>}
    </div>
  );
}
