// DNS in « state » mode: four figures, then two sub-pages. Servers holds what asks for an action: the sync, Cloudflare and instance cards, and
// the table comparing each name, whose alerts are the page's. Details holds the rest: the sources of the check, the rewrites and the machine names.
// Without a DNS tool wired the page stays: the server asks the resolvers of the container.
import { Cloud, ListChecks, Network as NetworkIcon, RefreshCw, Server } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Snapshot } from "../api";
import type { Dns, Rewrite } from "../types";
import { dnsSync } from "../lib/status";
import type { Selected } from "../lib/filter";
import { Badge, ChipButton, Dim, Empty, TableCard, type Tone } from "../components/ui";
import { LABEL_BAND } from "../components/DetailSection";
import { appIcon, dnsHostIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { hm } from "../lib/format";
import { usePageView, useRoute } from "../lib/route";
import { StatTile } from "../components/StatTile";
import { HistoryTile, useDnsHistory } from "../components/HistoryTile";
import { BandwidthTile } from "../components/BandwidthTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import type { Period } from "../lib/tileHistory";
import { dnsFigures, dnsWatch, npmList, serverList, serverUp, type DnsFigures } from "../lib/dnsState";
import { cloudCounts, compareKey, dnsCompare, isAlert, machineRanks, type CloudState, type CompareRow } from "../lib/dnsCompare";
import { useSort } from "../lib/filter";
import { cloudflareZones } from "../lib/cloudflare";
import { HeadTags } from "../components/HeadTags";
import { ConnectorsLink, PageHead } from "../components/PageHead";

type RowTone = "ok" | "warn" | "bad";
type Row = [label: string, value: string, tone?: RowTone];
const TEXT: Record<RowTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** Card of the page header (synchronisation, one per AdGuard server): coloured strip with icon, title, address and state, then label/value rows
 *  in two aligned columns separated by thin lines. */
function InfoCard({ icon, title, sub, tone, state, rows, note }: Readonly<{ icon: ReactNode; title: string; sub?: string; tone: RowTone; state?: string; rows: Row[]; note?: string }>) {
  const strip = "border-b border-line/60 bg-bg", frame = { ok: "border-line", warn: "border-warn/50", bad: "border-bad/50" }[tone];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${strip}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-bg2">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold leading-tight">{title}</h3>
          {sub && <span className="block truncate font-mono text-xs text-dim">{sub}</span>}
        </div>
        {state && <Badge tone={tone}>{state}</Badge>}
      </div>
      <dl className="divide-y divide-line/60 text-sm">
        {rows.map(([k, v, t]) => (
          <div key={k} className="grid grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
            <dt className={`${LABEL_BAND} px-4 py-2 text-muted`}>{k}</dt>
            <dd className={`min-w-0 break-words px-4 py-2 text-right font-semibold ${t ? TEXT[t] : "text-txt"}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="border-t border-line/60 px-4 py-2 text-xs text-muted">{note}</p>}
    </section>
  );
}

/** TableCard that the home page can aim at (click on a counter): the page scrolls to it and it is outlined in blue for a moment. */
function DataCard({ id, lit, ...rest }: { id?: string; lit?: string } & Parameters<typeof TableCard>[0]) {
  return <Anchor id={id} lit={lit}><TableCard {...rest} /></Anchor>;
}

/** Bloc que l'accueil peut viser (clic sur un compteur) : la page défile jusqu'à lui et il s'entoure de bleu un instant */
function Anchor({ id, lit, children }: Readonly<{ id?: string; lit?: string; children: ReactNode }>) {
  return <div id={id && `dns-${id}`} className={`scroll-mt-24 rounded-2xl transition-shadow duration-500 ${id && lit === id ? "ring-2 ring-link" : ""}`}>{children}</div>;
}

const code = (t: string) => <code className="rounded bg-bg2 px-1.5 py-0.5 font-mono text-xs">{t}</code>;

/** Tone of the error line: red while an error is open, orange once they are all closed, green without any */
function errorsTone(s: { errors_24h?: number; errors_open?: number }): RowTone {
  if (s.errors_open ?? s.errors_24h) return "bad";
  return s.errors_24h ? "warn" : "ok";
}

/** The error count of the sync log: how many in 24 h, how many are still open, and the last one's message */
function errorsText(s: { errors_24h?: number; errors_open?: number; last_error?: string | null }): string {
  const n = s.errors_24h || 0;
  if (!n) return "0";
  const open = s.errors_open ?? n;
  const msg = s.last_error ? ` · ${s.last_error.split("\t")[0]}` : "";
  return open ? `${n} (${tx("{0} en cours", open)})${msg}` : `${n} (${tx("close par une synchro réussie")})${msg}`;
}

const MACHINE_STATE: Record<string, [Tone, string]> = { ok: ["ok", tx("résout vers la machine")], ailleurs: ["warn", tx("résout ailleurs")], absent: ["off", tx("pas de nom DNS")] };

/** The four figures: resolution, DNS servers, sync, rewrites */
function Figures({ g, fig, st, last, stamp, hours }: Readonly<{ g: Dns; fig: DnsFigures; st: { cls: RowTone; label: string }; last: number | null; stamp: string; hours: Period }>) {
  const hist = useDnsHistory(hours, stamp), now = Math.floor(Date.now() / 1000);
  const answered = (hist?.local ?? []).reduce((n, p) => n + p[1], 0), asked = (hist?.local ?? []).reduce((n, p) => n + p[2], 0);
  const sources = (hist?.external ?? []).map((e, i) => ({ id: e.ip, name: `${e.name} ${e.ip}`, color: i ? "rgb(var(--link))" : "rgb(var(--bad))", points: e.ms.length ? e.ms : null }));
  let resTone: "ok" | "warn" | undefined;
  if (fig.domains) resTone = fig.domainsOk === fig.domains ? "ok" : "warn";
  let syncSub = tx("adguardhome-sync absent");
  if (g.resolver) syncSub = tx("sans objet");
  else if (last) syncSub = tx("dernière : {0}", hm(last));
  let rwTone: "ok" | "warn" | undefined, rwSub = tx("aucune configuration lue");
  if (fig.rewrites != null) {
    rwTone = fig.diff ? "warn" : "ok";
    rwSub = fig.diff ? tx("{0} différence(s) entre instances", fig.diff) : tx("identiques sur chaque instance");
  }
  return (
    <>
    <div className="flex flex-wrap gap-2.5 pb-1">
      <StatTile n={fig.domains ? `${fig.domainsOk}/${fig.domains}` : "-"} label={tx("Résolution")} tone={resTone} sub={tx("domaines NPM qui résolvent comme attendu")} />
      <HistoryTile n={`${fig.serversUp}/${fig.servers}`} label={tx("Serveurs DNS")} tone={fig.serversUp === fig.servers ? "ok" : "bad"} fact={g.resolver ? tx("résolveur du conteneur, aucun outil branché") : tx("instances AdGuard qui répondent")} kind="strip" points={hist?.local ?? null} hours={hours} now={now} figure={(p) => p[2] - p[1]} fmt={(p) => tx("{0}/{1} répondent", p[1], p[2])} goodHigh />
      <StatTile n={st.label} label={tx("Synchro")} tone={g.resolver ? undefined : st.cls} sub={syncSub} />
      <StatTile n={fig.rewrites ?? "-"} label={tx("Réécritures")} tone={rwTone} sub={rwSub} />
      {sources.some((x) => x.points) && <BandwidthTile label={tx("Latence DNS externe")} sources={sources} hours={hours} now={now} format={(v) => `${v} ms`} best="min" storeKey="ms.dnslatency.hidden" />}
    </div>
    {asked > 0 && <Dim>{tx("Test d'une vraie requête DNS à chaque collecte : les serveurs ont répondu {0} % du temps sur la période.", (Math.round((answered / asked) * 1000) / 10).toString().replace(".", ","))}</Dim>}
    </>
  );
}

/** One card per DNS server: an AdGuard instance (its configuration) or the container's resolver */
function ServerCard({ ip, v, origin }: Readonly<{ ip: string; v: Dns["servers"][string]; origin?: string }>) {
  const ok = serverUp(v), logo = v.resolver ? null : appIcon(["AdGuard Home"]);
  let state = tx("config illisible");
  if (ok) state = tx("répond");
  else if (v.readable || v.resolver) state = tx("requêtes perdues");
  const conf: Row[] = v.resolver ? [[tx("Rôle"), tx("résolveur du conteneur, lu dans resolv.conf")]]
    : [[tx("Réécritures"), v.readable ? String(v.rewrites) : "-"], [tx("Règles perso"), v.readable ? String(v.user_rules ?? "-") : "-"]];
  return (
    <InfoCard icon={logo ? <img src={logo} alt="" className="h-5 w-5" /> : <NetworkIcon size={18} className="text-muted" aria-hidden />} title={v.name} sub={origin === ip ? ip + tx(" · origine") : ip}
      tone={ok ? "ok" : "bad"} state={state}
      rows={[...conf, [tx("Requêtes sans réponse"), String(v.silent), v.silent ? "bad" : "ok"], ...(v.container ? [[tx("Conteneur"), v.container] as Row] : [])]} />
  );
}

/** The synchronisation card (AdGuard instances) */
function SyncCard({ g, st, last, content, diffCount }: Readonly<{ g: Dns; st: { cls: RowTone; label: string }; last: number | null; content: string; diffCount: number }>) {
  const sync = Object.values(g.sync || {})[0];
  const name = (ip?: string) => (ip && g.servers[ip]?.name) || ip || "?";
  const rows: Row[] = sync
    ? [[tx("Dernière synchro"), last ? hm(last) : tx("aucune en 24 h"), st.cls === "bad" ? "bad" : undefined],
       ...(sync.interval_min ? [[tx("Fréquence"), `${tx("toutes les")} ${sync.interval_min} ${tx("min")}`] as Row] : []),
       [tx("Erreurs (24 h)"), errorsText(sync), errorsTone(sync)]]
    : [["adguardhome-sync", Object.keys(g.servers).length > 1 ? tx("absent : contenus comparés") : tx("sans objet")]];
  return (
    <InfoCard icon={<RefreshCw size={18} className="text-muted" aria-hidden />} title={tx("Synchronisation")} sub={sync ? `${name(sync.origin)} → ${Object.keys(sync.last_done || {}).map(name).join(", ") || "?"}` : undefined}
      tone={st.cls} state={st.label} rows={[...rows, [tx("Contenu"), content, diffCount ? "warn" : "ok"]]} />
  );
}

// One blue family for the states of a name, the columns stay calm: only the verdicts that ask for an action are coloured
const CLOUD_TEXT: Record<CloudState, [string, string]> = { proxied: ["text-link", tx("proxifié")], dns: ["text-link/80", tx("DNS seul")], wildcard: ["text-link/60", tx("par joker")], none: ["text-muted", tx("aucun enregistrement")], outside: ["text-muted", tx("hors Cloudflare")] };
const VERDICT: Partial<Record<CompareRow["tone"], [Tone, string]>> = { bad: ["bad", tx("À corriger")], warn: ["warn", tx("À vérifier")] };
const MACHINE_COLORS = ["text-apache", "text-npm", "text-loc", "text-accent"];   // the theme's colours that are neither a state nor the blue of the addresses
const QUIET: Partial<Record<CompareRow["tone"], string>> = { info: tx("Info"), ok: tx("OK") };

/** The Cloudflare card: how the names are served, and how many ask for a look */
function CloudflareCard({ rows, zones }: Readonly<{ rows: CompareRow[]; zones: number }>) {
  const n = cloudCounts(rows), logo = appIcon(["Cloudflare"]);
  return (
    <InfoCard icon={logo ? <img src={logo} alt="" className="h-5 w-5" /> : <Cloud size={18} className="text-muted" aria-hidden />} title="Cloudflare" sub={tx("{0} zone(s), lecture seule", zones)}
      tone={n.alerts ? "warn" : "ok"} state={n.alerts ? tx("{0} à corriger", n.alerts) : tx("rien à corriger")}
      rows={[[tx("Proxifiés"), String(n.proxied)], [tx("DNS seul"), String(n.dns)], [tx("Par joker"), String(n.wildcard)], [tx("Hors Cloudflare"), String(n.outside)]]} />
  );
}

function CloudCell({ state }: Readonly<{ state: CloudState }>) {
  const [color, text] = CLOUD_TEXT[state];
  return <span className={`inline-flex items-center gap-1.5 ${color}`}>{state === "proxied" && <Cloud size={14} className="shrink-0 fill-current text-[#F38020]" aria-hidden />}{text}</span>;
}

/** Who runs the DNS, with its logo on a white tile: some brand colours would vanish on a dark theme */
function ManagerCell({ name }: Readonly<{ name: string }>) {
  const logo = dnsHostIcon(name);
  return <span className="inline-flex items-center gap-1.5 text-muted">{logo && <img src={logo} alt="" className="h-5 w-5 shrink-0 rounded bg-white p-0.5" />}{name}</span>;
}

function VerdictCell({ r }: Readonly<{ r: CompareRow }>) {
  const badge = VERDICT[r.tone];
  return <span className="block min-w-0">{badge ? <Badge tone={badge[0]}>{badge[1]}</Badge> : <span className="text-xs text-muted">{QUIET[r.tone]}</span>}{r.verdict && <span className="mt-1 block text-xs text-muted">{r.verdict}</span>}</span>;
}

/** One line of the comparison, each column in the order of the table: domains in the text colour, each machine in its own, addresses in the mono blue */
function compareCells(r: CompareRow, cloud: boolean, machine?: string): ReactNode[] {
  return [
    <span key="n" className="block min-w-0 break-words"><b className="font-semibold text-txt">{r.name}</b>{r.note && <span className="block text-xs text-muted">{r.note}</span>}</span>,
    <span key="w" className="block min-w-0 break-words"><span className={`font-medium ${machine ?? "text-muted"}`}>{r.npm}</span>{r.npmIp && <span className="block font-mono text-xs text-link">{r.npmIp}</span>}</span>,
    <ManagerCell key="m" name={r.manager} />,
    ...(cloud ? [<span key="c">{r.cloud ? <CloudCell state={r.cloud} /> : "-"}</span>] : []),
    <span key="a" className={`block min-w-0 break-words font-mono text-xs ${/\d/.test(r.answer) ? "text-link" : "text-muted"}`}>{r.answer}</span>,
    <VerdictCell key="v" r={r} />,
  ];
}

/** Everything that asks for an action and the state of every name: it opens on the alerts, or on all the names when there is none */
function CompareTable({ g, rows, cloud, lit }: Readonly<{ g: Dns; rows: CompareRow[]; cloud: boolean; lit?: string }>) {
  const [picked, setPicked] = useState<boolean | null>(null);
  const alerts = rows.filter(isAlert), all = picked ?? alerts.length === 0;
  const { sorted, ...sort } = useSort(all ? rows : alerts, compareKey, "tone");
  const ranks = machineRanks(rows);
  const colorOf = (r: CompareRow) => { const rank = ranks.get(r.npm); return rank === undefined ? undefined : MACHINE_COLORS[rank % MACHINE_COLORS.length]; };
  const cols = [{ label: tx("Domaine"), k: "name", className: "w-[22%]" }, { label: tx("NPM (machine)"), k: "npm", className: "w-[18%]" }, { label: tx("DNS géré par"), k: "manager", className: "w-[11%]" },
    ...(cloud ? [{ label: "Cloudflare", k: "cloud", className: "w-[12%]" }] : []), { label: g.resolver ? tx("Résolveur") : "AdGuard", k: "answer", className: "w-[14%]" }, { label: tx("Verdict"), k: "tone" }];
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-wrap items-center gap-1.5" aria-label={tx("Afficher")}>
        <ChipButton on={!all} count={alerts.length} label={tx("Alertes")} onClick={() => setPicked(false)} />
        <ChipButton on={all} count={rows.length} label={tx("Tout")} onClick={() => setPicked(true)} />
      </fieldset>
      <DataCard id="domains" lit={lit} title={tx("Alertes et comparaison par domaine")} tone={alerts.length ? "warn" : "ok"} tableWidth="min-w-[860px]" zebra sort={sort} cols={cols}
        rows={sorted.map((r) => compareCells(r, cloud, colorOf(r)))} empty={tx("Aucune alerte DNS : tout répond et résout comme attendu.")} />
    </div>
  );
}

/** The counters of the rewrite checks: their tables only appear when one of them is not zero */
function ChecksCard({ g, diff }: Readonly<{ g: Dns; diff: number }>) {
  const invalid = g.invalid?.length ?? 0, total = diff + g.orphans.length + invalid;
  const row = (label: string, n: number): Row => [label, String(n), n ? "warn" : "ok"];
  return <InfoCard icon={<ListChecks size={18} className="text-muted" aria-hidden />} title={tx("Contrôles des réécritures")} sub={tx("entre les instances AdGuard")} tone={total ? "warn" : "ok"} state={tx("{0} écart(s)", total)}
    rows={[row(tx("Sur une seule instance"), diff), row(tx("Vers NPM sans host actif"), g.orphans.length), row(tx("Nom invalide"), invalid)]} />;
}

/** What the check asks and reads */
function SourcesCard({ g, machineList }: Readonly<{ g: Dns; machineList: { ip: string; name: string }[] }>) {
  const npm = npmList(g, machineList);
  return <InfoCard icon={<Server size={18} className="text-muted" aria-hidden />} title={tx("Sources du contrôle")} sub={tx("ce qui est interrogé et lu")} tone="ok"
    rows={[[tx("Serveurs DNS"), serverList(g)], ...(npm ? [[tx("NPM lus"), npm] as Row] : [])]}
    note={g.resolver ? tx("Chaque domaine des hosts NPM actifs est demandé au résolveur que MyServices utilise.") : tx("Chaque domaine des hosts NPM actifs est demandé à chaque AdGuard ; réécritures et règles perso lues dans AdGuardHome.yaml.")} />;
}

/** « Details »: the sources and the rewrites side by side, and the tables of a rewrite problem above them when there is one */
function AllTables({ g, machineList, lit, st, diff }: Readonly<{ g: Dns; machineList: { ip: string; name: string }[]; lit?: string; st: { cls: RowTone }; diff: Rewrite[] }>) {
  const sync = Object.values(g.sync || {})[0];
  const name = (ip?: string) => (ip && g.servers[ip]?.name) || ip || "?";
  const machines = g.machines ?? [];
  return (
    <div className="flex flex-col gap-4">
      {!g.resolver && <>
        <DataCard id="diff" lit={lit} title={tx("Présent sur une seule instance")} tone="bad" cols={[{ label: tx("Entrée"), className: "w-[55%]" }, { label: tx("Seulement sur") }]}
          rows={diff.map((x) => [<span key="e">{x.rule ? <>{tx("règle")} {code(x.rule)}</> : code(`${x.domain} → ${x.answer}`)}</span>, <b key="o" className="font-medium">{name(x.only)}</b>])}
          note={sync && st.cls === "warn" ? `Synchro à l'heure : sera recopié au prochain passage. Toujours modifier sur ${name(sync.origin)}.` : undefined} />
        <DataCard id="orphans" lit={lit} title={tx("Réécritures vers NPM sans host NPM actif")} tone="warn" cols={[{ label: tx("Domaine"), className: "w-[38%]" }, { label: tx("Réponse"), className: "w-[22%]" }, { label: tx("Pourquoi") }]}
          rows={g.orphans.map((x) => [<b key="d" className="font-medium">{x.domain}</b>, <span key="a">{code(x.answer)}</span>, <span key="w" className="text-muted">{x.why}</span>])} />
        <DataCard id="invalid" lit={lit} title={tx("Réécritures au nom invalide (jamais résolues)")} tone="warn" cols={[{ label: tx("Domaine"), className: "w-[55%]" }, { label: tx("Réponse") }]}
          rows={(g.invalid || []).map((x) => [<b key="d" className="font-medium">{x.domain}</b>, <span key="a">{code(x.answer)}</span>])} />
      </>}
      <div className="grid items-start gap-3 md:grid-cols-2">
        {!g.resolver && <ChecksCard g={g} diff={diff.length} />}
        <SourcesCard g={g} machineList={machineList} />
        {!g.resolver && <DataCard title={tx("Réécritures directes, sans NPM")} tone="info" cols={[{ label: tx("Domaine"), className: "w-[55%]" }, { label: tx("Réponse") }]}
          rows={(g.direct || []).map((x) => [<b key="d" className="font-medium">{x.domain}</b>, <span key="a">{code(x.answer)}</span>])} empty={tx("Aucune réécriture directe.")} />}
        <DataCard id="machines" lit={lit} title={tx("Noms des machines suivies")} tone={machines.some((m) => m.state === "ailleurs") ? "warn" : "info"} cols={[{ label: tx("Machine"), className: "w-[32%]" }, { label: "IP", className: "w-[28%]" }, { label: tx("État") }]}
          rows={machines.map((m) => [<b key="n" className="font-medium">{m.name}</b>, <span key="ip">{code(m.ip)}</span>, <span key="s" className="flex flex-wrap items-center gap-1.5"><Badge tone={MACHINE_STATE[m.state][0]} outline plainText>{MACHINE_STATE[m.state][1]}</Badge>{m.state === "ailleurs" && <span className="font-mono text-xs">{m.answer.join(", ")}</span>}</span>])}
          empty={tx("Aucune machine suivie.")} note={tx("Le nom de chaque machine est demandé tel quel, puis avec les domaines de recherche du résolveur. Pas de nom DNS n'est pas une faute : beaucoup de réseaux n'en donnent pas aux machines.")} />
      </div>
    </div>
  );
}

/** Sub-pages of DNS in the side menu (#dns/<view>); « watch » is no longer in the menu: its old address opens the servers, where the alerts are */
const VIEWS = ["watch", "servers", "all"] as const;
type View = (typeof VIEWS)[number];
/** The sub-page holding a section: the alerts and the cards are on the servers, the tables of a rewrite problem in « Details » */
const viewOf = (anchor: string): View => (anchor === "servers" || anchor === "domains" ? "servers" : "all");

export function Dns({ snap, initial }: Readonly<{ snap: Snapshot; initial?: Selected }>) {
  const g = snap.data.dns;
  const [hours, setHours] = usePeriod();
  const want = initial?.anchor?.[0];
  const [lit, setLit] = useState(want);
  const at = Date.parse(snap.data.generated);
  const view = usePageView(useRoute(), "dns", VIEWS, want ? viewOf(want) : "servers");
  useEffect(() => {
    if (!want) return;
    document.getElementById(`dns-${want}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setLit(undefined), 2500);
    return () => clearTimeout(t);
  }, [want]);
  if (!g) return <Empty>{tx("Aucun serveur DNS joignable depuis MyServices : ni outil DNS branché, ni résolveur dans le conteneur.")}</Empty>;
  const st = dnsSync(g, at), sync = Object.values(g.sync || {})[0];
  const last = sync?.last_done ? Math.max(...Object.values(sync.last_done).map((t) => new Date(t).getTime())) : null;
  const all = [...g.rewrites_diff, ...g.user_rules_diff];
  const diff = all.filter((x) => !x.waiting), waiting = all.length - diff.length;   // a fresh difference waits one sync turn before it counts
  let content = tx("identique");
  if (diff.length) content = tx("{0} différence(s)", diff.length);
  else if (waiting) content = tx("{0} en attente de la synchro", waiting);
  const fig = dnsFigures(g, snap.data.hosts, at);
  const tools = g.resolver ? tx("résolveur du conteneur : {0}", g.resolver.servers.join(", ")) : tx("AdGuard Home ×{0}", Object.keys(g.servers).length);
  const machines = g.machines ?? [], zones = cloudflareZones(snap);
  const rows = dnsCompare(g, snap.data.hosts, snap.data.machine_list, zones, dnsWatch(g, snap.data.hosts, at));
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={NetworkIcon} title={tx("DNS")} tags={<HeadTags counts={[tx("{0} domaine(s) contrôlé(s)", fig.domains), machines.length > 0 ? tx("{0} nom(s) de machine", machines.length) : ""]} sources={[tools]} at={snap.data.generated} />} actions={<>{snap.me.role === "admin" && <ConnectorsLink types={["adguard", "pihole", "technitium", "dns-agent"]} />}<PeriodSwitch value={hours} onChange={setHours} /></>} />
      <Figures g={g} fig={fig} st={st} last={last} stamp={String(at ?? "")} hours={hours} />
      {view === "all" ? <AllTables g={g} machineList={snap.data.machine_list} lit={lit} st={st} diff={diff} /> : <>
        <Anchor id="servers" lit={lit}><div className="grid items-start gap-3 md:grid-cols-2">
          {!g.resolver && <SyncCard g={g} st={st} last={last} content={content} diffCount={diff.length} />}
          {zones.length > 0 && <CloudflareCard rows={rows} zones={zones.length} />}
          {Object.entries(g.servers).map(([ip, v]) => <ServerCard key={ip} ip={ip} v={v} origin={sync?.origin} />)}
        </div></Anchor>
        <CompareTable g={g} rows={rows} cloud={zones.length > 0} lit={lit} />
      </>}
    </div>
  );
}
