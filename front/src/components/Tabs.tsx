import type { Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { TABS, UNRELEASED, visible } from "../lib/tabs";
import { tx } from "../lib/i18n";

export function Tabs({ tab, snap, badges, onSelect, onBadge }: {
  tab: TabId; snap: Snapshot; badges: Partial<Record<TabId, "crit" | "warn">>; onSelect: (t: TabId) => void; onBadge?: (t: TabId, level: "crit" | "warn") => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label={tx("Onglets")}>
      {TABS.filter((t) => visible(t.id, snap)).map((t) => {
        const on = t.id === tab, b = badges[t.id];
        return (
          <span key={t.id} className="relative flex shrink-0">
            <button type="button" onClick={() => onSelect(t.id)} aria-current={on ? "page" : undefined}
              title={UNRELEASED.includes(t.id) ? tx("Pas encore publié : visible seulement sur ce serveur de développement") : undefined}
              className={`flex items-center gap-1.5 rounded-t-lg py-2.5 pl-3.5 text-sm font-semibold transition-colors ${b ? "pr-7" : "pr-3.5"} ${
                UNRELEASED.includes(t.id) ? `italic opacity-50 hover:opacity-80 ${on ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-dim hover:bg-bg2"}`
                : on ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
              <t.icon size={16} strokeWidth={1.75} aria-hidden />{t.label}
            </button>
            {b && (
              <button type="button" onClick={() => (onBadge ?? ((id: TabId) => onSelect(id)))(t.id, b)} aria-label={b === "crit" ? tx("Voir les problèmes") : tx("Voir ce qui est à surveiller")}
                title={`${b === "crit" ? tx("problème à regarder") : tx("à surveiller")}\n${tx("Cliquer pour voir les éléments concernés")}`}
                className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full hover:bg-bg2">
                <span className={`h-2.5 w-2.5 rounded-full ${b === "crit" ? "bg-bad" : "bg-warn"}`} />
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
