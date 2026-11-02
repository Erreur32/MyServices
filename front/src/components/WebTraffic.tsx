// The Web traffic page of Security: per machine whose Nginx Proxy Manager logs are read (agent or SSH), its requests per hour over 24 h against
// its usual hour, the load beside it (a high load from the disks is not an attack), its sites with the diffuse scraping and the 5xx, then the
// busiest addresses of the last hour and the limits of the alerts.
import { Activity, Eye, Globe, Network, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { tx } from "../lib/i18n";
import { LOAD_DISK, loadReading, toLook, topIps, type SiteRow, type SiteVerdict, type WebMachine } from "../lib/webTraffic";
import { DetailRow, DetailSection } from "./DetailSection";
import { FoldPanel } from "./FoldPanel";
import { InfoNote } from "./InfoNote";
import { StatTile } from "./StatTile";
import { Badge, ChipButton, Dim } from "./ui";

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

const SITE_COLS = "grid gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1.6fr)_4.5rem_4.5rem_4.5rem_4.5rem_4rem_minmax(0,1.4fr)]";

function Num({ k, children }: Readonly<{ k: string; children: ReactNode }>) {
  return <span className="flex items-center gap-2 tabular-nums md:block md:text-right"><span className="text-xs text-dim md:hidden">{k}</span>{children}</span>;
}

function SiteLine({ r }: Readonly<{ r: SiteRow }>) {
  const [label, tone] = VERDICT[r.verdict];
  return (
    <li className={`${SITE_COLS} items-center px-2 py-2`}>
      <span className="truncate font-semibold" title={r.site}>{r.site}</span>
      <Num k={tx("1 h")}>{int(r.last)}</Num>
      <Num k={tx("Habituel")}>{r.usual == null ? <Dim>-</Dim> : int(r.usual)}</Num>
      <Num k={tx("IP 24 h")}>{int(r.ips)}</Num>
      <Num k={tx("Part diffuse")}><span className={r.verdict === "diffuse" ? "font-semibold text-warn" : ""}>{r.share} %</span></Num>
      <Num k={tx("5xx 24 h")}>{r.errors ? <span className="text-warn">{int(r.errors)}</span> : <Dim>0</Dim>}</Num>
      <span className="min-w-0"><Badge tone={tone}>{label}</Badge>
        {r.verdict === "diffuse" && <span className="block truncate text-xs text-dim">{tx("{0} IP à 50 à 400 requêtes chacune ; Fail2ban ne les voit pas", r.dip)}</span>}
      </span>
    </li>
  );
}

function Sites({ m }: Readonly<{ m: WebMachine }>) {
  const look = m.sites.filter(toLook);
  const [more, setMore] = useState(look.length === 0);
  const rows = more || !look.length ? m.sites : look;
  return (
    <div className="flex flex-col gap-2">
      {look.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipButton on={more} mark={<Eye size={12} aria-hidden />} label={tx("Afficher aussi les sites habituels")} count={m.sites.length - look.length} onClick={() => setMore(!more)} />
        </div>
      )}
      <div className={`${SITE_COLS} hidden border-b border-line px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-dim md:grid`} aria-hidden>
        <span>{tx("Site")}</span><span className="text-right">{tx("1 h")}</span><span className="text-right">{tx("Habituel")}</span><span className="text-right">{tx("IP 24 h")}</span>
        <span className="text-right">{tx("Part diffuse")}</span><span className="text-right">{tx("5xx 24 h")}</span><span>{tx("Verdict")}</span>
      </div>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">{rows.map((r) => <SiteLine key={r.site} r={r} />)}</ul>
    </div>
  );
}

function MachinePanel({ m }: Readonly<{ m: WebMachine }>) {
  const reading = READING[loadReading(m)], look = m.sites.filter(toLook).length;
  return (
    <FoldPanel id={`security.traffic.${m.id}`} icon={Activity} title={tx("{0} · requêtes par heure", m.name)} count={look || undefined} tone={m.web.rising || look ? "warn" : undefined}
      end={<Dim>{tx("journaux NPM, lus par {0}", m.via === "agent" ? tx("l'agent") : "SSH")}</Dim>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <HourChart m={m} />
          <div className="lg:w-72">
            <DetailSection title={tx("Machine")} tone={m.web.rising ? "warn" : "link"}>
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

function TopIps({ machines }: Readonly<{ machines: WebMachine[] }>) {
  const rows = topIps(machines), several = machines.length > 1;
  if (!rows.length) return null;
  return (
    <FoldPanel id="security.traffic.top" icon={Network} title={tx("IP les plus actives, dernière heure")} count={rows.length}>
      <InfoNote className="mb-3">{tx("Seules les 10 adresses les plus actives de chaque machine quittent la machine ; les autres restent comptées sans leur adresse.")}</InfoNote>
      <ul className="flex flex-col divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">
        {rows.map((r) => (
          <li key={`${r.ip}/${r.site}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5rem] items-center gap-x-4 px-2 py-1.5">
            <span className="truncate font-mono">{r.ip}</span>
            <span className="truncate">{r.site}{several && <Dim> · {r.machine}</Dim>}</span>
            <span className="text-right font-semibold tabular-nums">{int(r.n)}</span>
          </li>
        ))}
      </ul>
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
