import { useCallback, useEffect, useRef, useState } from "react";
import { LOGIN, LoginRequired, NotConfigured, RELOAD_EVENT, loadSnapshot, logout, type Snapshot } from "./api";
import { Header } from "./components/Header";
import { Assistant } from "./tabs/Assistant";
import { Home } from "./components/Home";
import { ScanBar } from "./components/ScanBar";
import { Sidebar } from "./components/Sidebar";
import { tabFromHash, visible } from "./lib/tabs";
import type { Selected } from "./lib/filter";
import { attention, type TabId } from "./lib/summary";
import { Backups } from "./tabs/Backups";
import { Dns } from "./tabs/Dns";
import { Security } from "./tabs/Security";
import { Virtualization } from "./tabs/Virtualization";
import { Network } from "./tabs/Network";
import { Infra } from "./tabs/Infra";
import { Machines } from "./tabs/Machines";
import { Services } from "./tabs/Services";
import { Profile } from "./tabs/Profile";
import { Settings } from "./tabs/Settings";
import { DiagramsTab } from "./tabs/DiagramsTab";
import { Help } from "./tabs/Help";
import { AboutSettings } from "./tabs/About";
import { SidePage } from "./components/SidePage";
import { useTheme } from "./theme";
import { tx } from "./lib/i18n";
import { onStream, streamConnected } from "./lib/stream";
import { GREY_CARDS } from "./lib/forms";
import { isHidden, useServicesHidden } from "./lib/servicesHidden";

const REFRESH_MS = 15_000;      // without the event stream: one small manifest request, the files that moved are read again
const STREAM_REFRESH_MS = 120_000;   // with the stream, which says when a file moved: a safety read only

/** Pages à part comme #profile : pas d'onglet, pas de barre */
const SIDE_PAGES: Record<string, { admin?: boolean; render: (snap: Snapshot) => React.ReactNode }> = {
  help: { render: () => <Help /> },
  about: { render: (snap) => <AboutSettings snap={snap} /> },
};

export default function App() {
  const [theme, toggleTheme, setTheme] = useTheme();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<NotConfigured | null>(null);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [hash, setHash] = useState(location.hash); // section des Réglages dans le lien (#settings/api)
  const [now, setNow] = useState(Date.now());
  const hiddenServices = useServicesHidden();
  const [menuOpen, setMenuOpen] = useState(false);   // the menu drawer, on a phone
  // Filtre posé en ouvrant Services depuis une machine (clic sur son nom) ; la clé recrée l'onglet
  // Filtre demandé à l'ouverture d'un onglet (clic sur un compteur, sur une machine…) : lu une fois à l'affichage, effacé dès qu'on change d'onglet à la main
  const [pending, setPending] = useState<{ tab: TabId; sel: Selected; n: number }>({ tab: "home", sel: {}, n: 0 });

  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastLoad = useRef(0);
  const load = useCallback((stamps?: Record<string, string>) => {
    clearTimeout(retry.current);
    lastLoad.current = Date.now();
    loadSnapshot(stamps)
      .then((s) => { setSnap((cur) => (cur === s ? cur : s)); setError(""); setFresh(null); setNow(Date.now()); })
      .catch((e) => {
        if (e instanceof LoginRequired) location.replace(LOGIN);
        else if (e instanceof NotConfigured) setFresh(e);
        else { setError(String(e.message || e)); retry.current = setTimeout(load, 4000); }  // serveur qui redémarre : on réessaie vite, l'alerte disparaît toute seule
      });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {   // rien quand l'onglet est masqué ; avec le flux, seulement une lecture de sûreté
      if (!document.hidden && (!streamConnected() || Date.now() - lastLoad.current > STREAM_REFRESH_MS)) load();
    }, REFRESH_MS);
    const shown = () => { if (!document.hidden) load(); };   // back on the tab: read now, not at the next tick
    document.addEventListener("visibilitychange", shown);
    const offManifest = onStream("manifest", (stamps) => { if (!document.hidden) load(stamps as Record<string, string>); });
    const offOpen = onStream("open", () => load());   // (re)connected: catch up with what may have moved meanwhile
    const onHash = () => {   // ancienne page « Installation » -> assistant
      if (location.hash.startsWith("#setup")) location.replace("#assistant");
      else if (location.hash === "#audit" || location.hash === "#logs") location.replace(`#settings/requests/${location.hash.slice(1)}`);   // old pages apart, now sub-tabs of Settings → Requests and logs
      setTab(tabFromHash());
      setHash(location.hash);
    };
    onHash();
    addEventListener("hashchange", onHash);
    const changed = () => load();   // after a change: read now; the 15 s manifest ticks follow the pass it may have started
    addEventListener(RELOAD_EVENT, changed);
    return () => { clearInterval(id); offManifest(); offOpen(); document.removeEventListener("visibilitychange", shown); removeEventListener("hashchange", onHash); removeEventListener(RELOAD_EVENT, changed); };
  }, [load]);

  const go = (t: TabId) => { location.hash = t === "home" ? "" : t; setTab(t); setPending((f) => ({ tab: "home", sel: {}, n: f.n })); scrollTo({ top: 0 }); };
  const goFilter = (t: TabId, sel: Selected) => { go(t); setPending((f) => ({ tab: t, sel, n: f.n + 1 })); };
  const navigated = () => { setPending((f) => ({ tab: "home", sel: {}, n: f.n })); setMenuOpen(false); scrollTo({ top: 0 }); };   // a menu link: the address does the rest
  const initialFor = (t: TabId): Selected => (pending.tab === t ? pending.sel : {});

  if (!snap && fresh)
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <section className="rounded-2xl border border-line bg-card p-6">
          <h1 className="text-xl font-bold">{tx("Bienvenue,")} {fresh.me.username}</h1>
          <p className="mt-3 leading-relaxed text-muted">
            {tx("Ton compte est prêt. MyServices n'a encore rien collecté : aucune machine n'est configurée.")}
          </p>
          <p className="mt-3 leading-relaxed text-muted">
            {tx("La configuration depuis la page (Réglages → Machines) arrive avec les prochains onglets. Cette page se remplira toute seule après la première collecte.")}
          </p>
          <button type="button" onClick={() => void logout()} className="mt-5 text-sm text-link hover:underline">{tx("Se déconnecter")}</button>
        </section>
      </main>
    );
  if (!snap)
    return <p className="p-8 text-muted">{error ? `⚠ ${error}` : tx("Chargement…")}</p>;

  const items = attention({ ...snap, data: { ...snap.data, hosts: snap.data.hosts.filter((r) => !isHidden(r, hiddenServices)) }, now });   // a service hidden from « To watch » leaves the tab's dot and the home page too
  const badges: Partial<Record<TabId, "crit" | "warn">> = {};
  const why: Partial<Record<TabId, string[]>> = {};   // the alerts behind each dot, listed in its tooltip
  for (const a of items) { if (badges[a.tab] !== "crit") badges[a.tab] = a.level; (why[a.tab] ??= []).push(a.text); }
  const current = visible(tab, snap) ? tab : "home";
  if (hash.startsWith("#assistant") && snap.me.role === "admin") return <><ScanBar onFinished={load} /><Assistant snap={snap} /></>;
  const profile = hash.startsWith("#profile"); // page à part (tout compte), indépendante des Réglages et de la gestion des comptes
  const sideId = Object.keys(SIDE_PAGES).find((k) => hash.startsWith(`#${k}`));
  const side = sideId && (!SIDE_PAGES[sideId].admin || snap.me.role === "admin") ? SIDE_PAGES[sideId] : null; // a non-admin typing an admin-only page comes back to home

  let top: React.ReactNode = null;   // a page apart (Profile, Help, About) with its « Back » link
  if (profile) top = <SidePage><Profile username={snap.me.username} role={snap.me.role} email={snap.me.email ?? ""} mailReady={snap.me.mail_ready !== false} mailError={snap.me.mail_error ?? ""} avatar={snap.me.avatar ?? null} look={{ theme, setTheme }} /></SidePage>;
  else if (side) top = <SidePage>{side.render(snap)}</SidePage>;
  let homeSub: "history" | "stats" | "overview" = "overview";
  if (hash.startsWith("#history")) homeSub = "history";
  else if (hash.startsWith("#stats")) homeSub = "stats";

  return (
    <div className="flex min-h-screen">
      <Sidebar snap={snap} badges={badges} why={why} onNavigate={navigated} mobileOpen={menuOpen} onClose={() => setMenuOpen(false)}
        onBadge={(t) => { setMenuOpen(false); if (t === "machines") goFilter("machines", { alert: ["bad", "warn"] }); else if (t === "backups" || t === "dns") goFilter(t, { alerts: ["on"] }); else if (t === "services") goFilter(t, { alert: ["on"] }); else go(t); }} />
      <div className="min-w-0 flex-1 px-4 pb-10 sm:px-6">
      <ScanBar onFinished={load} />
      <Header snap={snap} theme={theme} toggleTheme={toggleTheme} now={now} onMenu={() => setMenuOpen(true)} />
      {error && <p className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{tx("⚠ Mise à jour impossible :")} {error}</p>}
      <div className={GREY_CARDS}>
      {top}
      {!profile && !side && current === "home" && <Home snap={snap} items={items} go={go} goFilter={goFilter} now={now} sub={homeSub} />}
      {current === "machines" && <Machines key={pending.tab === "machines" ? pending.n : 0} snap={snap} initial={initialFor("machines")} onMachine={(ip) => goFilter("services", { machine: [ip] })} onFilter={(sel) => goFilter("services", sel)} />}
      {current === "services" && <Services key={pending.tab === "services" ? pending.n : 0} snap={snap} initial={initialFor("services")} route={hash} />}
      {current === "infra" && <Infra snap={snap} />}
      {current === "dns" && <Dns key={pending.tab === "dns" ? pending.n : 0} snap={snap} initial={initialFor("dns")} />}
      {current === "backups" && <Backups key={pending.tab === "backups" ? pending.n : 0} snap={snap} initial={initialFor("backups")} route={hash} />}
      {current === "diagrams" && <DiagramsTab admin={snap.me.role === "admin"} />}
      {current === "settings" && <Settings key={hash} snap={snap} />}
      {current === "security" && <Security snap={snap} route={hash} />}
      {current === "virtualization" && <Virtualization snap={snap} onMachine={(ip) => goFilter("services", { machine: [ip] })} />}
      {current === "network" && <Network snap={snap} route={hash} onMachine={(ip) => goFilter("services", { machine: [ip] })} />}
      </div>
      </div>
    </div>
  );
}
