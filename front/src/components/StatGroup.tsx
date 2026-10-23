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

/** Un compteur : [teinte, nombre, libellé, filtre à appliquer à l'ouverture de l'onglet] */
export type Cell = [Tone, number, string, Selected?];
export type Open = { go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void };

export function Group({ title, sub, accent, tab, nav, cells, mark, href }: Readonly<{
  mark: ReactNode; title: string; sub: string; accent: string; tab: TabId; nav: Open; cells: Cell[]; href?: string;   // href: a sub-page to open instead of the tab
}>) {
  return (
    <div className={`w-full rounded-xl border border-line border-l-4 ${accent} bg-card p-3`}>
      <button type="button" onClick={() => { if (href) location.hash = href; else nav.go(tab); }} className="flex w-full items-center justify-between gap-2 text-left hover:text-link" title={tx("Ouvrir l'onglet")}>
        <b className="flex min-w-0 items-center gap-2 text-sm">{mark}<span className="truncate">{title.replace(/^\p{Extended_Pictographic}\s*/u, "")}</span></b><span className="shrink-0 text-xs text-dim">{sub}</span>
      </button>
      <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map(([tone, n, label, filter]) => {
          const body = (
            <>
              <div className={`font-mono text-base font-bold ${TONE[tone]}`}>{n}</div>
              <div className="truncate text-[10.5px] text-muted" title={label}>{label}</div>
            </>
          );
          return n && filter
            ? <button key={label} type="button" onClick={() => nav.goFilter(tab, filter)} title={tx("Afficher : {0}", label)}
                className="rounded-lg bg-bg2 px-1.5 py-1 text-center transition-colors hover:bg-link/15 hover:ring-1 hover:ring-link">{body}</button>
            : <div key={label} className={`rounded-lg bg-bg2 px-1.5 py-1 text-center ${n ? "" : "opacity-40"}`}>{body}</div>;
        })}
      </div>
    </div>
  );
}

