// Services: a title line, the figures, the services newly seen on the machines (admin), then every real service as a compact card, by
// application or by machine; a card opens its places (machine, address, domain, access, state). The plumbing stays folded at the bottom.
import { scoreTone } from "../lib/figureTones";
import { usePageView } from "../lib/route";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ExternalLink, EyeOff, Globe, Layers, Pencil, Plus, Server, Boxes, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { send, type Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { ipNum } from "../lib/format";
import { Dot, Logo } from "../components/marks";
import { appIcon, serviceIcon } from "../lib/appIcons";
import { CHECK, CLEANUP, KIND_NAME, checks, exposure, hostName, openUrl, status, type Check } from "../lib/status";
import type { Host } from "../types";
import { Badge, Empty, FilterBar, type Tone } from "../components/ui";
import { ServiceDetail } from "./ServiceDetail";
import { ServiceEdit } from "../components/ServiceEdit";
import { IconGlyph } from "../components/IconPicker";
import { chosenIcon } from "../lib/machineIcons";
import { tx } from "../lib/i18n";
import { PublicIgnore } from "../components/PublicIgnore";
import { FoldPanel } from "../components/FoldPanel";
import { NewServices } from "../components/NewServices";
import { ManualActions, ManualService, type ManualInitial } from "../components/ManualService";
import { StatTile } from "../components/StatTile";
import { primary, quiet } from "../lib/forms";
import { figures, mergePorts, toWatch } from "../lib/servicesState";
import { groupServices, groupsTitle, hostDomains, sections, toCheck, type GroupTone, type ServiceGroup } from "../lib/serviceGroups";
import { HeadTags } from "../components/HeadTags";
import { PageHead } from "../components/PageHead";
import { HistoryTile, useServicesHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import type { Period } from "../lib/tileHistory";
import { flash } from "../lib/flash";
import { isHidden, serviceKey, setServiceHidden, useServicesHidden, type HiddenMap } from "../lib/servicesHidden";

const ST_TONE: Record<string, Tone> = { ok: "ok", warn: "warn", bad: "bad", off: "off" };
const ST_NAME: Record<string, string> = { ok: "OK", warn: "avertissement", bad: tx("en panne"), off: tx("désactivé / non testé") };
const TYPE_NAME: Record<string, string> = { proxy: tx("Proxy NPM"), redirect: "Redirection", dead: "404", stream: "Stream", local: tx("Service") };
const EXPO: Record<string, [Tone, string, string]> = {
  prive: ["ok", tx("🔒 protégé"), tx("Seul le réseau local ou le VPN peut l'ouvrir, grâce à une liste d'accès NPM (ACL) ou à une garde LAN dans la configuration.")],
  public: ["info", tx("🌍 public"), tx("Ouvert à Internet volontairement : le site est déclaré public, sans liste d'accès.")],
  ouvert: ["warn", tx("⚠ public ?"), tx("Public à confirmer : ni liste d'accès ni déclaration « public », le site est joignable depuis Internet. Si c'est voulu, « Site public voulu » dans sa fiche (Détail).")],
};
const domainMark = (v: string) => <Dot tone={v === "with" ? "info" : "off"} />;

function domainSource(r: Host): string {
  if (r.domains.length) return "NPM";
  return r.vhost_server === "nginx" ? "nginx" : "Apache";
}
const hostIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";
const keyOfRow = serviceKey;

const VIEW_KEY = "myservices.services.view";

/** By application unless the machines were chosen last time, remembered in this browser only; the page works without it */
function useByMachine(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === "machine"; } catch { return false; } });
  const set = (v: boolean) => { setOn(v); try { localStorage.setItem(VIEW_KEY, v ? "machine" : "app"); } catch { /* navigation privée : tant pis */ } };
  return [on, set];
}

/** Where the service is read from: its NPM entry, or the kind of service found on the machine */
const via = (r: Host) => (r.type === "local" ? KIND_NAME[r.service?.kind ?? ""] || TYPE_NAME.local : TYPE_NAME[r.type]);

/** NPM entries served without a forced SSL: the only access risk worth a mark in the list (the rest is in the window) */
function sslRisk(r: Host): string | null {
  if (r.type !== "proxy") return null;
  if (!r.ssl) return tx("sans SSL");
  return r.ssl_forced ? null : tx("SSL non forcé");
}

/** Tooltip of the « Via » badge: where the service is read from, and the real NPM target when the advanced config overrides the declared one */
function sourceTip(r: Host): string {
  const lines = [tx("Source"), tx("Lu via : {0}", via(r))];
  if (r.forward_declared) lines.push(tx("Cible réelle : {0}:{1} (advanced_config). NPM déclare {2}, ignoré.", r.ip, r.port, r.forward_declared));
  return lines.join("\n");
}

/** The small icons after the state, one gap apart: access (protected, public, public?), domains found for a machine's service (an NPM host
 *  always has its own, the « Proxy NPM » badge says it), weak HTTPS */
function Marks({ r }: Readonly<{ r: Host }>) {
  const e = exposure(r), risk = sslRisk(r), domains = r.type === "local" ? hostDomains(r) : [];
  return (
    <>
      {e && <Badge tone={EXPO[e][0]} title={`${EXPO[e][1].replace(/^\S+\s/, "")}\n${EXPO[e][2]}`}>{EXPO[e][1].split(" ")[0]}</Badge>}
      {domains.length > 0 && <Badge tone="info" title={`${tx("Domaines déclarés ({0})", domainSource(r))}\n${domains.join("\n")}`}>🌐</Badge>}
      {risk && <Badge tone={r.ssl ? "warn" : "bad"} title={`${risk}\n${tx("Ouvrez la fiche pour le détail de l'accès.")}`}>🔓</Badge>}
    </>
  );
}

/** The state as one badge per piece of information (« OK · redirige » -> « OK » and « redirige »): the first in the colour of the state, then where it
 *  is read (`source`: Proxy NPM, Apache, nginx, Docker…), then the other pieces, plain */
function StateBadges({ cls, label, title, flagged = false, source }: Readonly<{ cls: string; label: string; title?: string; flagged?: boolean; source?: React.ReactNode }>) {
  const [head, ...rest] = label.split(" · ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={title}>
      <Badge tone={ST_TONE[cls]}>{head}{flagged && <span className="ml-1">⚑</span>}</Badge>
      {source}
      {rest.map((x) => <Badge key={x} tone="off" outline>{x}</Badge>)}
    </span>
  );
}

/** Logo du service, dans sa propre colonne pour ne pas déformer le nom ; la place est gardée quand il n'y en a pas */
function ServiceLogo({ r, auto = false }: Readonly<{ r: Host; auto?: boolean }>) {
  const chosen = auto ? undefined : chosenIcon(r.icon);   // auto: the logo the detection picks, shown by the icon picker
  if (chosen) return <span className="grid h-10 w-10 min-w-10 shrink-0 place-items-center rounded-md bg-bg2" title={chosen.label}><IconGlyph icon={chosen} size={28} /></span>;
  const src = serviceIcon(r);
  return src ? <span className="grid h-10 w-10 min-w-10 shrink-0 place-items-center rounded-md bg-bg2" title={r.app?.label || r.service?.name}><img src={src} alt="" className="h-7 w-7" /></span> : <span className="block h-10 w-10 shrink-0" aria-hidden />;
}

const KIND_LOGO = new Set(["docker", "apache", "nginx"]);  // types de service qui ont un logo dans public/icons

/** Every port of the service a row belongs to (itself alone when it has one port) */
function portsOf(r: Host, hosts: Host[]): Host[] {
  return mergePorts(hosts.filter((h) => h.type === "local")).find((l) => l.ports.includes(r))?.ports ?? [r];
}

/** The rows that are the same service seen from elsewhere: an NPM host and the container or process behind it (same machine, same service
 *  name, or a target on one of its ports), in both directions */
function relatedOf(r: Host, hosts: Host[]): Host[] {
  const ip = (h: Host) => h.host_ip || h.ip;
  const mine = portsOf(r, hosts), ports = new Set(mine.map((h) => h.port)), name = r.service?.name;
  return hosts.filter((h) => !mine.includes(h) && h.type !== r.type && (h.type === "local" || r.type === "local") && ip(h) && ip(h) === ip(r)
    && ((name && h.service?.name === name) || (h.port != null && ports.has(h.port))));
}

/** Port chips stay on one line while the address and the ports fit the Target column (about 38 characters, 4 ports at most), else they wrap */
const ONE_LINE_CHARS = 38;
const oneLine = (ip: string | null | undefined, ports: Host[]): boolean =>
  ports.length <= 4 && (ip ?? "").length + ports.reduce((n, p) => n + String(p.port ?? "").length + 3, 0) <= ONE_LINE_CHARS;

/** The target of a service on several ports: its address, then one chip per port in the colour of that port's state; a chip opens that port's detail */
function PortChips({ ip, ports, onPort }: Readonly<{ ip?: string | null; ports: Host[]; onPort?: (p: Host) => void }>) {
  const edge: Record<string, string> = { bad: "border-bad/60 text-bad", warn: "border-warn/60 text-warn", ok: "border-ok/40", off: "border-line text-dim" };
  return (
    <span className={`inline-flex items-center gap-1 ${oneLine(ip, ports) ? "flex-nowrap" : "flex-wrap"}`}>
      <span>{ip}</span>
      {ports.map((p) => (
        <button key={p.port} type="button" className={`shrink-0 rounded border px-1 text-[11px] leading-5 hover:border-link ${edge[status(p)[0]] ?? "border-line"}`} title={`${status(p)[1]} · ${status(p)[2]}`}
          onClick={(e) => { e.stopPropagation(); onPort?.(p); }}>:{p.port}</button>
      ))}
    </span>
  );
}

/** The target column: where the service listens, or where a redirect goes */
function targetOf(r: Host): string {
  if (r.type === "redirect") return `→ ${r.target}`;
  return r.type === "dead" ? tx("aucune (404)") : `${r.ip}:${r.port}`;
}

/** Hide a service from « To watch » or show it back, the same button as there: a service with a known problem (down, warning, point to check)
 *  is hidden until its problem changes, any other one (online, stopped on purpose) is no longer followed at all until shown back */
function HideToggle({ r, hidden, watched }: Readonly<{ r: Host; hidden: boolean; watched: boolean }>) {
  const toggle = (e: { stopPropagation: () => void }) => { e.stopPropagation(); void setServiceHidden(r, hostName(r), !hidden, !watched); };
  if (hidden) return <button type="button" className="shrink-0 text-dim hover:text-txt" title={tx("Afficher de nouveau dans les alertes")} aria-label={tx("Afficher de nouveau dans les alertes")} onClick={toggle}><Undo2 size={15} aria-hidden /></button>;
  const tip = watched ? tx("Masquer des alertes et du point du menu tant que le problème ne change pas")
    : tx("Ne plus suivre ce service : plus jamais dans les alertes ni dans le point du menu, même en panne, jusqu'à ce qu'il soit réaffiché");
  return <button type="button" className="shrink-0 text-dim hover:text-txt" title={tip} aria-label={tx("Masquer des alertes")} onClick={toggle}><EyeOff size={15} aria-hidden /></button>;
}

const SERVICE_VIEWS = ["watch", "all", "fresh", "item", "edit", "manual", "new"] as const;
/** The page of one service and its settings: #services/item/<key>, #services/edit/<key> (meta), #services/manual/<key> (a declared one) */
const servicePage = (view: string, r: Host) => `services/${view}/${encodeURIComponent(keyOfRow(r))}`;
const openService = (r: Host) => { location.hash = servicePage("item", r); };

const GROUP_TEXT: Record<GroupTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", off: "text-muted" };
const GROUP_DOT: Record<GroupTone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", off: "bg-dim" };
const GROUP_EDGE: Record<GroupTone, string> = { ok: "border-dim/50", warn: "border-warn/50", bad: "border-bad/60", off: "border-dim/50" };
const groupState = (g: ServiceGroup) => ({ ok: tx("En ligne"), warn: tx("À vérifier"), bad: tx("En panne"), off: tx("Désactivé") })[g.tone];

/** One row of an opened card: where the service runs; a click opens its page */
function PlaceRow({ r, ports, hidden, watched, admin }: Readonly<{ r: Host; ports: Host[]; hidden: boolean; watched: boolean; admin: boolean }>) {
  const [cls, label, why] = status(r), domains = hostDomains(r), flags = checks(r).filter((k) => !CLEANUP.includes(k)).map((k) => `⚑ ${CHECK[k][0]}`);
  return (
    <tr onClick={() => openService(r)} className={`cursor-pointer border-t border-line even:bg-bg/30 hover:!bg-link/10 ${r.enabled ? "" : "opacity-60"}`}>
      <td className="px-3 py-1.5 font-semibold">{r.machine || hostIp(r) || "-"}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-muted">{ports.length > 1 ? <PortChips ip={r.ip} ports={ports} onPort={openService} /> : targetOf(r)}</td>
      <td className="px-3 py-1.5">{domains.length ? <span title={domains.join("\n")}>{domains[0]}{domains.length > 1 && <span className="ml-1 text-xs text-dim">+{domains.length - 1}</span>}</span> : <span className="text-dim">{tx("aucun")}</span>}</td>
      <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1"><Marks r={r} /></span></td>
      <td className="px-3 py-1.5"><span className={hidden ? "opacity-40 grayscale" : ""}><StateBadges cls={cls} label={label} title={[label, why, ...flags].filter(Boolean).join("\n")} flagged={flags.length > 0} source={<Badge tone="off" title={sourceTip(r)}>{via(r)}</Badge>} /></span></td>
      <td className="px-3 py-1.5">{admin && <span className="flex items-center justify-end gap-2">
        {watched && exposure(r) === "ouvert" && r.domains[0] && (
          <button type="button" className="text-dim hover:text-ok" title={tx("Ouvert à Internet volontairement (site, blog, page de contact) : ne plus le signaler")} aria-label={tx("Site public voulu")}
            onClick={(e) => { e.stopPropagation(); void send("PUT", "services/public", { domain: r.domains[0], public: true }).catch(() => undefined); }}><Globe size={15} aria-hidden /></button>
        )}
        <HideToggle r={r} hidden={hidden} watched={watched} />
        <button type="button" className="shrink-0 text-dim hover:text-link" title={tx("Modifier")} aria-label={tx("Modifier")} onClick={(e) => { e.stopPropagation(); location.hash = servicePage("edit", r); }}><Pencil size={15} aria-hidden /></button>
      </span>}</td>
    </tr>
  );
}

/** The row that speaks for a service: an enabled one that opens, best on the service's first domain, else on any domain, else the first row */
function leadOf(g: ServiceGroup): Host | undefined {
  const usable = g.hosts.filter((r) => r.enabled && openUrl(r));
  return usable.find((r) => hostDomains(r).includes(g.domains[0])) ?? usable.find((r) => hostDomains(r).length) ?? usable[0] ?? g.hosts[0];
}

/** The line under a service's name when it has no domain: its address, or where a connector reads it */
function addressOf(g: ServiceGroup, lead?: Host): string {
  if (lead?.ip) {
    const port = lead.port ? `:${lead.port}` : "";
    return `${lead.machine || lead.ip}${port}`;
  }
  return g.cloud ? tx("Hébergé en ligne") : g.cards[0]?.url ?? "";
}

function whereOf(g: ServiceGroup): string {
  if (g.cloud) return "Cloud";
  if (!g.machines.length) return tx("Lu par un connecteur");
  if (g.machines.length > 3) return `${g.machines.slice(0, 3).join(", ")} ${tx("et {0} autres", g.machines.length - 3)}`;
  return g.machines.join(", ");
}

function moreDomains(n: number): string {
  if (n > 2) return tx("+{0} domaines", n - 1);
  return n === 2 ? tx("+1 domaine") : "";
}

/** A service with no row of its own takes the logo of its name; the place is kept when it has none */
function GroupLogo({ name, lead }: Readonly<{ name: string; lead?: Host }>) {
  if (lead) return <ServiceLogo r={lead} />;
  const src = appIcon([name]);
  return src ? <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg2"><img src={src} alt="" className="h-7 w-7" /></span> : <span className="block h-10 w-10 shrink-0" aria-hidden />;
}

/** The places of an opened card: a row per place, or the connector cards of a service that runs on no machine */
function PlacesTable({ g, hiddenMap, watchKeys, admin }: Readonly<{ g: ServiceGroup; hiddenMap: HiddenMap; watchKeys: Set<string>; admin: boolean }>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted">{[tx("Machine"), tx("Adresse"), tx("Domaine"), tx("Accès"), tx("État"), ""].map((h) => <th key={h} className="px-3 py-1.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>
          {mergePorts(g.hosts).map(({ lead: r, ports }) => <PlaceRow key={keyOfRow(r)} r={r} ports={ports} hidden={isHidden(r, hiddenMap)} watched={watchKeys.has(keyOfRow(r))} admin={admin} />)}
          {!g.hosts.length && g.cards.map((c) => (   // read by a connector only: the same columns, nothing runs on a machine
            <tr key={c.name} className="border-t border-line">
              <td className="px-3 py-1.5 font-semibold">{g.cloud ? "Cloud" : tx("Lu par un connecteur")}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-muted">{c.url || tx("Hébergé en ligne")}</td>
              <td className="px-3 py-1.5 text-dim">{tx("aucun")}</td>
              <td className="px-3 py-1.5">{g.cloud ? tx("Internet") : tx("Local")}</td>
              <td className="px-3 py-1.5"><Badge tone={ST_TONE[g.tone]}>{groupState(g)}</Badge></td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One service: the top opens it, the link under its name opens the service itself */
function ServiceCard({ g, open, focus, onToggle, hiddenMap, watchKeys, admin }: Readonly<{ g: ServiceGroup; open: boolean; focus: boolean; onToggle: () => void; hiddenMap: HiddenMap; watchKeys: Set<string>; admin: boolean }>) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) setTimeout(() => flash(box.current?.querySelector<HTMLElement>("[data-watch]") ?? box.current), 120); }, [focus]);   // reached by a link (#services/all/<key>): show what to check
  const lead = leadOf(g);
  const url = lead ? openUrl(lead) : g.cards[0]?.url;
  const text = g.domains[0] ?? addressOf(g, lead);
  const more = [moreDomains(g.domains.length), g.hosts.some((r) => exposure(r) === "public" || exposure(r) === "ouvert") ? tx("Public") : ""].filter(Boolean).join(" · ");
  const reasons = g.hosts.filter((r) => status(r)[0] !== "off").flatMap((r) => checks(r).filter((k) => !CLEANUP.includes(k)).map((k) => ({ k, where: hostDomains(r)[0] ?? targetOf(r) })));   // what turned the card « À vérifier »
  return (
    <article ref={box} className={`min-w-0 rounded-xl border bg-bg2 ${open ? "col-span-full border-link" : GROUP_EDGE[g.tone]}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} title={open ? tx("Fermer") : tx("Ouvrir")} className="group flex w-full items-center gap-2.5 rounded-t-xl px-3 pt-2.5 text-left hover:bg-link/10">
        <GroupLogo name={g.name} lead={lead} />
        <span className="min-w-0 flex-1"><b className="block truncate text-sm">{g.name}</b><span className="block truncate text-xs text-muted" title={g.machines.join(", ")}>{whereOf(g)}</span></span>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold ${GROUP_TEXT[g.tone]}`}><span className={`h-2 w-2 rounded-full ${GROUP_DOT[g.tone]}`} aria-hidden />{groupState(g)}</span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform group-hover:text-link ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div className="flex min-w-0 items-center gap-2 px-3 pb-2.5 pl-[3.875rem] pt-0.5 text-xs">
        {url ? <a href={url} target="_blank" rel="noopener" className="inline-flex min-w-0 items-center gap-1 font-semibold text-link hover:underline"><span className="truncate">{text}</span><ExternalLink size={12} className="shrink-0" aria-hidden /></a> : <span className="truncate text-muted">{text}</span>}
        {more && <span className="ml-auto shrink-0 text-muted">{more}</span>}
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line/60 p-3">
          {(g.hosts.length > 0 || g.cards.length > 0) && <PlacesTable g={g} hiddenMap={hiddenMap} watchKeys={watchKeys} admin={admin} />}
          {reasons.length > 0 && <div data-watch="check" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2">
              <h4 className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warn"><AlertTriangle size={14} aria-hidden />{tx("À vérifier")}</h4>
              <ul className="divide-y divide-warn/20 text-sm">{reasons.map(({ k, where }) => <li key={`${k}:${where}`} className="py-1"><b>{CHECK[k][0]}</b> <span className="text-muted">({where})</span> : {CHECK[k][1]}</li>)}</ul>
            </div>}
          {g.problems.length > 0 && <div data-watch="problems" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2">
              <h4 className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warn"><AlertTriangle size={14} aria-hidden />{tx("À regarder")}</h4>
              <ul className="divide-y divide-warn/20 text-sm">{g.problems.map((p) => <li key={p} className="py-1">{p}</li>)}</ul>
            </div>}
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            {lead && <a href={`#${servicePage("item", lead)}`} className="text-link hover:underline">{tx("Fiche du service")}</a>}
            {g.cards.some((c) => c.connector === "netatmo") && <a href="#domotique/netatmo" className="text-link hover:underline">{tx("Ouvrir la page")}</a>}
            {g.cards.length > 0 && <a href="#settings/connectors" className="text-link hover:underline">{tx("Connecteur {0}", g.cards[0].label)}</a>}
          </div>
        </div>
      )}
    </article>
  );
}

/** In alert, as the menu's dot counts it: down, in warning or with a point to check, unless hidden from the alerts */
const alertMark = () => <Dot tone="bad" />;
const todoMark = () => <Dot tone="warn" />;
const cloudMark = () => <Dot tone="info" />;
const statusMark = (v: string) => <Dot tone={v as Tone} />;
const checkMark = (v: string) => <Dot tone={CLEANUP.includes(v as Check) ? "off" : "warn"} />;
const appMark = (v: string) => { const i = appIcon([v]); return i ? <Logo src={i} /> : null; };
/** The « Domain » facet: a service hosted online has neither value */
function domainFacet(g: ServiceGroup): string {
  if (g.cloud) return "";
  return g.domains.length ? "with" : "without";
}
/** A service in alert, as the menu's dot and the home page count them: down or with a warning, not hidden from the alerts. A service that is
 *  OK with a remark (certificate, web check…) is under « À vérifier », not here. */
export const alerting = (r: Host, hidden: HiddenMap): boolean => { const c = status(r)[0]; return (c === "bad" || c === "warn") && !isHidden(r, hidden); };

/** The figure tiles above the list of services, with their history over the period (the tiles leave out the services hidden from « To watch ») */
function ServicesTiles({ hosts, hidden, generated, hours }: Readonly<{ hosts: Host[]; hidden: HiddenMap; generated: string; hours: Period }>) {
  const hist = useServicesHistory(hours, generated), now = Math.floor(Date.now() / 1000);
  const every = figures(hosts), fig = figures(hosts.filter((r) => !isHidden(r, hidden)));
  const followed = every.ok + every.warn + every.bad, health = followed ? Math.round((every.ok / followed) * 100) : 0;
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      <HistoryTile n={fig.ok} label={tx("En ligne")} tone="ok" kind="curve" points={hist?.up ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={(p) => `${p[1]}/${p[2]}`} goodHigh />
      <HistoryTile n={fig.bad} label={tx("En panne")} tone={fig.bad ? "bad" : undefined} kind="strip" points={hist?.up ?? null} hours={hours} now={now} figure={(p) => p[2] - p[1]} fmt={(p) => tx("{0} en panne", p[2] - p[1])} goodHigh={false} />
      <HistoryTile n={fig.warn} label={tx("Avertissement")} tone={fig.warn ? "warn" : undefined} fact={fig.warnWhy.join(", ")} kind="strip" points={hist?.warn ?? null} hours={hours} now={now} figure={(p) => p[2] - p[1]} fmt={(p) => tx("{0} en avertissement", p[2] - p[1])} goodHigh={false} />
      <HistoryTile n={followed ? `${health} %` : "-"} label={tx("Santé des services")} tone={followed ? scoreTone(health, 90, 70) : undefined} fact={tx("{0} en avertissement · {1} en panne", every.warn, every.bad)} scale={100} kind="curve" points={hist?.health ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={(p) => `${p[1]} %`} goodHigh />
      <StatTile n={fig.toCheck} label={tx("À vérifier")} tone={fig.toCheck ? "warn" : undefined} sub={fig.checkWhy.map((k) => CHECK[k][0]).join(", ") || tx("rien à confirmer")} />
    </div>
  );
}

export function Services({ snap, initial, route }: Readonly<{ snap: Snapshot; initial?: Selected; route: string }>) {
  const hiddenMap = useServicesHidden();
  const machines = useMemo(() => new Map(snap.data.machine_list.map((m) => [m.ip, m.name])), [snap.data.machine_list]);
  const groups = useMemo(() => groupServices(snap.data.hosts, snap.data.services_status ?? [], (r) => isHidden(r, hiddenMap)), [snap.data.hosts, snap.data.services_status, hiddenMap]);
  const facets = useMemo((): Facet<ServiceGroup>[] => [
    { key: "todo", label: tx("À vérifier"), get: (g) => (toCheck(g) ? "on" : ""), name: () => tx("à vérifier"), mark: todoMark },
    { key: "expo", label: tx("Accès"), get: (g) => [...new Set(g.hosts.flatMap((r) => exposure(r) ?? []))], name: (v) => EXPO[v]?.[1].replace(/^\S+\s/, "") ?? v, order: ["public", "ouvert", "prive"] },
    { key: "domain", label: tx("Domaine"), get: domainFacet, name: (v) => (v === "with" ? tx("avec domaine") : tx("sans domaine")), order: ["with", "without"],
      mark: domainMark },
    { key: "cloud", label: "Cloud", get: (g) => (g.cloud ? "on" : ""), name: () => "Cloud", mark: cloudMark },
    { key: "alert", label: tx("Alertes"), get: (g) => (g.hosts.some((r) => alerting(r, hiddenMap)) ? "on" : ""), name: () => tx("en alerte"), mark: alertMark },   // ticked by the menu's dot (DOT_FILTER) and the old « To watch » address
    { key: "src", label: tx("Source"), get: (g) => [...new Set(g.hosts.map((r) => (r.type === "local" ? "local" : "npm")))], name: (v) => (v === "npm" ? "NPM" : tx("Services")), order: ["npm", "local"],
      mark: (v) => (v === "npm" ? <Logo src={`${import.meta.env.BASE_URL}icons/nginx-proxy-manager.svg`} /> : <Dot tone="info" />) },
    { key: "status", label: tx("État"), get: (g) => [...new Set(g.hosts.map((r) => status(r)[0]))], name: (v) => ST_NAME[v] || v, order: ["bad", "warn", "ok", "off"], mark: statusMark },
    { key: "check", label: tx("Points"), get: (g) => [...new Set(g.hosts.flatMap(checks))], name: (v) => CHECK[v as Check]?.[0] || v, mark: checkMark },
    { key: "machine", label: tx("Machine"), get: (g) => g.hosts.map(hostIp), name: (v) => machines.get(v) || v },
    { key: "cat", label: tx("Catégorie"), get: (g) => g.hosts.map((r) => r.category || "") },
    { key: "app", label: tx("Appli"), get: (g) => g.hosts.map((r) => r.app?.label || ""), mark: appMark },
    { key: "kind", label: tx("Type"), get: (g) => g.hosts.map((r) => r.service?.kind || ""), name: (v) => KIND_NAME[v] || v,
      mark: (v) => (KIND_LOGO.has(v) ? <Logo src={`${import.meta.env.BASE_URL}icons/${v}.svg`} /> : null) },
  ], [machines, hiddenMap]);
  const text = useCallback((g: ServiceGroup) => [g.name, ...g.domains, ...g.machines, ...g.hosts.flatMap((r) => [r.name, r.ip, r.port, r.target, r.category, r.service?.name, r.service?.image, r.service?.title, r.description])].join(" "), []);
  // Everything shows by default; a filter asked elsewhere (home page counter, machine) is kept as it is
  const f = useFilter(groups, facets, text, route.startsWith("#services/watch") ? { alert: ["on"] } : initial);   // the old « To watch » address: the alerts
  const [byMachine, setByMachine] = useByMachine(), [opened, setOpened] = useState(""), [techOpen, setTechOpen] = useState(false);
  const watching = groups.filter(toCheck).length;
  const keyOf = useCallback((g: ServiceGroup, k: string): string | number => {
    const r = g.hosts[0];
    switch (k) {
      case "status": return ["bad", "warn", "ok", "off"].indexOf(g.tone);
      case "machine": return (g.machines[0] || "~").toLowerCase();
      case "target": return r?.ip ? ipNum(r.ip) * 65536 + (r.port || 0) : Number.MAX_SAFE_INTEGER;
      default: return g.name.toLowerCase();
    }
  }, []);
  const sort = useSort(f.shown, keyOf, "status");
  const shownReal = sort.sorted.filter((g) => !g.tech), shownTech = sort.sorted.filter((g) => g.tech);
  // #services/all/<key>: a link from the home page opens that service, even behind a filter or among the technical components
  const focusKey = route.startsWith("#services/all/") ? decodeURIComponent(route.split("/")[2] ?? "") : "";
  const focused = focusKey ? groups.find((g) => g.hosts.some((r) => keyOfRow(r) === focusKey)) : undefined;
  useEffect(() => {
    if (!focused) return;
    setOpened(focused.key);
    if (focused.tech) setTechOpen(true);
    if (!f.shown.some((g) => g.key === focused.key)) f.reset();
  }, [focused?.key]);   // eslint-disable-line react-hooks/exhaustive-deps -- once per link, a new reading must not reopen a card closed since
  const card = (g: ServiceGroup) => <ServiceCard key={g.key} g={g} open={opened === g.key} focus={focused?.key === g.key} onToggle={() => setOpened(opened === g.key ? "" : g.key)} hiddenMap={hiddenMap} watchKeys={watchKeys} admin={admin} />;
  const viewButton = (on: boolean, label: string, Icon: typeof Layers, pick: boolean) => (
    <button type="button" onClick={() => setByMachine(pick)} aria-pressed={on} title={label} aria-label={label} className={`rounded-lg border p-2 transition-colors ${on ? "border-link bg-link/15 text-txt" : "border-line text-link hover:bg-link/10"}`}><Icon size={15} aria-hidden /></button>
  );

  const [hours, setHours] = usePeriod();
  const every = figures(snap.data.hosts), watchAll = toWatch(snap.data.hosts), admin = snap.me.role === "admin";   // the tiles leave out the services hidden from « To watch », the header counts them all
  const watchKeys = new Set(watchAll.map(keyOfRow));
  const view = usePageView(route, "services", SERVICE_VIEWS, "all");   // « To watch » is no longer a page: the alerts are a filter of the list
  const pageKey = decodeURIComponent(route.split("/")[2] ?? "");
  const page = ["item", "edit", "manual"].includes(view) ? snap.data.hosts.find((r) => keyOfRow(r) === pageKey) : undefined;
  if (view === "new" || (page && view === "manual")) return <ServicePageSettings r={page} snap={snap} />;
  if (page) return <ServicePage r={page} snap={snap} admin={admin} editing={admin && view === "edit"} />;
  if (view !== "watch" && view !== "all" && view !== "fresh") return <Empty>{tx("Ce service n'existe plus.")} <a href="#services/all" className="text-link hover:underline">{tx("Tous les services")}</a></Empty>;
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={Boxes} title={tx("Services")} tags={<HeadTags counts={[groupsTitle(groups), tx("{0} machines", every.machines)]} at={snap.data.generated} />}
        actions={<>{admin && <a href="#services/new" className={`${primary} py-1 no-underline`} title={tx("Déclarer un service que la détection ne voit pas")}><Plus size={14} aria-hidden />{tx("Service")}</a>}<PeriodSwitch value={hours} onChange={setHours} /></>} />
      <ServicesTiles hosts={snap.data.hosts} hidden={hiddenMap} generated={snap.data.generated} hours={hours} />
      {(view === "all" || view === "watch") && admin && <PublicIgnore />}
      {view === "fresh" && admin && <NewServices generated={snap.data.generated} />}
      {(view === "all" || view === "watch") && <FoldPanel id="services-all" icon={Layers} title={tx("Tous les services")} count={groups.filter((g) => !g.tech).length} pinned>
        <FilterBar f={{ ...f, shown: shownReal, total: groups.filter((g) => !g.tech).length }} oneLine bare placeholder={tx("Nom, domaine, IP…")}   // one line in the panel's frame; the others behind « More filters »
          extra={<>{watching > 0 && <button type="button" onClick={() => f.toggle("todo", "on")} aria-pressed={!!f.sel.todo?.length} title={tx("Pannes, avertissements et points à contrôler")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${f.sel.todo?.length ? "border-warn bg-warn/15 text-warn" : "border-warn/60 text-warn hover:bg-warn/10"}`}>
            <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />{tx("À vérifier")} <b>{watching}</b></button>}
          <button type="button" onClick={() => f.toggle("domain", "with")} aria-pressed={!!f.sel.domain?.includes("with")} title={tx("Seulement les services qui ont un domaine")}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${f.sel.domain?.includes("with") ? "border-link bg-link/15 text-txt" : "border-line text-link hover:bg-link/10"}`}><Globe size={14} aria-hidden />{tx("Domaine")}</button>
          <span className="inline-flex shrink-0 items-center gap-1">
            <select aria-label={tx("Trier par")} value={sort.key} onChange={(e) => sort.by(e.target.value)} className="rounded-lg border border-line bg-bg2 px-2 py-1.5 text-sm text-txt outline-none focus:border-link">
              {[["status", tx("État")], ["name", tx("Nom")], ["machine", tx("Machine")], ["target", tx("Adresse")]].map(([k, label]) => <option key={k} value={k}>{tx("Trier : {0}", label)}</option>)}
            </select>
            <button type="button" onClick={() => sort.by(sort.key)} className="rounded-lg border border-line p-2 text-link hover:bg-link/10" title={tx("Inverser l'ordre")} aria-label={tx("Inverser l'ordre")}>{sort.asc ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}</button>
          </span>
          {viewButton(!byMachine, tx("Par application"), Layers, false)}{viewButton(byMachine, tx("Par machine"), Server, true)}</>} />
        {f.shown.length === 0 ? <Empty>{tx("Aucun service pour ce filtre.")}</Empty> : <div className="mt-3 flex flex-col gap-4">
          {sections(shownReal, byMachine).map((s) => (
            <section key={s.title} aria-label={s.title}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-bold">{s.title}<span className="text-xs font-normal text-muted">{s.groups.length}</span></h3>
              <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))]">{s.groups.map(card)}</div>
            </section>
          ))}
          {shownTech.length > 0 && <section aria-label={tx("Composants techniques")} className="rounded-xl border border-line">
            <button type="button" onClick={() => setTechOpen(!techOpen)} aria-expanded={techOpen || f.active > 0} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-link/10">
              <span><b className="text-sm">{tx("Composants techniques")}</b> <span className="text-xs text-muted">{tx("{0} éléments utiles à tes services, mais qui n'en sont pas", shownTech.reduce((n, g) => n + g.hosts.length, 0))}</span></span>
              <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${techOpen || f.active > 0 ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {(techOpen || f.active > 0) && <div className="grid gap-2.5 p-3 pt-1 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))]">{shownTech.map(card)}</div>}
          </section>}
        </div>}
      </FoldPanel>}
    </div>
  );
}

/** The page of one service (#services/item/<key>): what it is and how it answers; « Edit » (#services/edit/<key>) turns the same blocks into fields */
function ServicePage({ r, snap, admin, editing }: Readonly<{ r: Host; snap: Snapshot; admin: boolean; editing: boolean }>) {
  const u = openUrl(r), back = () => { location.hash = servicePage("item", r); };
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <a href="#services/all" className={`${quiet} py-1 no-underline`}><ArrowLeft size={14} aria-hidden />{tx("Tous les services")}</a>
        <h1 className="flex items-center gap-2 text-xl font-bold"><ServiceLogo r={r} />{editing && `${tx("Modifier")} `}{hostName(r)} <Badge tone="off">{via(r)}</Badge></h1>
        {!editing && <span className="ml-auto flex gap-2">
          {u && <a href={u} target="_blank" rel="noopener" className={`${quiet} py-1 no-underline`}><ExternalLink size={14} aria-hidden />{tx("Ouvrir")}</a>}
          {admin && <a href={`#${servicePage("edit", r)}`} className={`${quiet} py-1 no-underline`}><Pencil size={14} aria-hidden />{tx("Modifier")}</a>}
        </span>}
      </div>
      {editing
        ? <ServiceEdit r={r} logo={<ServiceLogo r={r} auto />} onClose={back} />
        : <>
          {admin && r.manual && r.ip && r.port && <ManualActions r={r} onEdit={() => { location.hash = servicePage("manual", r); }} />}
          <ServiceDetail r={r} admin={admin} ports={portsOf(r, snap.data.hosts)} related={relatedOf(r, snap.data.hosts)} onOpen={openService} />
        </>}
    </div>
  );
}

/** The settings of a declared service (#services/manual/<key>), or a new one to declare (#services/new) */
function ServicePageSettings({ r, snap }: Readonly<{ r?: Host; snap: Snapshot }>) {
  const back = () => { location.hash = r ? servicePage("item", r) : "services/all"; };
  const initial: ManualInitial | undefined = r?.ip && r.port ? { name: hostName(r), ip: r.ip, port: r.port, scheme: r.scheme ?? "http" } : undefined;
  return (
    <div className="flex flex-col gap-4 py-4">
      <ManualService machines={snap.data.machine_list.filter((m) => !m.disabled)} initial={initial} onDone={back} onClose={back} />
    </div>
  );
}
