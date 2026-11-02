// The Web traffic page of Security: per machine whose Nginx Proxy Manager logs are read (agent or SSH), its requests per hour over 24 h against
// its usual hour, the load beside it (a high load from the disks is not an attack), its sites with the diffuse scraping and the 5xx, then the
// busiest addresses of the last hour and the limits of the alerts.
import { Activity, Eye, Globe, Network, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useSort } from "../lib/filter";
import { tx } from "../lib/i18n";
import { LOAD_DISK, loadReading, toLook, topIps, VERDICT_ORDER, type SiteRow, type SiteVerdict, type WebMachine } from "../lib/webTraffic";
import { DetailRow, DetailSection } from "./DetailSection";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { StatTile } from "./StatTile";
import { Badge, ChipButton, Dim, Th } from "./ui";

const int = (n: number): string => n.toLocaleString();
const VERDICT: Record<SiteVerdict, [string, "warn" | "off"]> = {
  diffuse: [tx("Aspiration diffuse"), "warn"], errors: [tx("Erreurs 5xx"), "warn"], usual: [tx("Habituel"), "off"],
};
const READING = {
  peak: [tx("Pic de trafic : plus de 3 fois l'heure habituelle"), "text-warn"],
  disk: [tx("Charge due au disque, pas au web : des copies ou sauvegardes tournent"), "text-muted"],
  high: [tx("Charge haute sans pic de trafic : regarder les processus de la machine"), "text-warn"],
  calm: [tx("Charge normale"), "text-ok"],
} as const;

/** 24 bars, one per hour up to the current one, and the dashed line of the usual hour */
function HourChart({ m }: Readonly<{ m: WebMachine }>) {
  const usual = m.web.usual ?? null, max = Math.max(1, usual ?? 0, ...m.hours), cur = Math.floor(m.web.at / 3600) * 3600;
  const hour = (i: number) => new Date((cur - (23 - i) * 3600) * 1000).getHours();
  return (
    <div className="min-w-0 flex-1">
      <div className="relative flex h-40 items-end gap-0.5" role="img" aria-label={tx("Requêtes par heure sur 24 h")}>
        {m.hours.map((n, i) => (
          <span key={`h${hour(i)}`} title={tx("{0} h : {1} requêtes", hour(i), int(n))}
            className={`flex-1 rounded-sm ${usual && n >= 3 * usual ? "bg-warn" : "bg-link/60"} ${i === 23 ? "opacity-50" : ""}`} style={{ height: `${Math.max(2, (n / max) * 100)}%` }} />
        ))}
        {usual != null && (
          <span className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-txt/50" style={{ bottom: `${(usual / max) * 100}%` }}>
            <span className="absolute -top-5 right-0 rounded bg-bg px-1 text-[11px] text-muted">{tx("habituel {0}/h", int(usual))}</span>
          </span>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-dim"><span>{tx("il y a 24 h")}</span><span>{tx("max {0}", int(max))}</span><span>{tx("maintenant")}</span></div>
    </div>
  );
}

type SiteKey = "site" | "last" | "usual" | "total" | "ips" | "share" | "errors" | "look";
const siteKey = (r: SiteRow, k: string): string | number => {
  if (k === "site") return r.site;
  if (k === "look") return VERDICT_ORDER.indexOf(r.verdict) * 1e9 - r.total;   // to look at first, then the busiest
  return r[k as Exclude<SiteKey, "site" | "look">] ?? -1;
};
const NUM = "px-3 py-2 text-right tabular-nums";

/** The last hour against the usual one: « +48 % », in orange from 3 times the usual */
function Delta({ r }: Readonly<{ r: SiteRow }>) {
  if (!r.usual) return null;
  const pct = Math.round(((r.last - r.usual) / r.usual) * 100);
  return <span className={`ml-1.5 text-[11px] ${pct >= 200 ? "font-semibold text-warn" : "text-dim"}`}>{pct > 0 ? "+" : ""}{pct} %</span>;
}

/** A share shown as a short bar beside its figure */
function Meter({ pct, hot }: Readonly<{ pct: number; hot: boolean }>) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line/60" aria-hidden><span className={`block h-full rounded-full ${hot ? "bg-warn" : "bg-link/50"}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>
      <span className={hot ? "font-semibold text-warn" : ""}>{pct} %</span>
    </span>
  );
}

function SiteLine({ r }: Readonly<{ r: SiteRow }>) {
  const [label, tone] = VERDICT[r.verdict];
  return (
    <tr className="border-t border-line/60 even:bg-bg/50 hover:bg-bg2/40">
      <td className="max-w-0 px-3 py-2"><span className="block truncate font-semibold" title={r.site}>{r.site}</span></td>
      <td className={`${NUM} whitespace-nowrap`}><b>{int(r.last)}</b><Delta r={r} /></td>
      <td className={`${NUM} text-muted`}>{r.usual == null ? "-" : int(r.usual)}</td>
      <td className={`${NUM} text-muted`}>{int(r.total)}</td>
      <td className={NUM}>{int(r.ips)}</td>
      <td className={NUM}><Meter pct={r.share} hot={r.verdict === "diffuse"} /></td>
      <td className={NUM}>{r.errors ? <span className="text-warn">{int(r.errors)}</span> : <Dim>0</Dim>}</td>
      <td className="px-3 py-2"><Badge tone={tone}>{label}</Badge>
        {r.verdict === "diffuse" && <span className="mt-0.5 block text-xs text-dim">{tx("{0} IP à 50 à 400 requêtes chacune ; Fail2ban ne les voit pas", r.dip)}</span>}
      </td>
    </tr>
  );
}

/** The sites the NPM serves, whatever machine runs each of them: the ones to look at first, every column sorts */
function Sites({ m }: Readonly<{ m: WebMachine }>) {
  const look = m.sites.filter(toLook);
  const [more, setMore] = useState(look.length === 0);
  const { sorted, ...sort } = useSort(more || !look.length ? m.sites : look, siteKey, "look");
  const th = (k: SiteKey, label: string, right = true, title?: string) => <Th k={k} sort={sort} title={title} className={right ? "text-right" : ""}>{label}</Th>;
  return (
    <div className="flex flex-col gap-2">
      {look.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipButton on={more} mark={<Eye size={12} aria-hidden />} label={tx("Afficher aussi les sites habituels")} count={m.sites.length - look.length} onClick={() => setMore(!more)} />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[880px] table-fixed border-collapse text-sm">
          <colgroup><col /><col className="w-40" /><col className="w-24" /><col className="w-24" /><col className="w-20" /><col className="w-36" /><col className="w-20" /><col className="w-56" /></colgroup>
          <thead><tr>
            {th("site", tx("Site"), false)}{th("last", tx("Dernière heure"), true, tx("Requêtes de la dernière heure complète, et l'écart avec l'heure habituelle"))}
            {th("usual", tx("Habituel"), true, tx("Moyenne horaire des jours d'avant"))}{th("total", tx("24 h"))}{th("ips", tx("IP 24 h"))}
            {th("share", tx("Part diffuse"), true, tx("Part des requêtes venues d'IP qui restent sous les seuils de Fail2ban (50 à 400 par jour chacune)"))}{th("errors", tx("5xx 24 h"))}{th("look", tx("Verdict"), false)}
          </tr></thead>
          <tbody>{sorted.map((r) => <SiteLine key={r.site} r={r} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

function MachinePanel({ m }: Readonly<{ m: WebMachine }>) {
  const reading = READING[loadReading(m)], look = m.sites.filter(toLook).length;
  return (
    <FoldPanel id={`security.traffic.${m.id}`} icon={Activity} title={tx("Nginx Proxy Manager de {0}", m.name)} count={look || undefined} tone={m.web.rising || look ? "warn" : undefined}
      end={<Dim>{tx("{0} site(s) servis, toutes machines confondues · journaux lus par {1}", m.sites.length, m.via === "agent" ? tx("l'agent") : "SSH")}</Dim>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <HourChart m={m} />
          <div className="lg:w-72">
            <DetailSection title={tx("Machine du NPM : {0}", m.name)} tone={m.web.rising ? "warn" : "link"}>
              <DetailRow k={tx("Charge maintenant")}>{m.load == null ? <Dim>-</Dim> : <b>{m.load.toFixed(1)}</b>}<Dim>{tx("pour {0} cœur(s)", m.ncpu)}</Dim></DetailRow>
              <DetailRow k={tx("Attente disque")}>{m.iowait == null ? <Dim>-</Dim> : <b className={m.iowait >= LOAD_DISK ? "text-warn" : ""}>{m.iowait} %</b>}</DetailRow>
              <DetailRow k={tx("Lecture")}><span className={reading[1]}>{reading[0]}</span></DetailRow>
            </DetailSection>
          </div>
        </div>
        <Sites m={m} />
      </div>
    </FoldPanel>
  );
}

type TopRow = ReturnType<typeof topIps>[number];
const topKey = (r: TopRow, k: string): string | number => (k === "n" ? r.n : r[k as "ip" | "site" | "machine"]);

function TopIps({ machines }: Readonly<{ machines: WebMachine[] }>) {
  const rows = topIps(machines), several = machines.length > 1, max = Math.max(1, ...rows.map((r) => r.n));
  const { sorted, ...sort } = useSort(rows, topKey, "n", false);
  if (!rows.length) return null;
  return (
    <FoldPanel id="security.traffic.top" icon={Network} title={tx("IP les plus actives, dernière heure")} count={rows.length}>
      <InfoNote className="mb-3">{tx("Seules les 10 adresses les plus actives de chaque NPM quittent sa machine ; les autres restent comptées sans leur adresse.")}</InfoNote>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
          <thead><tr>
            <Th k="ip" sort={sort}>{tx("Adresse")}</Th><Th k="site" sort={sort}>{tx("Site")}</Th>{several && <Th k="machine" sort={sort}>{tx("NPM")}</Th>}
            <Th k="n" sort={sort} className="w-48 text-right">{tx("Requêtes")}</Th>
          </tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.ip}/${r.site}/${r.machine}`} className="border-t border-line/60 even:bg-bg/50 hover:bg-bg2/40">
                <td className="truncate px-3 py-2 font-mono">{r.ip}</td>
                <td className="truncate px-3 py-2">{r.site}</td>
                {several && <td className="truncate px-3 py-2 text-muted">{r.machine}</td>}
                <td className={NUM}><span className="inline-flex items-center justify-end gap-2">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line/60" aria-hidden><span className="block h-full rounded-full bg-link/60" style={{ width: `${(100 * r.n) / max}%` }} /></span>
                  <b>{int(r.n)}</b></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FoldPanel>
  );
}

function Limits() {
  return (
    <DetailSection icon={SlidersHorizontal} title={tx("Seuils des alertes")} tone="link" right={<a href="#settings/alerts">{tx("Réglages › Alertes")}</a>}>
      <DetailRow k={tx("Pic de trafic")}>{tx("3 fois l'heure habituelle et au moins 1 000 requêtes en une heure")}</DetailRow>
      <DetailRow k={tx("Aspiration diffuse")}>{tx("plus de 40 % des requêtes d'un site, venues d'au moins 30 IP à 50 à 400 requêtes chacune")}</DetailRow>
      <DetailRow k={tx("Erreurs 5xx")}>{tx("plus de 5 % d'au moins 50 requêtes sur 10 min (sur la page, sans envoi)")}</DetailRow>
      <DetailRow k={tx("Robots connus")}>{tx("comptés à part, hors de l'aspiration diffuse")}</DetailRow>
      <DetailRow k={tx("Charge haute")}>{tx("affichée à côté du trafic, jamais une alerte seule")}</DetailRow>
    </DetailSection>
  );
}

/** The page: the figures of every machine together, one panel per machine, the busiest addresses and the limits */
export function WebTraffic({ machines }: Readonly<{ machines: WebMachine[] }>) {
  const last = machines.reduce((n, m) => n + (m.web.last ?? 0), 0), ips = machines.reduce((n, m) => n + m.web.ips, 0);
  const usual = machines.every((m) => m.web.usual != null) ? machines.reduce((n, m) => n + (m.web.usual ?? 0), 0) : null;
  const scrapers = machines.reduce((n, m) => n + m.sites.filter((r) => r.verdict === "diffuse").reduce((a, r) => a + r.dip, 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <StatTile n={int(last)} label={tx("Requêtes, dernière heure")} tone={machines.some((m) => m.web.rising) ? "warn" : undefined} />
        <StatTile n={usual == null ? "-" : int(usual)} label={tx("Heure habituelle")} sub={usual == null ? tx("connue après 6 h d'historique") : undefined} />
        <StatTile n={int(ips)} label={tx("IP distinctes, 24 h")} />
        <StatTile n={int(scrapers)} label={tx("IP d'aspiration diffuse")} tone={scrapers ? "warn" : undefined} />
      </div>
      {machines.map((m) => <MachinePanel key={m.id} m={m} />)}
      <TopIps machines={machines} />
      <Limits />
      <p className="flex items-center gap-1.5 text-xs text-dim"><Globe size={12} aria-hidden />{tx("Lu dans les journaux de Nginx Proxy Manager de chaque machine, par son agent ou par SSH, toutes les 10 à 15 min.")}</p>
    </div>
  );
}
