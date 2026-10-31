// « Cloudflare »: what to improve, the domains side by side, their traffic, and each name checked against the reverse proxy that serves it.
import { useState } from "react";
import { Plug } from "lucide-react";
import type { Snapshot } from "../api";
import { InfoNote } from "../components/InfoNote";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { readConnector, RereadButton } from "../components/Reread";
import { StatTile } from "../components/StatTile";
import { Badge, Chip, Empty, TableCard } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { advice, answerLines, bestZone, CHECK_ORDER, cloudflareChecks, cloudflareZones, countryName, dnsOnly, isTrouble, LINES, niceMax, settingText, SETTINGS, trafficOf, trendOf, type AnswerLine, type Check } from "../lib/cloudflare";
import { useSort } from "../lib/filter";
import { bytes } from "../lib/format";
import { LOCALE, tx } from "../lib/i18n";
import { usePageView } from "../lib/route";
import type { CloudflareLine, CloudflarePeriod, CloudflarePeriodKey, CloudflareZone } from "../types";

const VIEWS = ["overview", "compare", "traffic", "checks"] as const;
const FRAME = "overflow-hidden rounded-2xl border border-line bg-card shadow-sm";
const STRIP = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-bg px-4 py-3";
const fmt = (n: number) => n.toLocaleString(LOCALE);
const sum = (zones: CloudflareZone[], pick: (t: NonNullable<CloudflareZone["traffic"]>) => number) => zones.reduce((a, z) => a + (z.traffic ? pick(z.traffic) : 0), 0);
function share(part: number, whole: number): string {
  const p = whole ? (100 * part) / whole : 0;
  return `${(p > 0 && p < 1 ? p.toFixed(1) : Math.round(p).toString()).replace(".", LOCALE === "fr-FR" ? "," : ".")} %`;
}

function Head({ title, snap }: Readonly<{ title: string; snap: Snapshot }>) {
  const read = (snap.data.services_status ?? []).filter((c) => c.connector === "cloudflare");
  const actions = snap.me.role === "admin" ? <>
    {read.map((c) => <RereadButton key={c.name} label={read.length > 1 ? `${tx("Relire")} ${c.name}` : tx("Relire")} tip={tx("Lire Cloudflare maintenant, sans attendre sa lecture de chaque heure")} run={readConnector("cloudflare", c.name)} />)}
    <ConnectorsLink types={["cloudflare"]} />
  </> : undefined;
  return <PageHead icon={Plug} logo={appIcon(["Cloudflare"])} title={title} tags={null} actions={actions} />;
}

function Overview({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const list = advice(zones), toFix = list.filter((a) => a.tone === "warn").length, requests = sum(zones, (t) => t.requests);
  const checks = cloudflareChecks(zones, snap.data.hosts).filter(isTrouble).length;
  return (
    <>
      <Head title="Cloudflare" snap={snap} />
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={zones.length} label={tx("domaines")} sub={tx("{0} proxifiés", zones.filter((z) => !dnsOnly(z)).length)} />
        <StatTile n={toFix} label={tx("réglages à corriger")} tone={toFix ? "warn" : "ok"} />
        <StatTile n={checks} label={tx("noms à vérifier")} tone={checks ? "warn" : "ok"} onClick={() => { location.hash = "cloudflare/checks"; }} />
        <StatTile n={fmt(requests)} label={tx("requêtes sur 7 jours")} />
        <StatTile n={share(sum(zones, (t) => t.threats), requests)} label={tx("de requêtes classées comme menaces")} hint={tx("Cloudflare les classe comme menaces, sans dire ici lesquelles ont été bloquées.")} />
      </div>
      {list.length > 0 && (
        <section className={FRAME}>
          <div className={STRIP}><h3 className="font-bold">{tx("À améliorer")}</h3><span className="text-xs text-muted">{tx("Ce qui ne va pas, pourquoi, quoi changer, et la précaution à prendre")}</span></div>
          <ul>
            {list.map((a) => (
              <li key={a.key} className="grid gap-x-5 gap-y-1.5 border-t border-line/60 px-4 py-3 first:border-t-0 even:bg-bg/50 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">{a.title}<Badge outline tone={a.tone === "warn" ? "warn" : "off"}>{a.tone === "warn" ? tx("à corriger") : tx("pour info")}</Badge></div>
                  <div className="mt-0.5 break-words text-xs text-muted">{a.who.join(", ")}</div>
                </div>
                <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
                  <dt className="text-dim">{tx("Pourquoi")}</dt><dd>{a.why}</dd>
                  <dt className="text-dim">{tx("Quoi changer")}</dt><dd>{a.fix}</dd>
                  <dt className="text-dim">{tx("Précaution")}</dt><dd>{a.care}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
      <InfoNote>{tx("MyServices lit Cloudflare sans rien y modifier : les changements se font sur dash.cloudflare.com.")}</InfoNote>
    </>
  );
}

function Compare({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const [chosen, setChosen] = useState<string | null>(null), [onlyGaps, setOnlyGaps] = useState(false);
  const best = zones[bestZone(zones)], ref = zones.find((z) => z.name === chosen) ?? best;
  const gap = (z: CloudflareZone, key: string) => z !== ref && !dnsOnly(z) && settingText(z, key) !== settingText(ref, key);
  const gaps = SETTINGS.filter((s) => zones.some((z) => gap(z, s.key)));
  const rows = onlyGaps ? gaps : SETTINGS;
  const look = (z: CloudflareZone, key: string) => {
    if (dnsOnly(z)) return "italic text-dim";
    return gap(z, key) ? "font-semibold text-warn" : "";
  };
  return (
    <>
      <Head title={tx("Comparer les domaines")} snap={snap} />
      <InfoNote>{tx("Clique sur un domaine pour en faire la référence : les réglages qui s'en écartent passent en orange. Un domaine « DNS seul » est grisé, car ses réglages ne s'appliquent à rien.")}</InfoNote>
      <section className={FRAME}>
        <div className={STRIP}>
          <h3 className="font-bold">{tx("Réglages")}</h3>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted"><input id="cf-gaps" type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />{tx("Écarts seulement ({0})", gaps.length)}</label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead><tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-semibold">{tx("Réglage")}</th>
              {zones.map((z) => (
                <th key={z.name} className={`px-4 py-2 font-semibold ${z === ref ? "shadow-[inset_0_-2px_0_rgb(var(--link))]" : ""}`}>
                  <button type="button" aria-pressed={z === ref} onClick={() => setChosen(z.name)} className="whitespace-nowrap text-left text-sm font-semibold text-txt hover:text-link">
                    {z.name}<span className={`block text-xs font-normal ${z === ref ? "text-link" : "text-dim"}`}>{z === ref ? tx("référence") : z.plan}{dnsOnly(z) ? `, ${tx("DNS seul")}` : ""}</span>
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody className="[&>tr:nth-child(even)]:bg-bg/50">
              {rows.map((s) => (
                <tr key={s.key}>
                  <td className="whitespace-nowrap px-4 py-2">{s.label}</td>
                  {zones.map((z) => <td key={z.name} className={`whitespace-nowrap px-4 py-2 font-mono ${look(z, s.key)}`}>{settingText(z, s.key)}</td>)}
                </tr>
              ))}
              <tr><td className="whitespace-nowrap px-4 py-2">{tx("DNS proxifiés")}</td>{zones.map((z) => <td key={z.name} className="whitespace-nowrap px-4 py-2 font-mono">{z.dns ? `${z.dns.proxied} / ${z.dns.total}` : "?"}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const PERIODS: { key: CloudflarePeriodKey; label: string; of: string }[] = [
  { key: "24h", label: tx("24 h"), of: tx("Requêtes par heure") }, { key: "7d", label: tx("7 j"), of: tx("Requêtes par jour") }, { key: "30d", label: tx("30 j"), of: tx("Requêtes par jour") },
];
const WORRYING_ERRORS = 0.05;
const pointLabel = (at: string) => (at.length > 10 ? `${new Date(at).getHours().toString().padStart(2, "0")}h` : `${at.slice(8)}/${at.slice(5, 7)}`);

function TrafficBars({ points, title }: Readonly<{ points: CloudflarePeriod["points"]; title: string }>) {
  const W = 1000, H = 130, BOTTOM = 22, TOP = 8, LEFT = 52, top = niceMax(Math.max(...points.map((p) => p.requests), 1));
  const y = (v: number) => H - BOTTOM - (v / top) * (H - BOTTOM - TOP), bar = (W - LEFT) / points.length, every = points.length > 7 ? Math.ceil(points.length / 8) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[40rem]" role="img" aria-label={title}>
      {[0, 0.5, 1].map((k) => <g key={k} className="text-dim"><line x1={LEFT} x2={W} y1={y(top * k)} y2={y(top * k)} stroke="currentColor" strokeOpacity={0.25} /><text x={LEFT - 6} y={y(top * k) + 4} textAnchor="end" fontSize={12} className="fill-muted">{fmt(top * k)}</text></g>)}
      {points.map((p, i) => {
        const x = LEFT + i * bar + bar * 0.16, width = bar * 0.68, good = p.requests - p.errors;
        return (
          <g key={p.at}>
            <title>{`${pointLabel(p.at)} : ${fmt(p.requests)}, ${tx("{0} erreurs serveur", fmt(p.errors))}`}</title>
            <rect x={x} y={y(good)} width={width} height={H - BOTTOM - y(good)} className="fill-link" />
            <rect x={x} y={y(p.requests)} width={width} height={y(good) - y(p.requests)} className="fill-bad" />
            {i % every === 0 && <text x={LEFT + i * bar + bar / 2} y={H - 6} textAnchor="middle" fontSize={12} className="fill-muted">{pointLabel(p.at)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function trendColor(change: number, rising: "good" | "bad"): string {
  if (change === 0) return "";
  return (change > 0) === (rising === "good") ? "text-ok" : "text-bad";
}

function Trend({ now, before, rising }: Readonly<{ now: number; before: number; rising: "good" | "bad" }>) {
  const change = trendOf(now, before);
  if (change === null) return <div className="text-xs text-dim">{tx("rien à comparer")}</div>;
  return <div className="text-xs text-dim"><span className={trendColor(change, rising)}>{change >= 0 ? "↗" : "↘"} {Math.abs(change)} %</span> {tx("avant")}</div>;
}

const BAR_TONE = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };
type BarLine = AnswerLine & { shown?: string };

function Bars({ title, sub, lines }: Readonly<{ title: string; sub?: string; lines: BarLine[] }>) {
  const top = Math.max(...lines.map((l) => l.requests), 1);
  return (
    <section className={FRAME}>
      <div className={STRIP}><h3 className="font-bold">{title}</h3>{sub && <span className="text-xs text-muted">{sub}</span>}</div>
      <div className="flex flex-col gap-2 px-4 py-3">
        {lines.length === 0 && <Empty>{tx("Rien de lu.")}</Empty>}
        {lines.map((l) => (
          <div key={l.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-sm">
            <span className="break-words">{l.name}</span><span className="font-mono tabular-nums">{l.shown ?? fmt(l.requests)}</span>
            {l.why && <span className="col-span-2 text-xs text-muted">{l.why}</span>}
            <div className="col-span-2 mt-0.5 h-1.5 overflow-hidden rounded bg-bg2"><div className={`h-full ${l.tone ? BAR_TONE[l.tone] : "bg-link"}`} style={{ width: `${(100 * l.requests) / top}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TrafficDetails({ p }: Readonly<{ p: CloudflarePeriod }>) {
  const ofAll = (l: CloudflareLine) => share(l.requests, p.requests);
  const reach = (list: CloudflareLine[], name: (l: CloudflareLine) => string = (l) => l.name) => list.slice(0, LINES).map((l) => ({ name: name(l), requests: l.requests, shown: ofAll(l) }));
  const protocols = [...p.tls.map((l): BarLine => ({ name: l.name === "none" ? tx("Sans chiffrement") : l.name.replace("TLSv", "TLS "), requests: l.requests, shown: ofAll(l), tone: l.name === "none" ? "warn" : undefined })), ...reach(p.http)];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <Bars title={tx("Réponses")} sub={tx("Ce que reçoivent les visiteurs")} lines={answerLines(p)} />
      <Bars title={tx("Noms en erreur")} sub={tx("Le plus touché d'abord")} lines={p.hosts.slice(0, LINES).map((h) => ({ name: h.name, requests: h.requests, shown: `${fmt(h.requests)} · ${h.code}`, tone: "bad" }))} />
      <Bars title={tx("Pays")} sub={tx("Requêtes, et menaces")} lines={p.countries.slice(0, LINES).map((c) => ({ name: countryName(c.name), requests: c.requests, shown: c.threats ? `${fmt(c.requests)} · ${tx("{0} menaces", fmt(c.threats))}` : undefined, tone: (c.threats ?? 0) * 10 > c.requests ? "warn" : undefined }))} />
      <Bars title={tx("Types de contenu")} lines={p.content.slice(0, LINES).map((c) => ({ name: c.name, requests: c.requests, shown: `${ofAll(c)} · ${bytes(c.bytes ?? 0)}` }))} />
      <Bars title={tx("Chiffrement et protocole")} lines={protocols} />
      <Bars title={tx("Visiteurs par navigateur")} sub={tx("Pages vues")} lines={p.browsers.slice(0, LINES).map((b) => ({ name: b.name === "Unknown" ? tx("Robots et inconnus") : b.name.replace(/([a-z])([A-Z])/g, "$1 $2"), requests: b.requests }))} />
    </div>
  );
}

function TrafficFigures({ p }: Readonly<{ p: CloudflarePeriod }>) {
  const was = p.previous;
  return (
    <div className="flex flex-wrap gap-2.5">
      <StatTile n={fmt(p.visitors)} label={tx("visiteurs uniques")}><Trend now={p.visitors} before={was.visitors} rising="good" /></StatTile>
      <StatTile n={fmt(p.requests)} label={tx("requêtes")}><Trend now={p.requests} before={was.requests} rising="good" /></StatTile>
      <StatTile n={share(p.cached, p.requests)} label={tx("servi par le cache")}><Trend now={p.requests ? p.cached / p.requests : 0} before={was.requests ? was.cached / was.requests : 0} rising="good" /></StatTile>
      <StatTile n={bytes(p.bytes)} label={tx("données traitées")}><Trend now={p.bytes} before={was.bytes} rising="good" /></StatTile>
      <StatTile n={bytes(p.cached_bytes)} label={tx("données en cache")}><Trend now={p.cached_bytes} before={was.cached_bytes} rising="good" /></StatTile>
      <StatTile n={fmt(p.errors)} label={tx("erreurs serveur")} tone={p.errors ? "bad" : "ok"}><Trend now={p.errors} before={was.errors} rising="bad" /></StatTile>
      <StatTile n={fmt(p.threats)} label={tx("classées comme menaces")} hint={tx("Cloudflare les classe comme menaces, sans dire ici lesquelles ont été bloquées.")}><Trend now={p.threats} before={was.threats} rising="bad" /></StatTile>
    </div>
  );
}

type DomainRow = { name: string; dnsOnly: boolean; p: CloudflarePeriod };
const DOMAIN_SORT: Record<string, (r: DomainRow) => string | number> = {
  name: (r) => r.name, requests: (r) => r.p.requests, visitors: (r) => r.p.visitors, bytes: (r) => r.p.bytes,
  cache: (r) => (r.p.requests ? r.p.cached / r.p.requests : 0), errors: (r) => (r.p.requests ? r.p.errors / r.p.requests : 0), threats: (r) => r.p.threats,
};
const domainKey = (r: DomainRow, key: string) => DOMAIN_SORT[key](r);
const figure = (v: string, k: string) => <span key={k} className="block text-right font-mono tabular-nums">{v}</span>;

function DomainTable({ zones, period }: Readonly<{ zones: CloudflareZone[]; period: CloudflarePeriodKey }>) {
  const rows = zones.flatMap((z): DomainRow[] => { const p = z.traffic?.periods?.[period]; return p ? [{ name: z.name, dnsOnly: dnsOnly(z), p }] : []; });
  const sort = useSort(rows, domainKey, "name");
  const right = "text-right";
  return (
    <TableCard zebra title={tx("Par domaine")} tone="info" count={rows.length} sort={sort} empty={<Empty>{tx("Statistiques non lues : droit Analytics Read du jeton à vérifier.")}</Empty>}
      cols={[{ label: tx("Domaine"), k: "name" }, { label: tx("Requêtes"), className: right, k: "requests" }, { label: tx("Visiteurs"), className: right, k: "visitors" }, { label: tx("Données"), className: right, k: "bytes" }, { label: tx("Cache"), className: right, k: "cache" }, { label: tx("Erreurs"), className: right, k: "errors" }, { label: tx("Menaces"), className: right, k: "threats" }]}
      rows={sort.sorted.map(({ name, dnsOnly: only, p }) => [
        <span key="n" className="inline-flex flex-wrap items-center gap-1.5 font-semibold">{name}{only && <Badge outline tone="off">{tx("DNS seul")}</Badge>}</span>,
        figure(fmt(p.requests), "r"), figure(fmt(p.visitors), "v"), figure(bytes(p.bytes), "b"), figure(share(p.cached, p.requests), "c"), figure(share(p.errors, p.requests), "e"), figure(fmt(p.threats), "m"),
      ])} />
  );
}

function Traffic({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const [period, setPeriod] = useState<CloudflarePeriodKey>("24h");
  const [domain, setDomain] = useState("");
  const picked = domain ? zones.filter((z) => z.name === domain) : zones, p = trafficOf(picked, period), chosen = PERIODS.find((x) => x.key === period)!;
  const head = (
    <>
      <Head title={tx("Trafic")} snap={snap} />
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={tx("Tous")} on={!domain} act={() => setDomain("")} />
        {zones.map((z) => <Chip key={z.name} label={z.name} on={domain === z.name} act={() => setDomain(z.name)} />)}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {PERIODS.map((x) => <Chip key={x.key} label={x.label} on={period === x.key} act={() => setPeriod(x.key)} />)}
      </div>
    </>
  );
  if (!p) return <>{head}<Empty>{tx("Statistiques à venir : elles arrivent à la prochaine lecture de Cloudflare.")}</Empty></>;
  return (
    <>
      {head}
      {p.requests > 0 && p.errors / p.requests >= WORRYING_ERRORS && <InfoNote tone="warn" open>{tx("{0} des requêtes finissent en erreur serveur : le site ne répond pas correctement à Cloudflare. « Noms en erreur » dit où regarder.", share(p.errors, p.requests))}</InfoNote>}
      <TrafficFigures p={p} />
      <section className={FRAME}>
        <div className={STRIP}>
          <h3 className="font-bold">{chosen.of}</h3><span className="text-xs text-muted">{domain || tx("Tous les domaines")}</span>
          <span className="ml-auto flex gap-3 text-xs text-muted"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-link" />{tx("Réussies")}</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-bad" />{tx("Erreurs serveur")}</span></span>
        </div>
        <div className="overflow-x-auto p-3"><TrafficBars points={p.points} title={chosen.of} /></div>
      </section>
      <TrafficDetails p={p} />
      <DomainTable zones={picked} period={period} />
      {!domain && <InfoNote tone="warn" open>{tx("Les visiteurs sont comptés pour chaque domaine. Leur total est une somme : une même personne venue sur deux domaines compte deux fois.")}</InfoNote>}
      <InfoNote>{tx("Workers, temps CPU et minutes de construction ne sont pas repris : le jeton ne les lit pas.")}</InfoNote>
    </>
  );
}

const TONE: Record<Check["tone"], "ok" | "warn" | "bad" | "off"> = { ok: "ok", info: "off", warn: "warn", bad: "bad" };

const CHECK_SORT: Record<string, (c: Check) => string | number> = { name: (c) => c.name, record: (c) => c.record, via: (c) => c.via ?? "", machine: (c) => c.machine ?? "", code: (c) => c.code ?? 0, tone: (c) => CHECK_ORDER.indexOf(c.tone) };
const checkKey = (c: Check, key: string) => CHECK_SORT[key](c);

function Checks({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const [alerts, setAlerts] = useState(false);
  const all = cloudflareChecks(zones, snap.data.hosts), trouble = all.filter(isTrouble);
  const count = (t: Check["tone"]) => all.filter((c) => c.tone === t).length;
  const sort = useSort(alerts ? trouble : all, checkKey, "tone");
  const toneLabel: Record<Check["tone"], string> = { ok: tx("OK"), info: tx("pour info"), warn: tx("à vérifier"), bad: tx("en panne") };
  const recordLabel: Record<Check["record"], string> = { proxied: tx("Proxifié"), dns: tx("DNS seul"), none: tx("Absent") };
  return (
    <>
      <Head title={tx("Vérification")} snap={snap} />
      <InfoNote>{tx("Chaque nom est croisé entre Cloudflare et le reverse proxy qui le sert : NPM, Apache ou nginx selon la machine. Les noms sans site derrière (mail) et les noms locaux sans enregistrement public ne sont pas listés.")}</InfoNote>
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={all.length} label={tx("noms vérifiés")} pressed={!alerts} onClick={() => setAlerts(false)} />
        <StatTile n={trouble.length} label={tx("Alertes")} tone={trouble.length ? "warn" : "ok"} pressed={alerts} onClick={() => setAlerts(true)} />
        <StatTile n={count("bad")} label={tx("en panne")} tone={count("bad") ? "bad" : "ok"} />
        <StatTile n={count("ok")} label={tx("sans souci")} tone="ok" />
      </div>
      {!snap.data.hosts.some((h) => h.type === "proxy" || h.vhost_domains?.length) && <InfoNote tone="warn" open>{tx("Aucun reverse proxy lu : relie NPM, ou lis la machine Apache ou nginx par SSH ou agent, pour que cette vérification serve vraiment.")}</InfoNote>}
      <TableCard zebra title={tx("Noms")} tone="info" count={sort.sorted.length} sort={sort} empty={<Empty>{tx("Rien à signaler.")}</Empty>}
        cols={[{ label: tx("Nom"), k: "name" }, { label: "Cloudflare", k: "record" }, { label: tx("Servi par"), k: "via" }, { label: tx("Machine"), k: "machine" }, { label: tx("Réponse"), k: "code" }, { label: tx("État"), k: "tone" }]}
        rows={sort.sorted.map((c) => [
          <div key="n" className="min-w-0"><b className="font-semibold">{c.name}</b>{c.notes.map((n) => <div key={n} className="whitespace-normal text-xs text-muted">{n}</div>)}</div>,
          <Badge key="r" outline tone={c.record === "proxied" ? "ok" : "off"}>{recordLabel[c.record]}</Badge>,
          c.via ?? "-", c.machine ?? "-", <span key="c" className="font-mono">{c.code ?? "-"}</span>,
          <Badge key="t" outline tone={TONE[c.tone]}>{toneLabel[c.tone]}</Badge>,
        ])} />
    </>
  );
}

export function Cloudflare({ snap, route }: Readonly<{ snap: Snapshot; route: string }>) {
  const view = usePageView(route, "cloudflare", VIEWS, "overview"), zones = cloudflareZones(snap);
  if (!zones.length) return <div className="py-4"><Empty>{tx("Aucun domaine lu : regarde l'état du connecteur Cloudflare dans Connecteurs.")}</Empty></div>;
  return (
    <div className="flex flex-col gap-5 py-4">
      {view === "overview" && <Overview snap={snap} zones={zones} />}
      {view === "compare" && <Compare snap={snap} zones={zones} />}
      {view === "traffic" && <Traffic snap={snap} zones={zones} />}
      {view === "checks" && <Checks snap={snap} zones={zones} />}
    </div>
  );
}
