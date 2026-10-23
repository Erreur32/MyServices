// Side menu, always on the left: four groups of pages, an alert dot per page, the sub-pages of the open page under it. Folded to
// icons on demand (kept by this browser): the sub-pages of an icon then open in a small panel, on hover or on a click (Profile → Appearance).
// On a phone it is a drawer opened from the header.
import { useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { activeNav, leaves, navGroups, type NavItem } from "../lib/tabs";
import { useRoute } from "../lib/route";
import { HEADER_LOGOS, useFlyout, useHeaderLogo } from "../theme";
import { securityFindings, type Area } from "../lib/securityFindings";
import { useDiscoveries } from "./DiscoveryCard";
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

/** Findings of Security per sub-page: the number shown next to it in the menu */
const AREA_PAGE: Partial<Record<Area, string>> = { sites: "security-sites", ssh: "security-access", ports: "security-ports", certs: "security-certs", fail2ban: "fail2ban" };
type Counts = Record<string, number>;

function securityCounts(snap: Snapshot): Counts {
  const n: Counts = {};
  for (const f of securityFindings(snap)) { const id = AREA_PAGE[f.area]; if (id) n[id] = (n[id] ?? 0) + 1; }
  return n;
}

/** What is left to do to complete the discovery (admins only: its list is theirs), told to the menu */
function DiscoveryTodo({ onTodo }: Readonly<{ onTodo: (n: number) => void }>) {
  const [disc] = useDiscoveries();
  const todo = disc?.todo ?? 0;
  useEffect(() => onTodo(todo), [todo, onTodo]);
  return null;
}

function CountChip({ n }: Readonly<{ n?: number }>) {
  if (!n) return null;
  return <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-warn/20 px-1.5 text-[11px] font-bold leading-none text-warn">{n}</span>;
}

const levelText = (b: Level) => (b === "crit" ? tx("problème à regarder") : tx("à surveiller"));
const ROW = "flex w-full items-center gap-2.5 rounded-lg text-sm font-semibold no-underline transition-colors";
const rowTone = (on: boolean) => (on ? "bg-link/15 text-txt ring-1 ring-link/50" : "text-muted hover:bg-card hover:text-txt");

function Badge({ level, tab, onBadge }: Readonly<{ level: Level; tab: TabId; onBadge: (t: TabId) => void }>) {
  return (
    <button type="button" onClick={() => onBadge(tab)} aria-label={level === "crit" ? tx("Voir les problèmes") : tx("Voir ce qui est à surveiller")}
      title={`${levelText(level)}\n${tx("Cliquer pour voir les éléments concernés")}`}
      className="absolute right-8 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full hover:bg-bg">{/* one column for every dot, left of the chevrons */}
      <span className={`h-2.5 w-2.5 rounded-full ${level === "crit" ? "bg-bad" : "bg-warn"}`} />
    </button>
  );
}

/** A view group (« Vue ») is a heading, not a page: never lit as the open one */
function subTone(group: boolean, on: boolean): string {
  if (!group) return rowTone(on);
  return on ? "text-txt" : "text-muted hover:text-txt";
}

/** The sub-pages of an entry, a level deeper for the views of a sub-page (« Vue » › UniFi…): all shown */
function SubLinks({ subs, active, depth, counts, onNavigate, inPanel }: Readonly<{ subs: NavItem[]; active: string; depth: number; counts: Counts; onNavigate: () => void; inPanel?: boolean }>) {
  const pad = inPanel ? ["pl-3", "pl-8"] : ["pl-7", "pl-12"];
  return (
    <>
      {subs.map((x) => {
        const on = x.subs ? leaves(x).some((y) => y.id === active) : x.id === active;
        return (
          <div key={x.id} className="flex flex-col gap-0.5">
            <a role={inPanel ? "menuitem" : undefined} href={`#${x.hash}`} onClick={onNavigate} aria-current={!x.subs && on ? "page" : undefined}
              className={`${ROW} py-1.5 pr-3 text-[13px] ${pad[Math.min(depth, 1)]} ${subTone(!!x.subs, on)}`}>
              <x.icon size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />{x.label}<CountChip n={counts[x.id]} />
            </a>
            {x.subs && <SubLinks subs={x.subs} active={active} depth={depth + 1} counts={counts} onNavigate={onNavigate} inPanel={inPanel} />}
          </div>
        );
      })}
    </>
  );
}

/** Against the icon: downwards from its top, or upwards from its bottom in the lower half of the screen (never cut by the bottom edge) */
const flyoutPlace = (at: DOMRect) => (at.top > innerHeight / 2 ? { bottom: innerHeight - at.bottom, left: at.right } : { top: at.top, left: at.right });

/** The sub-pages of a folded entry, in a panel against its icon (fixed: the menu's scrolling box would clip it) */
function Flyout({ item, active, at, counts, onNavigate }: Readonly<{ item: NavItem; active: string; at: DOMRect; counts: Counts; onNavigate: () => void }>) {
  return (
    <div role="menu" aria-label={item.label} style={flyoutPlace(at)} className="fixed z-50 pl-2">
      <div className="w-56 rounded-xl border border-line bg-card p-1.5 shadow-2xl">
        <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-widest text-dim">{item.label}</p>
        <SubLinks subs={item.subs!} active={active} depth={0} counts={counts} onNavigate={onNavigate} inPanel />
      </div>
    </div>
  );
}

function NavEntry({ item, active, narrow, badge, counts, onNavigate, onBadge }: Readonly<{
  item: NavItem; active: string; narrow: boolean; badge?: Level; counts: Counts; onNavigate: () => void; onBadge: (t: TabId) => void;
}>) {
  const mode = useFlyout();
  const box = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<DOMRect | null>(null);
  const flies = narrow && !!item.subs;   // folded, with sub-pages: they open in a panel
  const open = leaves(item).some((x) => x.id === active);
  const [fold, setFold] = useState<boolean | null>(null);   // chosen with the chevron; follows the open page again when it changes
  useEffect(() => setFold(null), [open]);
  const expanded = fold ?? open;
  const show = () => setFly(box.current?.getBoundingClientRect() ?? null);
  useEffect(() => {
    if (!fly) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setFly(null); };
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setFly(null); };
    addEventListener("keydown", key);
    addEventListener("mousedown", away);
    return () => { removeEventListener("keydown", key); removeEventListener("mousedown", away); };
  }, [fly]);
  const click = (e: MouseEvent) => {
    if (flies && mode === "click") { e.preventDefault(); if (fly) setFly(null); else show(); return; }
    setFly(null);
    onNavigate();
  };
  const blur = (e: FocusEvent) => { if (!box.current?.contains(e.relatedTarget as Node)) setFly(null); };
  const hover = flies && mode === "hover";
  const named = badge ? [item.label, levelText(badge)].join(", ") : item.label;   // folded: the name (and the dot's meaning) for screen readers
  const Icon = item.icon;
  return (
    <div ref={box} onMouseEnter={hover ? show : undefined} onMouseLeave={flies ? () => setFly(null) : undefined} onFocus={hover ? show : undefined} onBlur={flies ? blur : undefined}>
      <span className="relative flex">
        <a href={`#${item.hash}`} onClick={click} aria-current={open && !item.subs ? "page" : undefined} title={narrow ? item.label : undefined}
          aria-label={narrow ? named : undefined} aria-haspopup={flies ? "menu" : undefined} aria-expanded={flies ? !!fly : undefined}
          className={`${ROW} py-2 ${narrow ? "justify-center" : "px-3"} ${!narrow && (badge || item.subs) ? "pr-16" : ""} ${rowTone(open)}`}>
          <Icon size={17} strokeWidth={1.75} aria-hidden className="shrink-0" />
          {!narrow && <span className="truncate">{item.label}</span>}
        </a>
        {badge && narrow && <span aria-hidden className={`pointer-events-none absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg2 ${badge === "crit" ? "bg-bad" : "bg-warn"}`} />}
        {badge && !narrow && <Badge level={badge} tab={item.tab} onBadge={onBadge} />}
        {!narrow && item.subs && (
          <button type="button" onClick={() => setFold(!expanded)} aria-expanded={expanded} aria-label={expanded ? tx("Replier") : tx("Déplier")} title={expanded ? tx("Replier") : tx("Déplier")}
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-dim hover:bg-bg hover:text-txt">
            <ChevronRight size={14} aria-hidden className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}
      </span>
      {!narrow && expanded && item.subs && (
        <div className="mt-0.5 flex flex-col gap-0.5"><SubLinks subs={item.subs} active={active} depth={0} counts={counts} onNavigate={onNavigate} /></div>
      )}
      {fly && <Flyout item={item} active={active} at={fly} counts={counts} onNavigate={() => { setFly(null); onNavigate(); }} />}
    </div>
  );
}

export function Sidebar({ snap, badges, onNavigate, onBadge, mobileOpen, onClose }: Readonly<{
  snap: Snapshot; badges: Partial<Record<TabId, Level>>; onNavigate: () => void; onBadge: (t: TabId) => void; mobileOpen: boolean; onClose: () => void;
}>) {
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const route = useRoute();
  // « To watch » only when something is: the same reading as the dots of the menu
  const groups = navGroups(snap, new Set(["services", "network", "backups", "security"].filter((t) => !badges[t as TabId]).map((t) => `${t}-watch`)));
  const active = activeNav(route, groups);
  const narrow = collapsed && !mobileOpen;   // the phone drawer always shows the names
  const [todo, setTodo] = useState(0);
  const security = useMemo(() => securityCounts(snap), [snap]);
  const counts = useMemo(() => ({ ...security, "network-discovery": todo }), [security, todo]);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* storage refused: the choice lasts this visit */ }
    return !c;
  });
  const logo = useHeaderLogo();
  const toggleLabel = collapsed ? tx("Déplier le menu") : tx("Réduire le menu");
  const place = mobileOpen ? "fixed inset-y-0 left-0 z-50 flex shadow-2xl" : "sticky top-0 hidden md:flex";
  return (
    <>
      {snap.me.role === "admin" && <DiscoveryTodo onTodo={setTodo} />}
      {mobileOpen && <button type="button" aria-label={tx("Fermer le menu")} onClick={onClose} className="fixed inset-0 z-40 bg-black/50 md:hidden" />}
      <nav aria-label={tx("Menu principal")} className={`${place} h-screen shrink-0 flex-col border-r border-line bg-bg2 ${narrow ? "w-16 px-2" : "w-60 px-3"}`}>
        <a href="#" onClick={onNavigate} title={tx("Accueil")} className={`flex shrink-0 items-center gap-2.5 border-b border-line py-4 text-xl font-bold tracking-tight text-txt no-underline ${narrow ? "justify-center" : "px-2"}`}>
          <img src={`${import.meta.env.BASE_URL}${HEADER_LOGOS.find((l) => l.id === logo)!.file}`} alt="" width={30} height={30} className="shrink-0" />
          {narrow ? <span className="sr-only">{tx("MyServices")}</span> : tx("MyServices")}
        </a>
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-2 pt-1">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-0.5">
              {narrow
                ? <span aria-hidden className="mx-auto my-2 h-px w-8 bg-line" />
                : <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-dim">{g.label}</p>}
              {g.items.map((i) => (
                <NavEntry key={i.id} item={i} active={active} narrow={narrow} badge={i.id === i.tab ? badges[i.tab] : undefined} counts={counts}
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
