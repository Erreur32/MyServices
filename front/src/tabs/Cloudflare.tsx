// « Cloudflare »: what to improve, the domains side by side, their traffic, what the firewall did, what the server behind answered, the DNS queries,
// and each name checked against the reverse proxy that serves it.
import { useState } from "react";
import { Plug } from "lucide-react";
import type { Snapshot } from "../api";
import { InfoNote } from "../components/InfoNote";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { readConnector, RereadButton } from "../components/Reread";
import { StatTile } from "../components/StatTile";
import { Badge, Chip, Empty, TableCard } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { actionLine, advice, answerLines, bestZone, cacheLine, CHECK_ORDER, cloudflareChecks, cloudflareZones, countryName, dnsOnly, isTrouble, LINES, niceMax, originLine, pathLine, queryTypeName, settingText, SETTINGS, sourceName, trafficOf, trendOf, type AnswerLine, type Check } from "../lib/cloudflare";
import { useSort } from "../lib/filter";
import { bytes } from "../lib/format";
import { LOCALE, tx } from "../lib/i18n";
import { usePageView } from "../lib/route";
import type { CloudflareLine, CloudflarePeriod, CloudflarePoint, CloudflarePeriodKey, CloudflareZone } from "../types";

const VIEWS = ["overview", "compare", "traffic", "security", "origin", "dns", "checks"] as const;
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

/** A tile's small curve: its figure over the points of the period, nothing when it never left zero */
function Spark<T>({ points, of, tone = "text-link" }: Readonly<{ points: T[]; of: (p: T) => number; tone?: string }>) {
  const W = 120, H = 34, values = points.map(of), top = Math.max(0, ...values);
  if (values.length < 2 || !top) return null;
  const at = values.map((v, i) => `${((i * W) / (values.length - 1)).toFixed(1)} ${(H - 2 - (v / top) * (H - 4)).toFixed(1)}`), line = `M${at.join("L")}`;
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`mt-1 h-[34px] w-full min-w-[70px] overflow-visible ${tone}`}>
      <path d={`${line}L${W} ${H}L0 ${H}Z`} fill="currentColor" opacity="0.12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Overview({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const list = advice(zones), toFix = list.filter((a) => a.tone === "warn").length, requests = sum(zones, (t) => t.requests);
  const checks = cloudflareChecks(zones, snap.data.hosts).filter(isTrouble).length, week = trafficOf(zones, "7d")?.points ?? [];
  return (
    <>
      <Head title="Cloudflare" snap={snap} />
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={zones.length} label={tx("domaines")} sub={tx("{0} proxifiés", zones.filter((z) => !dnsOnly(z)).length)} />
        <StatTile n={toFix} label={tx("réglages à corriger")} tone={toFix ? "warn" : "ok"} />
        <StatTile n={checks} label={tx("noms à vérifier")} tone={checks ? "warn" : "ok"} onClick={() => { location.hash = "cloudflare/checks"; }} />
        <StatTile n={fmt(requests)} label={tx("requêtes sur 7 jours")}><Spark points={week} of={(p) => p.requests} /></StatTile>
        <StatTile n={share(sum(zones, (t) => t.threats), requests)} label={tx("de requêtes classées comme menaces")} hint={tx("Cloudflare les classe comme menaces, sans dire ici lesquelles ont été bloquées.")}><Spark points={week} of={(p) => p.threats} /></StatTile>
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

type Bar = Pick<CloudflarePoint, "at" | "requests" | "errors">;
const REQUESTS_TIP = (p: Bar) => `${fmt(p.requests)}, ${tx("{0} erreurs serveur", fmt(p.errors))}`;

function TrafficBars({ points, title, fill = "fill-link", tip = REQUESTS_TIP }: Readonly<{ points: Bar[]; title: string; fill?: string; tip?: (p: Bar) => string }>) {
  const W = 1000, H = 130, BOTTOM = 22, TOP = 8, LEFT = 52, top = niceMax(Math.max(...points.map((p) => p.requests), 1));
  const y = (v: number) => H - BOTTOM - (v / top) * (H - BOTTOM - TOP), bar = (W - LEFT) / points.length, every = points.length > 7 ? Math.ceil(points.length / 8) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[40rem]" role="img" aria-label={title}>
      {[0, 0.5, 1].map((k) => <g key={k} className="text-dim"><line x1={LEFT} x2={W} y1={y(top * k)} y2={y(top * k)} stroke="currentColor" strokeOpacity={0.25} /><text x={LEFT - 6} y={y(top * k) + 4} textAnchor="end" fontSize={12} className="fill-muted">{fmt(top * k)}</text></g>)}
      {points.map((p, i) => {
        const x = LEFT + i * bar + bar * 0.16, width = bar * 0.68, good = p.requests - p.errors;
        return (
          <g key={p.at}>
            <title>{`${pointLabel(p.at)} : ${tip(p)}`}</title>
            <rect x={x} y={y(good)} width={width} height={H - BOTTOM - y(good)} className={fill} />
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

type Reading = NonNullable<ReturnType<typeof trafficOf>>;

function TrafficDetails({ p }: Readonly<{ p: Reading }>) {
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
      <Bars title={tx("Pages les plus demandées")} sub={tx("Sans les paramètres d'adresse")} lines={p.paths.slice(0, LINES).map(pathLine)} />
      <Bars title={tx("Robots et clients")} sub={tx("Les plus actifs")} lines={p.agents.slice(0, LINES).map((l) => ({ name: l.name || tx("Sans nom"), requests: l.requests }))} />
      <Bars title={tx("Méthodes")} lines={p.methods.slice(0, LINES)} />
      <Bars title={tx("Visiteurs par navigateur")} sub={tx("Pages vues")} lines={p.browsers.slice(0, LINES).map((b) => ({ name: b.name === "Unknown" ? tx("Robots et inconnus") : b.name.replace(/([a-z])([A-Z])/g, "$1 $2"), requests: b.requests }))} />
    </div>
  );
}

function TrafficFigures({ p }: Readonly<{ p: Reading }>) {
  const was = p.previous;
  return (
    <div className="flex flex-wrap gap-2.5">
      <StatTile n={fmt(p.visitors)} label={tx("visiteurs uniques")}><Trend now={p.visitors} before={was.visitors} rising="good" /><Spark points={p.points} of={(x) => x.visitors} /></StatTile>
      <StatTile n={fmt(p.visits)} label={tx("visites")} sub={tx("une personne, une arrivée sur le site")} />
      <StatTile n={fmt(p.page_views)} label={tx("pages vues")} sub={tx("réponses HTML")} />
      <StatTile n={fmt(p.requests)} label={tx("requêtes")}><Trend now={p.requests} before={was.requests} rising="good" /><Spark points={p.points} of={(x) => x.requests} /></StatTile>
      <StatTile n={share(p.cached, p.requests)} label={tx("servi par le cache")}><Trend now={p.requests ? p.cached / p.requests : 0} before={was.requests ? was.cached / was.requests : 0} rising="good" /><Spark points={p.points} of={(x) => (x.requests ? x.cached / x.requests : 0)} /></StatTile>
      <StatTile n={bytes(p.bytes)} label={tx("données traitées")}><Trend now={p.bytes} before={was.bytes} rising="good" /><Spark points={p.points} of={(x) => x.bytes} /></StatTile>
      <StatTile n={bytes(p.cached_bytes)} label={tx("données en cache")}><Trend now={p.cached_bytes} before={was.cached_bytes} rising="good" /><Spark points={p.points} of={(x) => x.cached_bytes} /></StatTile>
      <StatTile n={fmt(p.errors)} label={tx("erreurs serveur")} tone={p.errors ? "bad" : "ok"}><Trend now={p.errors} before={was.errors} rising="bad" /><Spark points={p.points} of={(x) => x.errors} tone="text-bad" /></StatTile>
      <StatTile n={fmt(p.threats)} label={tx("classées comme menaces")} hint={tx("Cloudflare les classe comme menaces, sans dire ici lesquelles ont été bloquées.")}><Trend now={p.threats} before={was.threats} rising="bad" /><Spark points={p.points} of={(x) => x.threats} tone="text-warn" /></StatTile>
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

/** A choice kept by this browser, the same on every Cloudflare page */
function useKept(key: string, fallback: string): [string, (v: string) => void] {
  const [kept, setKept] = useState(() => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } });
  const keep = (v: string) => { setKept(v); try { localStorage.setItem(key, v); } catch { /* storage refused: the choice lasts this visit */ } };
  return [kept, keep];
}

/** The domain and the period a page shows, with its head and their chips */
function useScope(zones: CloudflareZone[], title: string, snap: Snapshot) {
  const [keptPeriod, setPeriod] = useKept("ms.cloudflare.period", "24h");
  const [keptDomain, setDomain] = useKept("ms.cloudflare.domain", "");
  const domain = zones.some((z) => z.name === keptDomain) ? keptDomain : "";   // a domain since removed from the account: back to all of them
  const chosen = PERIODS.find((x) => x.key === keptPeriod) ?? PERIODS[0], period = chosen.key;
  const picked = domain ? zones.filter((z) => z.name === domain) : zones;
  const head = (
    <>
      <Head title={title} snap={snap} />
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={tx("Tous")} on={!domain} act={() => setDomain("")} />
        {zones.map((z) => <Chip key={z.name} label={z.name} on={domain === z.name} act={() => setDomain(z.name)} />)}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {PERIODS.map((x) => <Chip key={x.key} label={x.label} on={period === x.key} act={() => setPeriod(x.key)} />)}
      </div>
    </>
  );
  return { head, domain, period, picked, chosen, p: trafficOf(picked, period) };
}

const NoReading = () => <Empty>{tx("Statistiques à venir : elles arrivent à la prochaine lecture de Cloudflare.")}</Empty>;
const count = (lines: CloudflareLine[], name: string) => lines.find((l) => l.name === name)?.requests ?? 0;
const total = (lines: CloudflareLine[]) => lines.reduce((a, l) => a + l.requests, 0);

function Traffic({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const { head, domain, period, picked, chosen, p } = useScope(zones, tx("Trafic"), snap);
  if (!p) return <>{head}<NoReading /></>;
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

function Security({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const { head, domain, p } = useScope(zones, tx("Sécurité"), snap);
  if (!p) return <>{head}<NoReading /></>;
  const s = p.security, sampled = tx("dans le dernier échantillon"), title = tx("Événements par période");
  const lines = (list: CloudflareLine[], name: (n: string) => string = (n) => n) => list.slice(0, LINES).map((l) => ({ name: name(l.name), requests: l.requests }));
  return (
    <>
      {head}
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={fmt(s.events)} label={tx("événements")} tone={s.events ? "warn" : "ok"}><Spark points={s.points} of={(e) => e.events} tone="text-warn" /></StatTile>
        <StatTile n={fmt(count(s.actions, "block"))} label={tx("bloqués")} sub={sampled} />
        <StatTile n={fmt(count(s.actions, "link_maze_injected"))} label={tx("pièges à robots")} sub={sampled} />
      </div>
      <section className={FRAME}>
        <div className={STRIP}><h3 className="font-bold">{title}</h3><span className="text-xs text-muted">{domain || tx("Tous les domaines")}</span></div>
        <div className="overflow-x-auto p-3"><TrafficBars points={s.points.map((e) => ({ at: e.at, requests: e.events, errors: 0 }))} title={title} fill="fill-warn" tip={(e) => tx("{0} événements", fmt(e.requests))} /></div>
      </section>
      <InfoNote tone="warn" open>{tx("Le détail vient des 100 derniers événements de chaque domaine : c'est un échantillon. Les comptes par période, eux, sont complets. Cloudflare ne regroupe pas le détail sur l'offre gratuite.")}</InfoNote>
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title={tx("Ce que Cloudflare a fait")} sub={tx("Échantillon")} lines={s.actions.slice(0, LINES).map(actionLine)} />
        <Bars title={tx("Qui l'a décidé")} sub={tx("Échantillon")} lines={lines(s.sources, sourceName)} />
        <Bars title={tx("Noms visés")} sub={tx("Échantillon")} lines={lines(s.targets)} />
        <Bars title={tx("Pays")} sub={tx("Échantillon")} lines={lines(s.countries, countryName)} />
      </div>
    </>
  );
}

function Origin({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const { head, p } = useScope(zones, tx("Serveur et cache"), snap);
  if (!p) return <>{head}<NoReading /></>;
  const read = total(p.origin), silent = count(p.origin, "0"), through = total(p.cache), worrying = read > 0 && silent / read >= WORRYING_ERRORS;
  return (
    <>
      {head}
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={share(silent, read)} label={tx("sans réponse du serveur")} sub={tx("{0} requêtes", fmt(silent))} tone={worrying ? "warn" : "ok"} />
        <StatTile n={fmt(read - silent)} label={tx("réponses du serveur")} />
        <StatTile n={share(p.cached, p.requests)} label={tx("servi par le cache")} />
        <StatTile n={share(count(p.cache, "dynamic"), through)} label={tx("passé par le serveur")} sub={tx("pages dynamiques")} />
      </div>
      {worrying && <InfoNote tone="warn" open>{tx("{0} des requêtes n'ont pas eu de réponse du serveur : arrêtées avant lui, servies par le cache, ou serveur muet. Les erreurs 520 et 525 de la page Trafic disent si le serveur est en cause.", share(silent, read))}</InfoNote>}
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title={tx("Réponses de ton serveur")} sub={tx("Vues par Cloudflare")} lines={p.origin.slice(0, LINES).map(originLine)} />
        <Bars title={tx("Ce que fait le cache")} sub={tx("Requêtes, et données")} lines={p.cache.slice(0, LINES).map((l) => ({ ...cacheLine(l), shown: `${fmt(l.requests)} · ${bytes(l.bytes ?? 0)}` }))} />
      </div>
      <InfoNote>{tx("Ces comptes viennent d'un échantillon de Cloudflare : les chiffres sont arrondis.")}</InfoNote>
    </>
  );
}

function Dns({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const { head, p } = useScope(zones, tx("DNS"), snap);
  if (!p) return <>{head}<NoReading /></>;
  const d = p.dns, missing = count(d.codes, "NXDOMAIN"), fine = count(d.codes, "NOERROR");
  return (
    <>
      {head}
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={fmt(d.total)} label={tx("requêtes DNS")} />
        <StatTile n={share(missing, d.total)} label={tx("noms inexistants")} sub={tx("{0} requêtes", fmt(missing))} tone={missing ? "warn" : "ok"} />
        <StatTile n={share(fine, d.total)} label={tx("réponses correctes")} />
      </div>
      <InfoNote>{tx("Cloudflare compte ces requêtes sur un échantillon : les chiffres sont arrondis. Un nom inexistant très demandé peut être un ancien sous-domaine encore utilisé, ou un robot.")}</InfoNote>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Bars title={tx("Noms les plus demandés")} lines={d.names.slice(0, LINES)} />
        <Bars title={tx("Types demandés")} lines={d.types.slice(0, LINES).map((l) => ({ name: queryTypeName(l.name), requests: l.requests }))} />
        <Bars title={tx("Réponses")} lines={d.codes.map((l) => ({ name: l.name === "NXDOMAIN" ? tx("Nom inexistant") : l.name, requests: l.requests, tone: l.name === "NXDOMAIN" ? "warn" : undefined }))} />
      </div>
      <InfoNote>{tx("Temps de réponse et sites d'origine des visiteurs : refusés sur l'offre gratuite. Mesures côté navigateur : demandent un droit de compte en plus et Web Analytics activé.")}</InfoNote>
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
      {view === "security" && <Security snap={snap} zones={zones} />}
      {view === "origin" && <Origin snap={snap} zones={zones} />}
      {view === "dns" && <Dns snap={snap} zones={zones} />}
      {view === "checks" && <Checks snap={snap} zones={zones} />}
    </div>
  );
}
