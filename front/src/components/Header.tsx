import { ArrowUpCircle, CheckCircle2, ChevronDown, ExternalLink, Info, LifeBuoy, ListChecks, LogOut, Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { Avatar } from "./Avatar";
import { DiscoveryBell } from "./DiscoveryCard";
import { DropItem, DROP_PANEL, DropSep, useDropdown } from "./Dropdown";
import { useEffect, useState } from "react";
import { logout, type Snapshot } from "../api";
import type { Theme } from "../theme";
import { LOCALE, tx } from "../lib/i18n";
import { appVersion } from "../lib/format";
import { reopenAssistant } from "../lib/assistant";
import { GITHUB } from "../lib/links";
import { announcedTag, dismissTag, dismissedTag, markAnnounced, noticesOn, onCheck, onNotices, type UpdateNews } from "../lib/updateNotice";
import { ScanOrb } from "./ScanOrb";

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

/** A new release published: a pill that opens Settings → Updates, with a beacon while it is new; its cross hides it for this version only */
function UpdatePill({ update }: Readonly<{ update?: UpdateNews | null }>) {
  const [hidden, setHidden] = useState(dismissedTag());
  if (!update?.available || !update.tag || hidden === update.tag) return null;
  const tag = update.tag, fresh = announcedTag() !== tag;
  return (
    <span className="hidden items-center overflow-hidden rounded-full border border-link/50 bg-link/10 text-xs motion-safe:animate-[ms-pop_.45s_ease-out] sm:inline-flex">
      <a href="#settings/updates" className="inline-flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 font-semibold text-link no-underline hover:bg-link/15" title={tx("Nouvelle version publiée : voir Réglages → Mises à jour")}>
        <span className="relative grid place-items-center">
          {fresh && <span className="absolute h-3.5 w-3.5 rounded-full bg-link/50 motion-safe:animate-ping" aria-hidden />}
          <ArrowUpCircle size={14} aria-hidden />
        </span>{tx("{0} disponible", tag)}
      </a>
      <button type="button" onClick={() => { dismissTag(tag); setHidden(tag); }} aria-label={tx("Masquer pour cette version")} title={tx("Masquer pour cette version")}
        className="grid h-full place-items-center px-1.5 text-dim hover:bg-link/15 hover:text-txt"><X size={12} aria-hidden /></button>
    </span>
  );
}

/** The notice under the header for a few seconds: what « Check now » found (new release or up to date), or a release the automatic check just
 *  brought (once per version) */
function UpdateToast({ news, version, onClose }: Readonly<{ news: UpdateNews; version: string; onClose: () => void }>) {
  useEffect(() => { const t = setTimeout(onClose, news.available ? 9000 : 5000); return () => clearTimeout(t); }, [news]);   // one timer per notice (onClose is a new function on every render)
  const Icon = news.available ? ArrowUpCircle : CheckCircle2;
  return (
    <div role="status" aria-live="polite"
      className={`fixed right-4 top-16 z-50 flex max-w-sm items-start gap-3 rounded-2xl border bg-card p-3.5 pr-2.5 shadow-lg motion-safe:animate-[ms-toast_.4s_cubic-bezier(.2,.9,.3,1.2)] ${news.available ? "border-link/60" : "border-ok/50"}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${news.available ? "bg-link/15 text-link" : "bg-ok/15 text-ok"}`}><Icon size={18} aria-hidden /></span>
      <div className="min-w-0 text-sm">
        <b className="block">{news.available ? tx("Nouvelle version : {0}", news.tag ?? "") : tx("MyServices est à jour")}</b>
        <span className="text-muted">{news.available ? tx("Installée : {0}.", version) : tx("{0} est la dernière version publiée.", news.tag || version)}</span>
        {news.available && <a href="#settings/updates" onClick={onClose} className="mt-1 block font-semibold text-link hover:underline">{tx("Voir la mise à jour")} ›</a>}
      </div>
      <button type="button" onClick={onClose} aria-label={tx("Fermer")} title={tx("Fermer")} className="rounded-md p-1 text-dim hover:bg-bg2 hover:text-txt"><X size={14} aria-hidden /></button>
    </div>
  );
}

/** The header's update notices: the pill (from the snapshot, or from a check just made) and the toast; none when switched off */
function UpdateNotices({ update, version }: Readonly<{ update?: UpdateNews | null; version: string }>) {
  const [checked, setChecked] = useState<UpdateNews | null>(null), [toast, setToast] = useState<UpdateNews | null>(null), [on, setOn] = useState(noticesOn());
  useEffect(() => onCheck((n) => { setChecked(n); if (n.manual || n.available) setToast(n); }), []);
  useEffect(() => onNotices(() => setOn(noticesOn())), []);
  const shown = checked ?? update;
  useEffect(() => {   // a release brought by the automatic check: announced once
    if (!on || checked || !update?.available || !update.tag || announcedTag() === update.tag || dismissedTag() === update.tag) return;
    setToast(update);
  }, [on, checked, update]);
  const close = () => { if (toast?.tag && toast.available) markAnnounced(toast.tag); setToast(null); };
  if (!on) return null;
  return <><UpdatePill update={shown} />{toast && <UpdateToast news={toast} version={version} onClose={close} />}</>;
}

export function Header({ snap, theme, toggleTheme, now, onMenu }: Readonly<{ snap: Snapshot; theme: Theme; toggleTheme: () => void; now: number; onMenu: () => void }>) {
  const stale = (now - new Date(snap.data.generated).getTime()) / 60000 > snap.data.page.stale_min;
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onMenu} aria-label={tx("Ouvrir le menu")} title={tx("Ouvrir le menu")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-muted hover:border-link hover:text-txt md:hidden">
          <Menu size={18} aria-hidden />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-dim">
            <span className={`h-2 w-2 rounded-full ${stale ? "bg-warn" : "bg-ok"}`} />
            <span title={new Date(snap.data.generated).toLocaleString(LOCALE)}>
              {tx("Données")} {ago(snap.data.generated, now)}{stale && tx(" · en retard")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {snap.me.version && <span className="rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-xs font-semibold tracking-normal text-dim" title={snap.me.released && snap.me.version !== "dev" && !/^v\d+\.\d+\.\d+/.test(snap.me.version) ? tx("Image construite depuis une branche, après la version {0} : {1}", snap.me.released, snap.me.version) : snap.me.version}>{appVersion(snap.me.version, snap.me.released)}</span>}
            {snap.me.version === "dev" && <DevState git={snap.me.git} released={snap.me.released} planned={snap.me.planned} />}
          </div>
        </div>
      </div>
      <ScanOrb />
      <div className="col-start-3 flex items-center justify-end gap-3">
        <UpdateNotices update={snap.me.update} version={appVersion(snap.me.version, snap.me.released) || snap.me.version || ""} />
        {snap.me.role === "admin" && <DiscoveryBell machines={snap.data.machine_list} />}
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
          <DropItem icon={theme === "light" ? <Moon size={15} /> : <Sun size={15} />} onClick={toggleTheme}>{tx("Thème")} {theme === "light" ? tx("sombre") : tx("clair")}</DropItem>
          <DropSep />
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-widest text-dim">{tx("Consulter")}</p>
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
