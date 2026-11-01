// Home page: a sentence that tells the state of the network with the machines to watch beside it, the key figures, « À traiter maintenant » (every
// alert with what to do and the buttons that lead there), the last day and the next tasks, then every counter. A first visit has its own welcome.
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleCheck, Globe, HardDrive, HeartPulse, Monitor, Plug, Shield, Siren, Sparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Snapshot } from "../api";
import { hm, longDay } from "../lib/format";
import type { Selected } from "../lib/filter";
import { tx } from "../lib/i18n";
import { appIcon, appIconByText } from "../lib/appIcons";
import { pointConnectors } from "../lib/connectorPrefill";
import { fleet, homeStory, installTools, type InstallTool, type Tone } from "../lib/homeStory";
import { plural, type Attention, type Category, type TabId } from "../lib/summary";
import { History } from "../tabs/History";
import { AssistantBanner } from "./AssistantBanner";
import { DiscoveryReminder } from "./DiscoveryCard";
import { LastDay } from "./LastDay";
import { Missing } from "./Missing";
import { Rich } from "./Rich";
import { ScheduleCard } from "./ScheduleCard";
import { FOLD_HEADER, foldHeaderProps } from "../lib/foldHeader";
import { useStoredFlag } from "../lib/storedFlag";
import { Counters, KeyFigures } from "./StatsPage";

/** Lines shown before « Tout voir » */
const LIMIT = 8;
const KIND: Record<Category, { label: string; Icon: LucideIcon; tint: string; help: string }> = {
  machines: { label: tx("Machines"), Icon: Monitor, tint: "bg-link/10 text-link", help: tx("Vérifie qu'elle est allumée et branchée. Si elle est souvent éteinte, indique-le dans ses réglages.") },
  services: { label: tx("Services"), Icon: Globe, tint: "bg-loc/10 text-loc", help: tx("Vérifie que le service tourne sur sa machine. S'il est arrêté exprès, mets-le en pause dans ses réglages.") },
  sante: { label: tx("Santé"), Icon: HeartPulse, tint: "bg-ok/10 text-ok", help: tx("Si c'est normal pour cette machine, ajuste ses seuils dans Régler.") },
  dns: { label: tx("DNS"), Icon: Shield, tint: "bg-npm/10 text-npm", help: tx("Un domaine ou un serveur DNS n'est plus d'accord avec le reste : le détail est sur la page DNS.") },
  sauvegardes: { label: tx("Sauvegardes"), Icon: HardDrive, tint: "bg-apache/10 text-apache", help: tx("Vérifie que la copie a bien tourné. Si elle passe moins souvent, règle son rythme dans le jeu.") },
  connecteurs: { label: tx("Connecteurs"), Icon: Plug, tint: "bg-muted/10 text-muted", help: tx("MyServices n'arrive plus à lire cet outil : vérifie son adresse et son accès.") },
};
const ACT = "inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors";
const QUIET = `${ACT} border border-line bg-bg2 text-txt no-underline hover:border-link hover:text-link`;
const FILL = `${ACT} bg-accent text-white no-underline hover:brightness-110`;
const DOT: Record<Tone | "off", string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", off: "border-2 border-dim" };
const TITLE_TONE: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** A line leads to the exact address it names, else to its tab filtered on what it talks about, else to the tab */
export function openAttention(it: Attention, go: (t: TabId) => void, goFilter: (t: TabId, sel: Selected) => void): void {
  if (it.href) location.hash = it.href;
  else if (it.sel) goFilter(it.tab, it.sel);
  else go(it.tab);
}

/** « 12 machines, 41 services, 6 jeux de sauvegarde suivis » */
export function followedLine(snap: Snapshot): string {
  const parts = [tx("{0} machine(s)", snap.data.machine_list.filter((m) => !m.disabled).length), tx("{0} service(s)", snap.data.hosts.filter((r) => r.enabled).length)];
  if (snap.backups) parts.push(tx("{0} jeu(x) de sauvegarde", snap.backups.summary.sets));
  return tx("{0} suivis", parts.join(", "));
}

function Badge({ category, n }: Readonly<{ category: Category; n?: number }>) {
  const { label, Icon, tint } = KIND[category];
  return <span className={`inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold ${tint}`}><Icon size={14} aria-hidden />{label}{n != null && <span className="font-mono">{n}</span>}</span>;
}

function Line({ it, admin, go, goFilter }: Readonly<{ it: Attention; admin: boolean; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }>) {
  const crit = it.level === "crit", fix = admin ? it.fix : undefined;
  return (
    <li className="grid items-center gap-x-3 gap-y-1.5 rounded-xl bg-bg/60 px-3 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
      <Badge category={it.category} />
      <div className="min-w-0">
        <p className="flex items-start gap-2 text-sm font-semibold text-txt">
          <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${crit ? "bg-bad" : "bg-warn"}`} />
          <span className="min-w-0"><Rich text={it.text} /></span>
        </p>
        <p className="mt-0.5 text-[13px] text-muted">{KIND[it.category].help}</p>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        <button type="button" onClick={() => openAttention(it, go, goFilter)} className={!fix && crit ? FILL : QUIET}>{it.action}</button>
        {fix && <a href={`#${fix.href}`} className={FILL}>{fix.label}</a>}
      </div>
    </li>
  );
}

export type HomeSub = "overview" | "history";

const FRAME = { bad: "border-l-4 border-l-bad border-bad/40", warn: "border-l-4 border-l-warn border-warn/40", ok: "border-ok/40" };

/** The badges above the list, one per category with its count: a click keeps that category alone */
function CategoryFilter({ cats, items, only, setOnly }: Readonly<{ cats: Category[]; items: Attention[]; only: Category | null; setOnly: (c: Category | null) => void }>) {
  return (
    <fieldset className="flex flex-wrap gap-1.5 px-1 pb-1" aria-label={tx("Filtrer par catégorie")}>
      {cats.map((c) => (
        <button key={c} type="button" aria-pressed={only === c} onClick={() => setOnly(only === c ? null : c)} className={`rounded-md ring-1 ${only === c ? "ring-link" : "ring-transparent"}`}>
          <Badge category={c} n={items.filter((i) => i.category === c).length} />
        </button>
      ))}
    </fieldset>
  );
}

/** The title line of « À traiter maintenant »: its count and, with something to do, a click folds the list */
function ToDealHead({ count, crit, folded, toggle }: Readonly<{ count: number; crit: boolean; folded: boolean; toggle: () => void }>) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 ${count ? FOLD_HEADER : ""}`} {...(count ? foldHeaderProps(toggle) : {})}>
      {count > 0
        ? <span className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-2 text-sm font-bold leading-none text-bg ${crit ? "bg-bad" : "bg-warn"}`}>{count}</span>
        : <CircleCheck size={22} className="shrink-0 text-ok" aria-hidden />}
      <h2 className={`text-lg font-bold ${count ? "" : "text-ok"}`}>{count ? tx("À traiter maintenant") : tx("Rien à traiter")}</h2>
      {count > 0 && <Siren size={18} className="ml-auto shrink-0 text-dim" aria-hidden />}
      {count > 0 && (
        <button type="button" className="text-dim hover:text-txt" aria-expanded={!folded} onClick={toggle} title={folded ? tx("Déplier") : tx("Replier")}>
          {folded ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
        </button>
      )}
    </div>
  );
}

/** « À traiter maintenant »: every alert with what to do; its badges filter the list; folds to its title and count (folded until opened), the choice kept in this browser */
function ToDeal({ items, admin, go, goFilter }: Readonly<{ items: Attention[]; admin: boolean; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void }>) {
  const [all, setAll] = useState(false);
  const [only, setOnly] = useState<Category | null>(null);
  const [folded, setFolded] = useStoredFlag("myservices.home.todo.folded", true);
  const cats = [...new Set(items.map((i) => i.category))];
  const kept = only && cats.includes(only) ? items.filter((i) => i.category === only) : items;
  const shown = all ? kept : kept.slice(0, LIMIT);
  const crit = items.some((i) => i.level === "crit");
  let tone: keyof typeof FRAME = "ok";
  if (items.length) tone = crit ? "bad" : "warn";
  const frame = FRAME[tone];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`} aria-label={tx("À traiter maintenant")}>
      <ToDealHead count={items.length} crit={crit} folded={folded} toggle={() => setFolded(!folded)} />
      {items.length > 0 && !folded && (
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          {cats.length > 1 && <CategoryFilter cats={cats} items={items} only={only} setOnly={setOnly} />}
          <ol className="flex flex-col gap-1">{shown.map((it) => <Line key={`${it.category}/${it.text}`} it={it} admin={admin} go={go} goFilter={goFilter} />)}</ol>
          {kept.length > LIMIT && (
            <button type="button" onClick={() => setAll(!all)} aria-expanded={all}
              className="mx-auto mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-bg2 px-3 py-1 text-xs font-semibold text-muted hover:border-link hover:text-link">
              {all ? tx("Réduire") : tx("Tout voir ({0})", kept.length)}{all ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The machines shown live: those to watch first, with the state the pulse keeps up to date */
function Fleet({ snap }: Readonly<{ snap: Snapshot }>) {
  const { rows, total } = fleet(snap);
  return (
    <aside className="rounded-2xl border border-line bg-card/70 p-4 shadow-sm" aria-label={tx("Ton parc en direct")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold">{tx("Ton parc en direct")}</h2>
        <a href="#machines" className="whitespace-nowrap text-xs font-semibold">{tx("Voir les {0} machines", total)}</a>
      </div>
      <ul className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
        {rows.map(({ machine: m, tone, note }) => (
          <li key={m.ip} className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tone]}`} />
            <a href={`#machines/${m.ip}`} className="min-w-0 flex-1 truncate text-txt no-underline hover:text-link">{m.name}</a>
            <span className="shrink-0 text-xs text-dim">{note}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Hero({ snap, items, now }: Readonly<{ snap: Snapshot; items: Attention[]; now: number }>) {
  const day = longDay(now), story = homeStory(snap, items);
  return (
    <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div>
        <p className="text-sm text-dim">{day.charAt(0).toUpperCase() + day.slice(1)}, {hm(now)} · {followedLine(snap)}</p>
        <h1 className={`mt-1 text-3xl font-extrabold leading-tight sm:text-4xl ${TITLE_TONE[story.tone]}`}>{story.title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{story.text}</p>
      </div>
      <Fleet snap={snap} />
    </section>
  );
}

/** One tool of « Ton installation »: its logo, its name, how many connectors read it and whether they answer; a click opens its connector */
function InstallLine({ tool: t, admin }: Readonly<{ tool: InstallTool; admin: boolean }>) {
  const logo = appIcon([t.label, t.type]) ?? appIconByText(t.label, t.type);
  const body = (
    <>
      {logo ? <img src={logo} alt="" className="h-4 w-4 shrink-0" /> : <Plug size={14} className="shrink-0 text-muted" aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-sm text-txt">{t.label}</span>
      {t.count > 1 && <span className="shrink-0 font-mono text-xs text-dim">×{t.count}</span>}
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.failing ? "bad" : "ok"]}`} />
    </>
  );
  const frame = `flex items-center gap-2 rounded-lg border bg-bg2 px-2 py-1 no-underline ${t.failing ? "border-bad/60" : "border-line"}`, title = t.lines.join("\n");
  return admin
    ? <a href="#settings/connectors" onClick={() => pointConnectors([t.type])} title={title} className={`${frame} hover:border-link`}>{body}</a>
    : <div title={title} className={frame}>{body}</div>;
}

/** « Ton installation »: every tool MyServices brings together */
function Install({ snap }: Readonly<{ snap: Snapshot }>) {
  const tools = installTools(snap), failing = tools.reduce((n, t) => n + t.failing, 0), total = tools.reduce((n, t) => n + t.count, 0);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm" aria-label={tx("Ton installation")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 bg-bg px-5 py-3">
        <h2 className="text-base font-bold">{tx("Ton installation")}</h2>
        <span className="text-xs text-dim">{tx("{0} connecteurs", total)} · <span className={failing ? "font-semibold text-bad" : "text-ok"}>{failing ? tx("{0} en erreur", failing) : tx("tout répond")}</span></span>
        <a href="#settings/connectors" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold">{tx("Gérer")}<ArrowRight size={13} aria-hidden /></a>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm text-muted">{tx("MyServices relie {0} que tu utilises déjà. Il ne les remplace pas, il les réunit sur une seule page.", plural(tools.length, "outil"))}</p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {tools.map((t) => <li key={t.type} className="min-w-0"><InstallLine tool={t} admin={snap.me.role === "admin"} /></li>)}
        </ul>
      </div>
    </section>
  );
}

/** First visit (an administrator, nothing but this machine followed): what MyServices brings and the steps to get there */
function Welcome() {
  const steps = [
    { title: tx("Installer MyServices"), text: tx("C'est fait : ton compte administrateur est créé et cette machine est suivie."), done: true },
    { title: tx("Ajouter tes machines"), text: tx("Un agent léger ou un accès SSH, au choix. L'assistant te guide et te donne la commande à copier."), href: "#settings/machines", action: tx("Ajouter une machine") },
    { title: tx("Brancher tes outils"), text: tx("Proxmox, Docker, Nginx Proxy Manager, AdGuard : MyServices repère ceux qui tournent déjà et te propose de les relier."), href: "#settings/connectors", action: tx("Voir les connecteurs") },
  ];
  const gains: [LucideIcon, string, string][] = [
    [Monitor, tx("Tes machines en direct"), tx("Qui répond, ce qui chauffe, quel disque se remplit, ce qui attend une mise à jour.")],
    [Globe, tx("Tous tes services"), tx("Sites, conteneurs et ports réunis, avec une alerte quand l'un d'eux tombe.")],
    [HardDrive, tx("Des sauvegardes vérifiées"), tx("La date de chaque copie est contrôlée, pour savoir qu'elle existe vraiment ailleurs.")],
    [Shield, tx("Ton réseau sous contrôle"), tx("Appareils connectés, DNS, certificats et nouveautés apparues dans la nuit.")],
    [HeartPulse, tx("Un historique clair"), tx("Ce qui a changé depuis hier, raconté en phrases, sans fouiller les journaux.")],
    [Sparkles, tx("Ton assistant IA branché"), tx("Pose tes questions à ton IA : elle lit ton parc avec le serveur MCP intégré.")],
  ];
  return (
    <>
      <section className="max-w-3xl">
        <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">{tx("Tout ton réseau, enfin sur une seule page.")}</h1>
        <p className="mt-3 text-[17px] leading-relaxed text-muted">{tx("Tes machines, tes sites, tes sauvegardes et ton réseau sont éparpillés dans dix interfaces. MyServices les relie et te dit en une phrase ce qui va bien, ce qui cloche et comment le régler. Il garde tes outils et ne touche à rien sans ton accord.")}</p>
        <a href="#assistant" className={`${FILL} mt-4 px-4 py-2 text-sm`}>{tx("Démarrer l'assistant")}</a>
      </section>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col items-start gap-2 rounded-2xl border border-line bg-card/70 p-4">
            {s.done ? <CheckCircle2 size={26} className="text-ok" aria-hidden /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-link/10 text-sm font-bold text-link">{i + 1}</span>}
            <h2 className="text-base font-bold">{s.title}</h2>
            <p className="flex-1 text-sm text-muted">{s.text}</p>
            {s.href && <a href={s.href} className={QUIET}>{s.action}</a>}
          </li>
        ))}
      </ol>
      <section className="overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm" aria-label={tx("Ce que tu vas obtenir")}>
        <h2 className="border-b border-line/60 bg-bg px-5 py-3 text-base font-bold">{tx("Ce que tu vas obtenir")}</h2>
        <div className="grid gap-x-6 gap-y-4 p-5 md:grid-cols-3">
          {gains.map(([Icon, title, text]) => (
            <div key={title}>
              <h3 className="flex items-center gap-2 text-sm font-bold"><Icon size={16} className="text-link" aria-hidden />{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function Home({ snap, items, go, goFilter, now, sub = "overview" }: Readonly<{ snap: Snapshot; items: Attention[]; go: (t: TabId) => void; goFilter: (t: TabId, sel: Selected) => void; now: number; sub?: HomeSub }>) {
  const admin = snap.me.role === "admin";
  if (sub === "history") return <div className="flex flex-col gap-5 py-5"><History snap={snap} /></div>;
  if (admin && snap.data.machine_list.filter((m) => !m.disabled).length <= 1)
    return <div className="flex flex-col gap-5 py-5"><AssistantBanner snap={snap} /><Welcome /></div>;
  return (
    <div className="flex flex-col gap-5 py-5">
      {admin && <AssistantBanner snap={snap} />}
      <Hero snap={snap} items={items} now={now} />
      <KeyFigures snap={snap} go={go} />
      <ToDeal items={items} admin={admin} go={go} goFilter={goFilter} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <LastDay snap={snap} go={go} now={now} />
        <ScheduleCard />
      </div>
      <Counters snap={snap} go={go} goFilter={goFilter} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Install snap={snap} />
        {admin && <Missing snap={snap} />}
      </div>
      {admin && <DiscoveryReminder machines={snap.data.machine_list} />}
    </div>
  );
}
