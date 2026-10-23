// Side menu, always on the left: four groups of pages, an alert dot per page, folded to icons on demand (kept by this browser).
// On a phone it is a drawer opened from the header.
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { activeNav, navGroups, type NavItem } from "../lib/tabs";
import { settingsHash } from "../lib/settingsNav";
import { useRoute } from "../lib/route";
import { tx } from "../lib/i18n";

const KEY = "ms.nav.collapsed";
type Level = "crit" | "warn";

/** Folded or not: the choice kept by this browser, else folded on a screen narrower than 1280 px */
function savedCollapsed(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? innerWidth < 1280 : v === "1";
  } catch { return false; }
}

const levelText = (b: Level) => (b === "crit" ? tx("problème à regarder") : tx("à surveiller"));

function itemPad(narrow: boolean, child?: boolean): string {
  if (narrow) return "justify-center px-0";
  return child ? "pl-9 pr-3" : "px-3";
}

function NavLink({ item, on, narrow, badge, onNavigate, onBadge }: Readonly<{
  item: NavItem; on: boolean; narrow: boolean; badge?: Level; onNavigate: () => void; onBadge: (t: TabId) => void;
}>) {
  const href = `#${item.id === "settings" ? settingsHash() : item.hash}`;
  const Icon = item.icon;
  const named = badge ? [item.label, levelText(badge)].join(", ") : item.label;   // folded: the name (and the dot's meaning) for screen readers
  const dot = badge === "crit" ? "bg-bad" : "bg-warn";
  return (
    <span className="relative flex">
      <a href={href} onClick={onNavigate} aria-current={on ? "page" : undefined} title={narrow ? item.label : undefined}
        aria-label={narrow ? named : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-sm font-semibold no-underline transition-colors ${itemPad(narrow, item.child)} ${badge && !narrow ? "pr-8" : ""} ${
          on ? "bg-link/15 text-txt ring-1 ring-link/50" : "text-muted hover:bg-card hover:text-txt"}`}>
        <Icon size={item.child ? 15 : 17} strokeWidth={1.75} aria-hidden className="shrink-0" />
        {!narrow && <span className="truncate">{item.label}</span>}
      </a>
      {badge && narrow && <span aria-hidden className={`pointer-events-none absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg2 ${dot}`} />}
      {badge && !narrow && (
        <button type="button" onClick={() => onBadge(item.tab)} aria-label={badge === "crit" ? tx("Voir les problèmes") : tx("Voir ce qui est à surveiller")}
          title={`${levelText(badge)}\n${tx("Cliquer pour voir les éléments concernés")}`}
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full hover:bg-bg">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        </button>
      )}
    </span>
  );
}

export function Sidebar({ snap, badges, onNavigate, onBadge, mobileOpen, onClose }: Readonly<{
  snap: Snapshot; badges: Partial<Record<TabId, Level>>; onNavigate: () => void; onBadge: (t: TabId) => void; mobileOpen: boolean; onClose: () => void;
}>) {
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const route = useRoute();
  const groups = navGroups(snap);
  const active = activeNav(route, groups);
  const narrow = collapsed && !mobileOpen;   // the phone drawer always shows the names
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* storage refused: the choice lasts this visit */ }
    return !c;
  });
  const toggleLabel = collapsed ? tx("Déplier le menu") : tx("Réduire le menu");
  const place = mobileOpen ? "fixed inset-y-0 left-0 z-50 flex shadow-2xl" : "sticky top-0 hidden md:flex";
  return (
    <>
      {mobileOpen && <button type="button" aria-label={tx("Fermer le menu")} onClick={onClose} className="fixed inset-0 z-40 bg-black/50 md:hidden" />}
      <nav aria-label={tx("Menu principal")} className={`${place} h-screen shrink-0 flex-col border-r border-line bg-bg2 ${narrow ? "w-16 px-2" : "w-60 px-3"}`}>
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2 pt-3">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-0.5">
              {narrow
                ? <span aria-hidden className="mx-auto my-2 h-px w-8 bg-line" />
                : <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-dim">{g.label}</p>}
              {g.items.map((i) => (
                <NavLink key={i.id} item={i} on={i.id === active} narrow={narrow} badge={i.id === i.tab ? badges[i.tab] : undefined}
                  onNavigate={onNavigate} onBadge={onBadge} />
              ))}
            </div>
          ))}
        </div>
        <button type="button" onClick={toggle} aria-label={toggleLabel} title={toggleLabel}
          className={`mb-3 hidden items-center gap-2.5 rounded-lg border border-line py-2 text-sm font-semibold text-muted hover:border-link hover:text-txt md:flex ${narrow ? "justify-center" : "px-3"}`}>
          {collapsed ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
          {!narrow && tx("Réduire le menu")}
        </button>
      </nav>
    </>
  );
}
