import { ChevronDown, ExternalLink, ListChecks, LogOut, Map, Moon, Settings, Sun, UserRound, Workflow } from "lucide-react";
import { useDiagrams } from "./Diagrams";
import { DiscoveryBell } from "./DiscoveryCard";
import { useEffect, useRef, useState } from "react";
import { logout, ROOT, type Snapshot } from "../api";
import { HEADER_LOGOS, useHeaderLogo, type Theme } from "../theme";
import { LOCALE, tx } from "../lib/i18n";
import { appVersion } from "../lib/format";
import { reopenFirstSteps } from "../lib/firstSteps";
import { GITHUB } from "../lib/links";
import { lastSettingsSection } from "../lib/settingsNav";

function ago(iso: string, now: number): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  return min < 1 ? tx("à l'instant") : min < 60 ? tx("il y a {0} min", min) : tx("il y a {0} h", Math.round(min / 60));
}

export function Header({ snap, theme, toggleTheme, now }: { snap: Snapshot; theme: Theme; toggleTheme: () => void; now: number }) {
  const stale = (now - new Date(snap.data.generated).getTime()) / 60000 > snap.data.page.stale_min;
  const logo = useHeaderLogo();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 py-4">
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
          {snap.me.version === "dev" && (snap.me.git || snap.me.planned) && (
            <span className="text-xs font-normal tracking-normal text-dim" title={tx("Image de développement : état git d'où elle vient, et version prévue d'après le journal des changements")}>
              {snap.me.git && <>git <code className="font-mono text-muted">{snap.me.git}</code></>}{snap.me.git && snap.me.planned && " · "}{snap.me.planned && <>{tx("prévue")} <code className="font-mono text-link">{snap.me.planned}</code></>}
            </span>
          )}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {snap.me.role === "admin" && <DiscoveryBell />}
        <UserMenu snap={snap} theme={theme} toggleTheme={toggleTheme} />
      </div>
    </header>
  );
}

/** Menu du compte, à droite : rôle, réglages, profil, thème, liens (carte, ancienne page, projet), déconnexion. */
function UserMenu({ snap, theme, toggleTheme }: { snap: Snapshot; theme: Theme; toggleTheme: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("mousedown", away);
    addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", away); removeEventListener("keydown", esc); };
  }, [open]);
  const admin = snap.me.role === "admin";
  const [diagrams] = useDiagrams(open);  // chargés à l'ouverture du menu
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-bg2 hover:text-txt";
  const go = (hash: string) => { location.hash = hash; setOpen(false); };
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3 text-sm font-semibold text-txt hover:border-link">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-link/20 text-link"><UserRound size={15} /></span>
        {snap.me.username}
        <ChevronDown size={14} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-card p-1.5 shadow-xl shadow-black/30">
          <div className="px-3 py-2">
            <div className="font-semibold">{snap.me.username}</div>
            <div className="text-xs text-dim">{admin ? tx("admin : tout, réglages compris") : tx("lecture seule")}</div>
          </div>
          <div className="my-1 border-t border-line/70" />
          {admin && <button type="button" role="menuitem" className={item} onClick={() => go(lastSettingsSection() ? `settings/${lastSettingsSection()}` : "settings")}><Settings size={15} />{tx("Réglages")}</button>}
          <button type="button" role="menuitem" className={item} onClick={() => go("profile")}><UserRound size={15} />{tx("Profil")}</button>
          {admin && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); reopenFirstSteps(); }} title={tx("Rouvre la carte et efface vos choix « Passer »")}><ListChecks size={15} />{tx("Revoir les premiers pas")}</button>}
          <button type="button" role="menuitem" className={item} onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}{tx("Thème")} {theme === "dark" ? tx("clair") : tx("sombre")}
          </button>
          <div className="my-1 border-t border-line/70" />
          <button type="button" role="menuitem" className={item} onClick={() => go("diagrams")}><Workflow size={15} />{tx("Tous les schémas")}</button>
          {(diagrams?.diagrams ?? []).filter((d) => d.exists && d.available).map((d) => (
            <a key={d.id} role="menuitem" className={`${item} pl-9`} href={`${ROOT}${d.file}`} target="_blank" rel="noopener" title={d.what}><Map size={14} aria-hidden />{d.title}</a>
          ))}
          <a role="menuitem" className={item} href={GITHUB} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} />{tx("Projet sur GitHub")}
          </a>
          <div className="my-1 border-t border-line/70" />
          <button type="button" role="menuitem" className={`${item} hover:text-bad`} onClick={() => void logout()}><LogOut size={15} />{tx("Se déconnecter")}</button>
        </div>
      )}
    </div>
  );
}
