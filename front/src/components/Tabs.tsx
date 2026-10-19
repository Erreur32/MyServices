import { ChevronDown, LayoutGrid } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { INVENTORY, TABS, UNRELEASED, visible } from "../lib/tabs";
import { tx } from "../lib/i18n";
import { DROP_ITEM, DROP_PANEL_TAB, useDropdown } from "./Dropdown";

/** Menu « Inventaire ▾ » : les listes complètes (Infra, Virtualisation, DNS, Schémas), consultées moins souvent que les six onglets de la barre */
function InventoryMenu({ snap, current, onSelect }: Readonly<{ snap: Snapshot; current: TabId; onSelect: (t: TabId) => void }>) {
  const { open, setOpen, box } = useDropdown();
  const items = INVENTORY.filter((t) => visible(t.id, snap));
  if (items.length === 0) return null;
  const activeItem = items.find((t) => t.id === current);
  return (
    <div ref={box} className="flex shrink-0 items-stretch border-l border-line pl-1">
      <div className="relative flex items-center">   {/* the panel is placed against this box: the button's own edges */}
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-t-lg py-2.5 pl-3.5 pr-3.5 text-sm font-semibold transition-colors ${
          activeItem ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
        <LayoutGrid size={16} strokeWidth={1.75} aria-hidden />
        {activeItem ? tx("Inventaire · {0}", activeItem.label) : tx("Inventaire")}
        <ChevronDown size={14} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div role="menu" className={`${DROP_PANEL_TAB} w-72 p-1.5`}>
          {items.map((t) => (
            <button key={t.id} type="button" role="menuitem" onClick={() => { onSelect(t.id); setOpen(false); }}
              title={UNRELEASED.includes(t.id) ? tx("Pas encore publié : visible seulement sur ce serveur de développement") : undefined}
              className={`${DROP_ITEM} justify-between ${t.id === current ? "bg-bg2 text-txt" : ""}`}>
              <span className="flex items-center gap-2.5"><t.icon size={15} aria-hidden />{t.label}</span>
              {t.hint && <span className="text-xs text-dim">{t.hint}</span>}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function Tabs({ tab, snap, badges, onSelect, onBadge }: {
  tab: TabId; snap: Snapshot; badges: Partial<Record<TabId, "crit" | "warn">>; onSelect: (t: TabId) => void; onBadge?: (t: TabId, level: "crit" | "warn") => void;
}) {
  return (
    // The tab list scrolls on its own (narrow screens): the Inventory menu sits outside that scrolling box, so its dropdown
    // is never clipped by the list's overflow-x and stays reachable even when the list is scrolled.
    <div className="flex items-stretch border-b border-line">
      <nav className="flex min-w-0 gap-1 overflow-x-auto" aria-label={tx("Onglets")}>
        {TABS.filter((t) => visible(t.id, snap)).map((t) => {
          const on = t.id === tab, b = badges[t.id];
          return (
            <span key={t.id} className="relative flex shrink-0">
              <button type="button" onClick={() => onSelect(t.id)} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-t-lg py-2.5 pl-3.5 text-sm font-semibold transition-colors ${b ? "pr-7" : "pr-3.5"} ${
                  on ? "bg-card text-txt shadow-[inset_0_-1.5px_0_rgb(var(--link))]" : "text-muted hover:bg-bg2 hover:text-txt"}`}>
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
      <InventoryMenu snap={snap} current={tab} onSelect={onSelect} />
    </div>
  );
}
