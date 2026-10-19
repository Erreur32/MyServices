import { ArrowUpCircle, ChevronDown, ExternalLink, FileText, Info, LifeBuoy, ListChecks, LogOut, Moon, ScrollText, SlidersHorizontal, Sun, UserRound, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { DiscoveryBell } from "./DiscoveryCard";
import { DropItem, DROP_PANEL, DropSep, useDropdown } from "./Dropdown";
import { useState } from "react";
import { logout, type Snapshot } from "../api";
import type { TabId } from "../lib/summary";
import { HEADER_LOGOS, useHeaderLogo, type Theme } from "../theme";
import { LOCALE, tx } from "../lib/i18n";
import { appVersion } from "../lib/format";
import { reopenAssistant } from "../lib/assistant";
import { GITHUB } from "../lib/links";
import { lastSettingsSection, normalizeSection } from "../lib/settingsNav";
import { dismissTag, dismissedTag } from "../lib/updateNotice";
import { ScanOrb } from "./ScanOrb";

/** Où ouvrir les Réglages depuis l'engrenage : la dernière section visitée (normalisée : une ancienne section peut avoir déménagé), sinon la page par défaut */
function settingsHash(): string {
  const last = lastSettingsSection();
  if (!last) return "settings";
  const norm = normalizeSection(last);
  return norm.redirect ?? (norm.section ? `settings/${norm.section}` : "settings");
}

function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  return min < 1 ? tx("à l'instant") : min < 60 ? tx("il y a {0} min", min) : tx("il y a {0} h", Math.round(min / 60));
}

/** Dev image only: the release in prod, the git state it was built from (branch, commit, commits since the tag, uncommitted
 *  changes) and the planned version. GIT_REV from scripts/git-rev.sh: « branch|commit|ahead|tag|dirty »; an older plain value is shown as is */
function DevState({ git, released, planned }: Readonly<{ git?: string; released?: string | null; planned?: string | null }>) {
  const [branch, sha, ahead, tag, dirty] = (git ?? "").split("|");
  const parts = git?.includes("|");
  const pill = "rounded border border-line bg-bg2/60 px-1.5 py-0.5 font-mono";
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal tracking-normal text-dim">
      {released && <span title={tx("Dernière version publiée sur GitHub (celle de la prod)")}>{tx("prod")} <code className={`${pill} text-muted`}>{released}</code></span>}
      {git && (parts ? (
        <span className="inline-flex flex-wrap items-center gap-1" title={tx("État git d'où vient cette image")}>
          git <code className={`${pill} ${branch === "main" ? "text-muted" : "text-warn"}`}>{branch}</code>
          <code className={`${pill} text-muted`}>{sha}</code>
          {Number(ahead) > 0 && <span>{tx("+{0} depuis {1}", ahead, tag)}</span>}
          {dirty && <span className="text-warn">{tx("modifs non commitées")}</span>}
        </span>
      ) : <span>git <code className={`${pill} text-muted`}>{git}</code></span>)}
      {planned && <span title={tx("Version prévue d'après le journal des changements")}>{tx("prévue")} <code className={`${pill} text-link`}>{planned}</code></span>}
    </span>
  );
}

/** A new release published: a pill that opens Settings → Updates; its cross hides it for this version only */
function UpdatePill({ update }: Readonly<{ update?: { available: boolean; tag?: string | null } | null }>) {
  const [hidden, setHidden] = useState(dismissedTag());
  if (!update?.available || !update.tag || hidden === update.tag) return null;
  const tag = update.tag;
  return (
    <span className="hidden items-center overflow-hidden rounded-full border border-link/50 bg-link/10 text-xs sm:inline-flex">
      <a href="#settings/updates" className="inline-flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 font-semibold text-link no-underline hover:bg-link/15" title={tx("Nouvelle version publiée : voir Réglages → Mises à jour")}>
        <ArrowUpCircle size={14} aria-hidden />{tx("{0} disponible", tag)}
      </a>
      <button type="button" onClick={() => { dismissTag(tag); setHidden(tag); }} aria-label={tx("Masquer pour cette version")} title={tx("Masquer pour cette version")}
        className="grid h-full place-items-center px-1.5 text-dim hover:bg-link/15 hover:text-txt"><X size={12} aria-hidden /></button>
    </span>
  );
}

export function Header({ snap, theme, toggleTheme, now, current }: Readonly<{ snap: Snapshot; theme: Theme; toggleTheme: () => void; now: number; current: TabId }>) {
  const stale = (now - new Date(snap.data.generated).getTime()) / 60000 > snap.data.page.stale_min;
  const logo = useHeaderLogo();
  return (
    <header className="relative flex flex-wrap items-center justify-between gap-3 py-4">
      <ScanOrb />
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-dim">
          <span className={`h-2 w-2 rounded-full ${stale ? "bg-warn" : "bg-ok"}`} />
          <span title={new Date(snap.data.generated).toLocaleString(LOCALE)}>
            {tx("Données")} {ago(snap.data.generated, now)}{stale && tx(" · en retard")}
          </span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <img src={`${import.meta.env.BASE_URL}${HEADER_LOGOS.find((l) => l.id === logo)!.file}`} alt="" width={30} height={30} className="shrink-0" />{tx("MyServices")}
          {snap.me.version && <span className="rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-xs font-semibold tracking-normal text-dim" title={snap.me.released && snap.me.version !== "dev" && !/^v\d+\.\d+\.\d+/.test(snap.me.version) ? tx("Image construite depuis une branche, après la version {0} : {1}", snap.me.released, snap.me.version) : snap.me.version}>{appVersion(snap.me.version, snap.me.released)}</span>}
          {snap.me.version === "dev" && <DevState git={snap.me.git} released={snap.me.released} planned={snap.me.planned} />}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <UpdatePill update={snap.me.update} />
        {snap.me.role === "admin" && <DiscoveryBell machines={snap.data.machine_list} />}
        {snap.me.role === "admin" && (
          <button type="button" onClick={() => { location.hash = settingsHash(); }} aria-label={tx("Réglages")} aria-current={current === "settings" ? "page" : undefined} title={tx("Réglages")}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${current === "settings" ? "border-link bg-link/15 text-link" : "border-line text-muted hover:border-link hover:text-txt"}`}>
            <SlidersHorizontal size={17} aria-hidden />
          </button>
        )}
        <UserMenu snap={snap} theme={theme} toggleTheme={toggleTheme} />
      </div>
    </header>
  );
}

/** Menu du compte, à droite : qui est connecté, réglages, profil, premiers pas, thème, projet, déconnexion. */
function UserMenu({ snap, theme, toggleTheme }: { snap: Snapshot; theme: Theme; toggleTheme: () => void }) {
  const { open, setOpen, box } = useDropdown();
  const admin = snap.me.role === "admin";
  const go = (hash: string) => { location.hash = hash; setOpen(false); };
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3 text-sm font-semibold text-txt hover:border-link">
        <Avatar username={snap.me.username} version={snap.me.avatar} />
        {snap.me.username}
        <ChevronDown size={14} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className={`${DROP_PANEL} w-64 p-1.5`}>
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar username={snap.me.username} version={snap.me.avatar} size={36} />
            <span className="min-w-0">
              <b className="block truncate">{snap.me.username}</b>
              <span className="block truncate text-xs text-dim">{snap.me.email || (admin ? tx("admin : tout, réglages compris") : tx("lecture seule"))}</span>
            </span>
          </div>
          <DropSep />
          <DropItem icon={<UserRound size={15} />} onClick={() => go("profile")}>{tx("Profil")}</DropItem>
          <DropItem icon={theme === "dark" ? <Sun size={15} /> : <Moon size={15} />} onClick={toggleTheme}>{tx("Thème")} {theme === "dark" ? tx("clair") : tx("sombre")}</DropItem>
          <DropSep />
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-widest text-dim">{tx("Consulter")}</p>
          {admin && <DropItem icon={<ScrollText size={15} />} onClick={() => go("audit")}>{tx("Journal d'audit")}</DropItem>}
          {admin && <DropItem icon={<FileText size={15} />} onClick={() => go("logs")}>{tx("Journaux")}</DropItem>}
          <DropItem icon={<LifeBuoy size={15} />} onClick={() => go("help")}>{tx("Aide")}</DropItem>
          <DropItem icon={<Info size={15} />} onClick={() => go("about")}>{tx("À propos")}</DropItem>
          <DropItem icon={<ExternalLink size={15} />} href={GITHUB}>{tx("Projet sur GitHub")}</DropItem>
          {admin && <><DropSep /><DropItem icon={<ListChecks size={15} />} title={tx("Rouvre l'assistant depuis le début")} onClick={() => { setOpen(false); reopenAssistant(); }}>{tx("Revoir l'assistant de démarrage")}</DropItem></>}
          <DropSep />
          <DropItem icon={<LogOut size={15} />} danger onClick={() => void logout()}>{tx("Se déconnecter")}</DropItem>
        </div>
      )}
    </div>
  );
}
