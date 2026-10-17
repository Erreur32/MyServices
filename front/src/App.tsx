import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOGIN, LoginRequired, NotConfigured, RELOAD_EVENT, loadSnapshot, logout, type Snapshot } from "./api";
import { Header } from "./components/Header";
import { Assistant } from "./tabs/Assistant";
import { Home } from "./components/Home";
import { ScanBar } from "./components/ScanBar";
import { Tabs } from "./components/Tabs";
import { TABS, visible } from "./lib/tabs";
import type { Selected } from "./lib/filter";
import { attention, type TabId } from "./lib/summary";
import { Backups } from "./tabs/Backups";
import { Dns } from "./tabs/Dns";
import { Security } from "./tabs/Security";
import { Virtualization } from "./tabs/Virtualization";
import { Network } from "./tabs/Network";
import { Infra } from "./tabs/Infra";
import { History } from "./tabs/History";
import { Machines } from "./tabs/Machines";
import { Services } from "./tabs/Services";
import { Profile } from "./tabs/Profile";
import { Settings } from "./tabs/Settings";
import { DiagramsTab } from "./tabs/DiagramsTab";
import { useContentWidth, useTheme } from "./theme";
import { tx } from "./lib/i18n";
import { GREY_CARDS } from "./lib/forms";

const REFRESH_MS = 60_000;
const FAST_MS = 5_000, FAST_FOR_MS = 150_000;   // after a change: data.json read every 5 s for 2 min 30 (304 when unchanged)

const OLD_TABS: Record<string, string> = { fail2ban: "security", health: "machines" };   // removed tabs, now inside another one

function tabFromHash(): TabId {
  const raw = location.hash.slice(1).split("/")[0];
  const h = (OLD_TABS[raw] ?? raw) as TabId; // « settings/accounts » : onglet puis section ; #fail2ban : ancien onglet, dans Sécurité
  return TABS.some((t) => t.id === h) ? h : "home";
}

export default function App() {
  const [theme, toggleTheme, setTheme] = useTheme();
  const [width, setWidth] = useContentWidth();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<NotConfigured | null>(null);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [hash, setHash] = useState(location.hash); // section des Réglages dans le lien (#settings/api)
  const [now, setNow] = useState(Date.now());
  // Filtre posé en ouvrant Services depuis une machine (clic sur son nom) ; la clé recrée l'onglet
  // Filtre demandé à l'ouverture d'un onglet (clic sur un compteur, sur une machine…) : lu une fois à l'affichage, effacé dès qu'on change d'onglet à la main
  const [pending, setPending] = useState<{ tab: TabId; sel: Selected; n: number }>({ tab: "home", sel: {}, n: 0 });

  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const load = useCallback(() => {
    clearTimeout(retry.current);
    loadSnapshot()
      .then((s) => { setSnap(s); setError(""); setFresh(null); setNow(Date.now()); })
      .catch((e) => {
        if (e instanceof LoginRequired) location.replace(LOGIN);
        else if (e instanceof NotConfigured) setFresh(e);
        else { setError(String(e.message || e)); retry.current = setTimeout(load, 4000); }  // serveur qui redémarre : on réessaie vite, l'alerte disparaît toute seule
      });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);   // rien quand l'onglet est masqué
    const onHash = () => {   // ancienne page « Installation » -> assistant
      if (location.hash.startsWith("#setup")) location.replace("#assistant");
      setTab(tabFromHash());
      setHash(location.hash);
    };
    onHash();
    addEventListener("hashchange", onHash);
    let fast: ReturnType<typeof setInterval> | undefined, stop: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      load();
      clearInterval(fast); clearTimeout(stop);
      fast = setInterval(() => { if (!document.hidden) load(); }, FAST_MS);
      stop = setTimeout(() => clearInterval(fast), FAST_FOR_MS);
    };
    addEventListener(RELOAD_EVENT, changed);
    return () => { clearInterval(id); clearInterval(fast); clearTimeout(stop); removeEventListener("hashchange", onHash); removeEventListener(RELOAD_EVENT, changed); };
  }, [load]);

  const go = (t: TabId) => { location.hash = t === "home" ? "" : t; setTab(t); setPending((f) => ({ tab: "home", sel: {}, n: f.n })); scrollTo({ top: 0 }); };
  const goFilter = (t: TabId, sel: Selected) => { go(t); setPending((f) => ({ tab: t, sel, n: f.n + 1 })); };
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

  const items = attention({ ...snap, now });
  const badges: Partial<Record<TabId, "crit" | "warn">> = {};
  for (const a of items) if (badges[a.tab] !== "crit") badges[a.tab] = a.level;
  const current = visible(tab, snap) ? tab : "home";
  if (hash.startsWith("#assistant") && snap.me.role === "admin") return <><ScanBar onFinished={load} /><Assistant snap={snap} /></>;
  const profile = hash.startsWith("#profile"); // page à part (tout compte), indépendante des Réglages et de la gestion des comptes

  return (
    <div className="mx-auto max-w-[var(--content-max)] px-4 pb-10 sm:px-6">
      <ScanBar onFinished={load} />
      <Header snap={snap} theme={theme} toggleTheme={toggleTheme} now={now} />
      {error && <p className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{tx("⚠ Mise à jour impossible :")} {error}</p>}
      <div className={GREY_CARDS}>
      {profile ? (
        <>
          <a href="#" className="group mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-2.5 pr-4 text-sm font-semibold text-muted transition-colors hover:border-link hover:text-txt">
            <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{tx("Retour")}
          </a>
          <Profile username={snap.me.username} role={snap.me.role} email={snap.me.email ?? ""} avatar={snap.me.avatar ?? null} look={{ theme, setTheme, width, setWidth }} />
        </>
      ) : <Tabs tab={current} snap={snap} badges={badges} onSelect={go} />}
      {!profile && current === "home" && <Home snap={snap} items={items} go={go} goFilter={goFilter} now={now} />}
      {current === "history" && <History snap={snap} />}
      {current === "machines" && <Machines key={pending.tab === "machines" ? pending.n : 0} snap={snap} initial={initialFor("machines")} onMachine={(ip) => goFilter("services", { machine: [ip] })} onFilter={(sel) => goFilter("services", sel)} />}
      {current === "services" && <Services key={pending.tab === "services" ? pending.n : 0} snap={snap} initial={initialFor("services")} />}
      {current === "infra" && <Infra snap={snap} />}
      {current === "dns" && <Dns key={pending.tab === "dns" ? pending.n : 0} snap={snap} initial={initialFor("dns")} />}
      {current === "backups" && <Backups key={pending.tab === "backups" ? pending.n : 0} snap={snap} initial={initialFor("backups")} />}
      {current === "diagrams" && <DiagramsTab admin={snap.me.role === "admin"} />}
      {current === "settings" && <Settings key={hash} snap={snap} />}
      {current === "security" && <Security snap={snap} />}
      {current === "virtualization" && <Virtualization snap={snap} onMachine={(ip) => goFilter("services", { machine: [ip] })} />}
      {current === "network" && <Network snap={snap} onMachine={(ip) => goFilter("services", { machine: [ip] })} />}
      </div>
    </div>
  );
}
