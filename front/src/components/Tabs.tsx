import type { Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { TABS, visible } from "../lib/tabs";
import { tx } from "../lib/i18n";

export function Tabs({ tab, snap, badges, onSelect }: {
  tab: TabId; snap: Snapshot; badges: Partial<Record<TabId, "crit" | "warn">>; onSelect: (t: TabId) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Onglets")}>
      {TABS.filter((t) => visible(t.id, snap)).map((t) => {
        const on = t.id === tab, b = badges[t.id];
        return (
          <button key={t.id} type="button" onClick={() => onSelect(t.id)} aria-current={on ? "page" : undefined}
            className={`relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              on ? "bg-card text-txt shadow-[inset_0_-2px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
            <t.icon size={16} strokeWidth={1.75} aria-hidden />{t.label}
            {b && <span className={`h-2 w-2 rounded-full ${b === "crit" ? "bg-bad" : "bg-warn"}`} title={b === "crit" ? tx("problème à regarder") : tx("à surveiller")} />}
          </button>
        );
      })}
    </nav>
  );
}
