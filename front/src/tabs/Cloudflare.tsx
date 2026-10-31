// « Cloudflare »: what to improve, the domains side by side, their traffic, and each name checked against the reverse proxy that serves it.
import { useState } from "react";
import { Plug } from "lucide-react";
import type { Snapshot } from "../api";
import { InfoNote } from "../components/InfoNote";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { StatTile } from "../components/StatTile";
import { Badge, Empty, TableCard } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { advice, bestZone, CHECK_ORDER, cloudflareChecks, cloudflareZones, dnsOnly, isTrouble, niceMax, requestsByDay, settingText, SETTINGS, type Check } from "../lib/cloudflare";
import { useSort } from "../lib/filter";
import { bytes } from "../lib/format";
import { LOCALE, tx } from "../lib/i18n";
import { usePageView } from "../lib/route";
import type { CloudflareZone } from "../types";

const VIEWS = ["overview", "compare", "traffic", "checks"] as const;
const FRAME = "overflow-hidden rounded-2xl border border-line bg-card shadow-sm";
const STRIP = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-bg px-4 py-3";
const fmt = (n: number) => n.toLocaleString(LOCALE);
const sum = (zones: CloudflareZone[], pick: (t: NonNullable<CloudflareZone["traffic"]>) => number) => zones.reduce((a, z) => a + (z.traffic ? pick(z.traffic) : 0), 0);
function share(part: number, whole: number): string {
  const p = whole ? (100 * part) / whole : 0;
  return `${(p > 0 && p < 1 ? p.toFixed(1) : Math.round(p).toString()).replace(".", LOCALE === "fr-FR" ? "," : ".")} %`;
}

const Head = ({ title, snap }: Readonly<{ title: string; snap: Snapshot }>) => (
  <PageHead icon={Plug} logo={appIcon(["Cloudflare"])} title={title} tags={null} actions={snap.me.role === "admin" ? <ConnectorsLink /> : undefined} />
);

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

function DayBars({ days }: Readonly<{ days: { date: string; requests: number }[] }>) {
  const W = 640, H = 180, BOTTOM = 24, TOP = 8, LEFT = 52, top = niceMax(Math.max(...days.map((d) => d.requests), 1));
  const y = (v: number) => H - BOTTOM - (v / top) * (H - BOTTOM - TOP), bar = (W - LEFT) / days.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[26rem]" role="img" aria-label={tx("Requêtes par jour")}>
      {[0, 0.5, 1].map((k) => <g key={k} className="text-dim"><line x1={LEFT} x2={W} y1={y(top * k)} y2={y(top * k)} stroke="currentColor" strokeOpacity={0.25} /><text x={LEFT - 6} y={y(top * k) + 4} textAnchor="end" fontSize={11} fill="currentColor">{fmt(top * k)}</text></g>)}
      {days.map((d, i) => (
        <g key={d.date}>
          <rect x={LEFT + i * bar + bar * 0.18} y={y(d.requests)} width={bar * 0.64} height={H - BOTTOM - y(d.requests)} className="fill-link"><title>{`${d.date} : ${fmt(d.requests)}`}</title></rect>
          <text x={LEFT + i * bar + bar / 2} y={H - 7} textAnchor="middle" fontSize={11} className="fill-muted">{d.date.slice(8)}/{d.date.slice(5, 7)}</text>
        </g>
      ))}
    </svg>
  );
}

function Spark({ days }: Readonly<{ days: { requests: number }[] }>) {
  const W = 110, H = 26, top = Math.max(...days.map((d) => d.requests), 1);
  const points = days.map((d, i) => `${((i * W) / Math.max(days.length - 1, 1)).toFixed(1)},${(H - 2 - (d.requests / top) * (H - 5)).toFixed(1)}`).join(" ");
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("Requêtes par jour")}><polygon points={`0,${H} ${points} ${W},${H}`} className="fill-link/10" /><polyline points={points} fill="none" strokeWidth={1.5} className="stroke-link" /></svg>;
}

function Traffic({ snap, zones }: Readonly<{ snap: Snapshot; zones: CloudflareZone[] }>) {
  const read = zones.filter((z) => z.traffic), requests = sum(zones, (t) => t.requests), days = requestsByDay(zones);
  const sorted = [...read].sort((a, b) => (b.traffic?.requests ?? 0) - (a.traffic?.requests ?? 0));
  return (
    <>
      <Head title={tx("Trafic")} snap={snap} />
      <div className="flex flex-wrap gap-2.5">
        <StatTile n={fmt(requests)} label={tx("requêtes (7 j)")} />
        <StatTile n={fmt(sum(zones, (t) => t.visitors))} label={tx("visiteurs (7 j)")} />
        <StatTile n={bytes(sum(zones, (t) => t.bytes))} label={tx("bande passante (7 j)")} />
        <StatTile n={share(sum(zones, (t) => t.cached), requests)} label={tx("servi par le cache")} />
        <StatTile n={fmt(sum(zones, (t) => t.threats))} label={tx("classées comme menaces (7 j)")} hint={tx("Cloudflare les classe comme menaces, sans dire ici lesquelles ont été bloquées.")} />
      </div>
      {days.length > 0 && <section className={FRAME}><div className={STRIP}><h3 className="font-bold">{tx("Requêtes par jour")}</h3><span className="text-xs text-muted">{tx("Tous les domaines")}</span></div><div className="overflow-x-auto p-3"><DayBars days={days} /></div></section>}
      <TableCard zebra title={tx("Par domaine")} tone="info" count={sorted.length} empty={<Empty>{tx("Statistiques non lues : droit Analytics Read du jeton à vérifier.")}</Empty>}
        cols={[{ label: tx("Domaine") }, { label: tx("7 jours") }, { label: tx("Requêtes"), className: "text-right" }, { label: tx("Visiteurs"), className: "text-right" }, { label: tx("Bande passante"), className: "text-right" }, { label: tx("En cache"), className: "text-right" }, { label: tx("Menaces"), className: "text-right" }]}
        rows={sorted.map((z) => {
          const t = z.traffic!, num = (v: string, k: string) => <span key={k} className="block text-right font-mono tabular-nums">{v}</span>;
          return [
            <span key="n" className="inline-flex flex-wrap items-center gap-1.5 font-semibold">{z.name}{dnsOnly(z) && <Badge outline tone="off">{tx("DNS seul")}</Badge>}</span>,
            <Spark key="s" days={t.days} />, num(fmt(t.requests), "r"), num(fmt(t.visitors), "v"), num(bytes(t.bytes), "b"), num(share(t.cached, t.requests), "c"), num(fmt(t.threats), "m"),
          ];
        })} />
      <InfoNote tone="warn" open>{tx("Les visiteurs sont comptés sur la semaine pour chaque domaine. Leur total est une somme : une même personne venue sur deux domaines compte deux fois.")}</InfoNote>
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
