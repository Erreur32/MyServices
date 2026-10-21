// DNS in « state » mode: a title line naming the resolver of the network and the tools wired, four figures, « To watch » (an
// instance silent, the sync failing, a domain that does not resolve or resolves elsewhere, a machine name pointing elsewhere,
// rewrites differing between instances or orphaned), then the synchronisation and instance cards (kept, the same frame for
// AdGuard or another local DNS cluster) and « See all », folded: the detail tables and the machine names. Without a DNS tool
// wired the page stays: the server asks the resolvers of the container.
import { Layers, Network as NetworkIcon, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Snapshot } from "../api";
import type { Dns, Host, Rewrite } from "../types";
import { dnsSync, hostName } from "../lib/status";
import type { Selected } from "../lib/filter";
import { Badge, Empty, TableCard, type Tone } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { tx } from "../lib/i18n";
import { dateTime, hm } from "../lib/format";
import { FoldPanel } from "../components/FoldPanel";
import { StatTile } from "../components/StatTile";
import { WatchPanel } from "../components/WatchPanel";
import { quiet, worstTone } from "../lib/forms";
import { dnsFigures, dnsWatch, serverUp, type DnsFigures, type DnsRow } from "../lib/dnsState";

type RowTone = "ok" | "warn" | "bad";
type Row = [label: string, value: string, tone?: RowTone];
const TEXT: Record<RowTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

/** Card of the page header (synchronisation, one per AdGuard server): coloured strip with icon, title, address and state, then label/value rows
 *  in two aligned columns separated by thin lines. */
function InfoCard({ icon, title, sub, tone, state, rows }: Readonly<{ icon: ReactNode; title: string; sub?: string; tone: RowTone; state: string; rows: Row[] }>) {
  const strip = "border-b border-line/60 bg-bg", frame = { ok: "border-line", warn: "border-warn/50", bad: "border-bad/50" }[tone];
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${frame}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${strip}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-bg2">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold leading-tight">{title}</h3>
          {sub && <span className="block truncate font-mono text-xs text-dim">{sub}</span>}
        </div>
        <Badge tone={tone}>{state}</Badge>
      </div>
      <dl className="divide-y divide-line/60 text-sm">
        {rows.map(([k, v, t]) => (
          <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className={`text-right font-semibold ${t ? TEXT[t] : "text-txt"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** TableCard that the home page can aim at (click on a counter): the page scrolls to it and it is outlined in blue for a moment. */
function DataCard({ id, lit, ...rest }: { id?: string; lit?: string } & Parameters<typeof TableCard>[0]) {
  return <Anchor id={id} lit={lit}><TableCard {...rest} /></Anchor>;
}

/** Bloc que l'accueil peut viser (clic sur un compteur) : la page défile jusqu'à lui et il s'entoure de bleu un instant */
function Anchor({ id, lit, children }: { id?: string; lit?: string; children: ReactNode }) {
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
function Figures({ g, fig, st, last }: Readonly<{ g: Dns; fig: DnsFigures; st: { cls: RowTone; label: string }; last: number | null }>) {
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
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      <StatTile n={fig.domains ? `${fig.domainsOk}/${fig.domains}` : "-"} label={tx("Résolution")} tone={resTone} sub={tx("domaines NPM qui résolvent comme attendu")} />
      <StatTile n={`${fig.serversUp}/${fig.servers}`} label={tx("Serveurs DNS")} tone={fig.serversUp === fig.servers ? "ok" : "bad"} sub={g.resolver ? tx("résolveur du conteneur, aucun outil branché") : tx("instances AdGuard qui répondent")} />
      <StatTile n={st.label} label={tx("Synchro")} tone={g.resolver ? undefined : st.cls} sub={syncSub} />
      <StatTile n={fig.rewrites ?? "-"} label={tx("Réécritures")} tone={rwTone} sub={rwSub} />
    </div>
  );
}

/** « To watch », one row per problem, a button to its section */
function Watch({ watch, onShow }: Readonly<{ watch: DnsRow[]; onShow: (anchor: string) => void }>) {
  const worst = worstTone(watch.some((w) => w.sev === "bad"), watch.length > 0);
  return (
    <WatchPanel id="dns" tone={worst} count={watch.length} hint={tx("instance muette, synchro, domaine qui ne résout pas ou ailleurs, réécritures")}>
      {watch.length === 0 ? <p className="px-4 py-3 text-sm text-ok">{tx("Tout résout comme attendu, rien à signaler.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
              <th className="px-3 py-2">{tx("Domaine")}</th><th className="px-3 py-2">{tx("Quoi")}</th><th className="px-3 py-2">{tx("Détail")}</th><th className="w-24 px-3 py-2" />
            </tr></thead>
            <tbody>
              {watch.map((w) => (
                <tr key={w.key} className="border-t border-line/60 even:bg-bg/50 hover:bg-bg2/40">
                  <td className="px-3 py-2"><Badge tone={w.sev}>{w.area}</Badge></td>
                  <td className="px-3 py-2 font-semibold">{w.title}</td>
                  <td className="px-3 py-2 text-muted">{w.detail}</td>
                  <td className="px-3 py-2 text-right"><button type="button" onClick={() => onShow(w.anchor)} className={`${quiet} py-1`}>{tx("Voir")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WatchPanel>
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

/** « See all »: the detail tables (AdGuard rewrites, NPM domains to check, machine names) */
function AllTables({ g, hosts, lit, st, diff }: Readonly<{ g: Dns; hosts: Host[]; lit?: string; st: { cls: RowTone }; diff: Rewrite[] }>) {
  const sync = Object.values(g.sync || {})[0];
  const name = (ip?: string) => (ip && g.servers[ip]?.name) || ip || "?";
  const rows = hosts.filter((r) => r.dns && r.enabled && r.dns.issues.length);
  const machines = g.machines ?? [];
  const domainsNote = [g.resolver ? tx("Chaque domaine des hosts NPM actifs est demandé au résolveur que MyServices utilise.") : tx("Chaque domaine des hosts NPM actifs est demandé à chaque AdGuard ; réécritures et règles perso lues dans AdGuardHome.yaml."), g.npm_ip ? `NPM = ${g.npm_ip}.` : ""].filter(Boolean).join(" ");
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
        <DataCard title={tx("Réécritures directes, sans NPM")} tone="info" cols={[{ label: tx("Domaine"), className: "w-[55%]" }, { label: tx("Réponse") }]}
          rows={(g.direct || []).map((x) => [<b key="d" className="font-medium">{x.domain}</b>, <span key="a">{code(x.answer)}</span>])} />
      </>}
      <DataCard id="domains" lit={lit} title={tx("Domaines NPM à vérifier")} tone={rows.length ? "warn" : "ok"} cols={[{ label: tx("Domaine"), className: "w-[45%]" }, { label: tx("À vérifier") }]}
        rows={rows.map((r) => [<b key="n" className="font-medium">{hostName(r)}</b>, <span key="i" className="flex flex-wrap gap-1">{r.dns!.issues.map((x) => <span key={`${String(x[0])}-${String(x[1] ?? "")}`} className="inline-flex items-center gap-1.5"><Badge tone="warn">{String(x[0]).replace("_", " ")}</Badge>{typeof x[1] === "string" && x[1] !== hostName(r) && <code className="font-mono text-xs">{x[1]}</code>}</span>)}</span>])}
        empty={g.resolver ? tx("Tous les domaines NPM actifs résolvent sur le résolveur du réseau.") : tx("Tous les domaines NPM actifs résolvent pareil sur chaque AdGuard.")} note={domainsNote} />
      <DataCard id="machines" lit={lit} title={tx("Noms des machines suivies")} tone={machines.some((m) => m.state === "ailleurs") ? "warn" : "info"} cols={[{ label: tx("Machine"), className: "w-[30%]" }, { label: "IP", className: "w-[22%]" }, { label: tx("Réponse"), className: "w-[28%]" }, { label: tx("État") }]}
        rows={machines.map((m) => [<b key="n" className="font-medium">{m.name}</b>, <span key="ip">{code(m.ip)}</span>, <span key="a" className="font-mono text-xs">{m.answer.join(", ") || "-"}</span>, <Badge key="s" tone={MACHINE_STATE[m.state][0]} outline plainText>{MACHINE_STATE[m.state][1]}</Badge>])}
        empty={tx("Aucune machine suivie.")} note={tx("Le nom de chaque machine est demandé tel quel, puis avec les domaines de recherche du résolveur. Pas de nom DNS n'est pas une faute : beaucoup de réseaux n'en donnent pas aux machines.")} />
    </div>
  );
}

export function Dns({ snap, initial }: Readonly<{ snap: Snapshot; initial?: Selected }>) {
  const g = snap.data.dns;
  const want = initial?.anchor?.[0];
  const [lit, setLit] = useState(want);
  const [allKey, setAllKey] = useState(0);   // bumped to remount « See all » open when a row leads into it
  const show = (anchor: string) => {   // a row of « To watch » leads to its section: « See all » opens first when the section lives there
    if (!document.getElementById(`dns-${anchor}`)) { try { localStorage.setItem("myservices.panel.dns-all.folded", "0"); } catch { /* storage refused */ } setAllKey((n) => n + 1); }
    setTimeout(() => { document.getElementById(`dns-${anchor}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setLit(anchor); setTimeout(() => setLit(undefined), 2500); }, 50);
  };
  useEffect(() => {
    if (!want) return;
    document.getElementById(`dns-${want}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setLit(undefined), 2500);
    return () => clearTimeout(t);
  }, [want]);
  if (!g) return <Empty>{tx("Aucun serveur DNS joignable depuis MyServices : ni outil DNS branché, ni résolveur dans le conteneur.")}</Empty>;
  const at = Date.parse(snap.data.generated);
  const st = dnsSync(g, at), sync = Object.values(g.sync || {})[0];
  const last = sync?.last_done ? Math.max(...Object.values(sync.last_done).map((t) => new Date(t).getTime())) : null;
  const all = [...g.rewrites_diff, ...g.user_rules_diff];
  const diff = all.filter((x) => !x.waiting), waiting = all.length - diff.length;   // a fresh difference waits one sync turn before it counts
  let content = tx("identique");
  if (diff.length) content = tx("{0} différence(s)", diff.length);
  else if (waiting) content = tx("{0} en attente de la synchro", waiting);
  const fig = dnsFigures(g, snap.data.hosts, at), watch = dnsWatch(g, snap.data.hosts, at);
  const tools = g.resolver ? tx("résolveur du conteneur : {0}", g.resolver.servers.join(", ")) : tx("AdGuard Home ×{0}", Object.keys(g.servers).length);
  const machines = g.machines ?? [], issues = snap.data.hosts.filter((r) => r.dns && r.enabled && r.dns.issues.length).length;
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><NetworkIcon size={18} aria-hidden />{tx("DNS")}</h1>
        <span className="text-sm text-muted">{tools} · {tx("{0} domaine(s) contrôlé(s)", fig.domains)}{machines.length > 0 && ` · ${tx("{0} nom(s) de machine", machines.length)}`} · {tx("relevé du {0}, en lecture seule", dateTime(snap.data.generated))}</span>
        {snap.me.role === "admin" && <a href="#settings/connectors" className="ml-auto text-sm text-link hover:underline">{tx("Connecteurs")} ›</a>}
      </div>
      <Figures g={g} fig={fig} st={st} last={last} />
      <Watch watch={watch} onShow={show} />
      <Anchor id="servers" lit={lit}><div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {!g.resolver && <SyncCard g={g} st={st} last={last} content={content} diffCount={diff.length} />}
        {Object.entries(g.servers).map(([ip, v]) => <ServerCard key={ip} ip={ip} v={v} origin={sync?.origin} />)}
      </div></Anchor>
      <FoldPanel key={allKey} id="dns-all" icon={Layers} title={tx("Tout voir")} count={diff.length + g.orphans.length + (g.invalid?.length ?? 0) + (g.direct?.length ?? 0) + issues + machines.length} startFolded>
        <AllTables g={g} hosts={snap.data.hosts} lit={lit} st={st} diff={diff} />
      </FoldPanel>
    </div>
  );
}
