// Services in « state » mode: a title line, four figures, « To watch » (down, warning or with a point to check, worst first, a row
// opens the detail window), the services newly seen on the machines (admin), then « See all » folded: every service (NPM and direct)
// with its state, machine and source, filters, sort, « By machine »; on a phone, one card per service.
import { usePageView } from "../lib/route";
import { foldHeaderProps } from "../lib/foldHeader";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, EyeOff, Globe, Layers, Pencil, Plus, Server, Boxes, Undo2 } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { send, type Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { Dot, Logo } from "../components/marks";
import { appIcon, serviceIcon } from "../lib/appIcons";
import { CHECK, CLEANUP, KIND_NAME, checks, exposure, hostName, noIdentity, openUrl, status, type Check } from "../lib/status";
import type { Host } from "../types";
import { Badge, Cards, Dim, Empty, FilterBar, Table, Td, Th, type Tone } from "../components/ui";
import { ServiceDetail } from "./ServiceDetail";
import { ServiceEdit } from "../components/ServiceEdit";
import { IconGlyph } from "../components/IconPicker";
import { chosenIcon } from "../lib/machineIcons";
import { ipNum } from "../lib/format";
import { tx } from "../lib/i18n";
import { FoldPanel } from "../components/FoldPanel";
import { NewServices } from "../components/NewServices";
import { ManualActions, ManualService, type ManualInitial } from "../components/ManualService";
import { StatTile } from "../components/StatTile";
import { TargetChanged } from "../components/TargetChanged";
import { primary, quiet } from "../lib/forms";
import { figures, mergePorts, toWatch } from "../lib/servicesState";
import { HeadTags } from "../components/HeadTags";
import { PageHead } from "../components/PageHead";
import { HistoryTile, useServicesHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
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

/** Every real domain of a service: its NPM domains, or the ones its Apache / nginx declares */
const declaredDomains = (r: Host): string[] => (r.domains.length ? r.domains : r.vhost_domains ?? []);
function domainSource(r: Host): string {
  if (r.domains.length) return "NPM";
  return r.vhost_server === "nginx" ? "nginx" : "Apache";
}
const hostIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";
const keyOfRow = serviceKey;

/** Coloured left edge of an opened machine group (header and rows) */
const OPEN_EDGE = "border-l-[3px] border-l-link";

const GROUP_KEY = "myservices.services.byMachine";

/** « Grouper par machine » is on by default, remembered in this browser only; the page works without it */
function useGrouped(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(GROUP_KEY) !== "0"; } catch { return true; } });
  const set = (v: boolean) => { setOn(v); try { localStorage.setItem(GROUP_KEY, v ? "1" : "0"); } catch { /* navigation privée : tant pis */ } };
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

function Name({ r }: Readonly<{ r: Host }>) {
  const u = openUrl(r);
  return (
    <div className="min-w-0">
      {u ? (
        <a href={u} target="_blank" rel="noopener" onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 font-semibold hover:text-link">
          <span className="truncate">{hostName(r)}</span><ExternalLink size={12} className="shrink-0 text-dim" />
        </a>
      ) : <b>{hostName(r)}</b>}
      {r.domains.length > 1 && <span className="ml-1 text-xs text-dim" title={r.domains.slice(1).join(", ")}>+{r.domains.length - 1}</span>}
    </div>
  );
}

/** Icon-only marks next to the state, in fixed slots so they line up from row to row: exposure (private, public, open) and SSL */
/** The small icons after the state, one gap apart: access (protected, public, public?), domains found for a machine's service (an NPM host
 *  always has its own, the « Proxy NPM » badge says it), weak HTTPS */
function Marks({ r }: Readonly<{ r: Host }>) {
  const e = exposure(r), risk = sslRisk(r), domains = r.type === "local" ? declaredDomains(r) : [];
  return (
    <>
      {e && <Badge tone={EXPO[e][0]} title={`${EXPO[e][1].replace(/^\S+\s/, "")}\n${EXPO[e][2]}`}>{EXPO[e][1].split(" ")[0]}</Badge>}
      {domains.length > 0 && <Badge tone="info" title={`${tx("Domaines déclarés ({0})", domainSource(r))}\n${domains.join("\n")}`}>🌐</Badge>}
      {risk && <Badge tone={r.ssl ? "warn" : "bad"} title={`${risk}\n${tx("Ouvrez la fiche pour le détail de l'accès.")}`}>🔓</Badge>}
    </>
  );
}

/** One readable state; the reason and the flags to check are in the tooltip */
function State({ r, ck, source }: Readonly<{ r: Host; ck: Check[]; source?: React.ReactNode }>) {
  const [cls, label, why] = status(r);
  const flags = ck.filter((k) => !CLEANUP.includes(k)).map((k) => `⚑ ${CHECK[k][0]}`);
  return (
    <span className="inline-flex items-center gap-1">
      <StateBadges cls={cls} label={label} title={[label, why, ...flags].filter(Boolean).join("\n")} flagged={flags.length > 0} source={source} />
      <Marks r={r} />
    </span>
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

function Tech({ r }: { r: Host }) {
  const s = r.service;
  if (!s && r.app) {  // pas d'identification sûre : l'appli devinée par la page, les en-têtes HTTP ou le port, avec son degré de confiance
    const how = CONFIDENCE[r.app.confidence];
    return <div className="min-w-0"><span className="font-medium">{r.app.label}</span><span className="block truncate text-xs text-dim" title={how[1]}>{how[0]}</span></div>;
  }
  if (!s) return <span className="inline-flex flex-wrap items-center gap-1.5"><Dim>{noIdentity(r) ?? tx("non identifié")}</Dim><TargetChanged r={r} /></span>;
  return (
    <div className="min-w-0">
      <span className="inline-flex flex-wrap items-center gap-x-1.5 font-medium">{s.title || s.name}
        {s.behind?.name && <span className="text-xs font-normal text-dim" title={tx("Relais : envoie vers {0}", s.behind.addr)}>→ {s.behind.name}</span>}
        {s.stale && <span className="text-xs font-normal text-dim" title={tx("Le backend ne répond plus : identification du dernier passage où il répondait")}>⏳ {tx("dernière connue")}</span>}
        <TargetChanged r={r} /></span>
      <span className="block truncate text-xs text-dim">{KIND_NAME[s.kind] || s.kind}{s.version ? ` · ${s.version}` : ""}{s.image ? ` · ${s.image}` : ""}</span>
    </div>
  );
}

const CONFIDENCE: Record<string, [string, string]> = {
  sure: [tx("sûr"), tx("Reconnu par son image Docker")],
  probable: [tx("probable"), tx("Reconnu par le titre de sa page ou ses en-têtes HTTP, sans SSH")],
  possible: [tx("possible"), tx("Deviné par son port ou son serveur web : à confirmer")],
};
const KIND_LOGO = new Set(["docker", "apache", "nginx"]);  // types de service qui ont un logo dans public/icons

/** Rows grouped by machine, in the order the sorted list first meets each machine */
function groupByMachine(rows: Host[]): { name: string; ip: string; rows: Host[] }[] {
  const groups = new Map<string, { name: string; ip: string; rows: Host[] }>();
  for (const r of rows) {
    const key = r.machine || hostIp(r) || "?";
    const g = groups.get(key) ?? { name: r.machine || hostIp(r) || tx("machine inconnue"), ip: hostIp(r), rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function GroupHeader({ g, folded, onToggle, cols, map }: Readonly<{ g: { name: string; ip: string; rows: Host[] }; folded: boolean; onToggle: () => void; cols: number; map: HiddenMap }>) {
  const count = (c: string) => g.rows.filter((r) => status(r)[0] === c && !isHidden(r, map)).length;   // a service hidden from « To watch » is no longer counted down here
  return (
    <tr {...foldHeaderProps(onToggle)} className={`cursor-pointer hover:bg-bg2 ${folded ? "bg-bg2/70" : "bg-link/15"}`}>
      <td className={`p-0 ${folded ? "" : OPEN_EDGE}`}>
        {/* width 0 + min-width 100%: the title adds nothing to the column widths, so the columns below keep their own size */}
        <button type="button" onClick={onToggle} aria-expanded={!folded} className="flex w-0 min-w-full items-center gap-2 overflow-hidden whitespace-nowrap px-3 py-2 text-left">
          {folded ? <ChevronRight size={15} className="shrink-0 text-dim" aria-hidden /> : <ChevronDown size={15} className="shrink-0 text-dim" aria-hidden />}
          <Server size={15} className="shrink-0 text-link" aria-hidden /><b className="truncate">{g.name}</b>{g.ip && g.ip !== g.name && <Dim>{g.ip}</Dim>}
        </button>
      </td>
      {/* the counts sit in the Service column, lined up with the service names below */}
      <td colSpan={cols - 1} className="py-2 !pl-10 pr-3">
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="off">{g.rows.length} {g.rows.length > 1 ? tx("services") : tx("service")}</Badge>
          {count("bad") > 0 && <Badge tone="bad">{count("bad")} {tx("en panne")}</Badge>}
          {count("warn") > 0 && <Badge tone="warn">{count("warn")} {tx("avertissement")}</Badge>}
        </span>
      </td>
    </tr>
  );
}

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

function ServiceRow({ r, ports = [r], grouped, hidden, watched, admin, onOpen, onPort, onEdit }: Readonly<{ r: Host; ports?: Host[]; grouped: boolean; hidden: boolean; watched: boolean; admin: boolean; onOpen: () => void; onPort?: (p: Host) => void; onEdit?: () => void }>) {   // watched: in « To watch »; admin: can hide it from there   // grouped: the rows of an opened group sit on a darker background with a coloured edge
  const edge = grouped ? `${OPEN_EDGE} !pl-9` : "";   // the state lines up under the server icon of the group header
  return (
    <tr onClick={onOpen} className={`cursor-pointer ${grouped ? "bg-bg/30 even:bg-bg/70" : "even:bg-bg/50"} hover:!bg-bg2/60 ${r.enabled ? "" : "opacity-60"}`}>
      <Td className={`!py-1 overflow-hidden align-middle whitespace-nowrap ${edge}`}><span className={hidden ? "opacity-40 grayscale" : ""}><State r={r} ck={checks(r)} source={<Badge tone="off" title={sourceTip(r)}>{via(r)}</Badge>} /></span>{hidden && <span className="ml-1.5" title={tx("Masqué des alertes : son état reste ici")}><Badge tone="off" outline>{tx("masqué")}</Badge></span>}</Td>
      <Td className="!py-1 overflow-hidden !pl-10 align-middle"><span className="flex items-center gap-2"><Name r={r} />{ports.length > 1 && <Badge tone="info" outline>{tx("{0} ports", ports.length)}</Badge>}</span></Td>
      <Td className="!py-1 overflow-hidden whitespace-nowrap !pl-6 align-middle font-mono text-xs text-muted">
        {ports.length > 1 ? <PortChips ip={r.ip} ports={ports} onPort={onPort} /> : <span className="block truncate" title={targetOf(r)}>{targetOf(r)}</span>}
      </Td>
      {!grouped && <Td className="!py-1 !pl-6 align-middle">{r.machine ? <><b className="font-medium">{r.machine}</b>{r.category && <span className="block text-xs text-dim">{r.category}</span>}</> : <Dim>-</Dim>}</Td>}
      <Td className="!py-1 overflow-hidden !pl-10 align-middle"><div className="flex items-center gap-2.5"><ServiceLogo r={r} /><Tech r={r} />
        {admin && <span className="ml-auto flex items-center gap-2">
          {watched && exposure(r) === "ouvert" && r.domains[0] && (
            <button type="button" className="text-dim hover:text-ok" title={tx("Ouvert à Internet volontairement (site, blog, page de contact) : ne plus le signaler")} aria-label={tx("Site public voulu")}
              onClick={(e) => { e.stopPropagation(); void send("PUT", "services/public", { domain: r.domains[0], public: true }).catch(() => undefined); }}><Globe size={15} aria-hidden /></button>
          )}
          <HideToggle r={r} hidden={hidden} watched={watched} /></span>}
        {onEdit && <button type="button" className={`${admin ? "" : "ml-auto "}shrink-0 text-dim hover:text-link`} title={tx("Modifier")} aria-label={tx("Modifier")} onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={15} aria-hidden /></button>}
      </div></Td>
    </tr>
  );
}


const SERVICE_VIEWS = ["watch", "all", "fresh", "item", "edit", "manual", "new"] as const;
/** The page of one service and its settings: #services/item/<key>, #services/edit/<key> (meta), #services/manual/<key> (a declared one) */
const servicePage = (view: string, r: Host) => `services/${view}/${encodeURIComponent(keyOfRow(r))}`;
const openService = (r: Host) => { location.hash = servicePage("item", r); };

/** In alert, as the menu's dot counts it: down, in warning or with a point to check, unless hidden from the alerts */
const alertMark = () => <Dot tone="bad" />;
/** A service in alert, as the menu's dot and the home page count them: down or with a warning, not hidden from the alerts. A service that is
 *  OK with a remark (certificate, web check…) is under « À vérifier », not here. */
export const alerting = (r: Host, hidden: HiddenMap): boolean => { const c = status(r)[0]; return (c === "bad" || c === "warn") && !isHidden(r, hidden); };

export function Services({ snap, initial, route }: Readonly<{ snap: Snapshot; initial?: Selected; route: string }>) {
  const hiddenMap = useServicesHidden();
  const machines = useMemo(() => new Map(snap.data.machine_list.map((m) => [m.ip, m.name])), [snap.data.machine_list]);
  const facets = useMemo((): Facet<Host>[] => [
    { key: "alert", label: tx("Alertes"), get: (r) => (alerting(r, hiddenMap) ? "on" : ""), name: () => tx("en alerte"), mark: alertMark },   // ticked by the menu's dot (DOT_FILTER) and the old « To watch » address
    { key: "src", label: tx("Source"), get: (r) => (r.type === "local" ? "local" : "npm"), name: (v) => (v === "npm" ? "NPM" : tx("Services")), order: ["npm", "local"],
      mark: (v) => (v === "npm" ? <Logo src={`${import.meta.env.BASE_URL}icons/nginx-proxy-manager.svg`} /> : <Dot tone="info" />) },
    { key: "status", label: tx("État"), get: (r) => status(r)[0], name: (v) => ST_NAME[v] || v, order: ["bad", "warn", "ok", "off"], mark: (v) => <Dot tone={v as Tone} /> },
    { key: "domain", label: tx("Domaine"), get: (r) => (declaredDomains(r).length ? "with" : "without"), name: (v) => (v === "with" ? tx("avec domaine") : tx("sans domaine")), order: ["with", "without"],
      mark: domainMark },
    { key: "check", label: tx("À vérifier"), get: (r) => checks(r), name: (v) => CHECK[v as Check]?.[0] || v, mark: (v) => <Dot tone={CLEANUP.includes(v as Check) ? "off" : "warn"} /> },
    { key: "machine", label: tx("Machine"), get: (r) => hostIp(r), name: (v) => machines.get(v) || v },
    { key: "cat", label: tx("Catégorie"), get: (r) => r.category || "" },
    { key: "app", label: tx("Appli"), get: (r) => r.app?.label || "", mark: (v) => { const i = appIcon([v]); return i ? <Logo src={i} /> : null; } },
    { key: "kind", label: tx("Type"), get: (r) => r.service?.kind || "", name: (v) => KIND_NAME[v] || v,
      mark: (v) => (KIND_LOGO.has(v) ? <Logo src={`${import.meta.env.BASE_URL}icons/${v}.svg`} /> : null) },
  ], [machines, hiddenMap]);
  const text = useCallback((r: Host) => [
    ...declaredDomains(r), r.name, r.ip, r.port, r.target, r.machine, r.category, r.service?.name, r.service?.image, r.service?.title, r.description,
  ].join(" "), []);
  // Tout s'affiche par défaut, les pannes d'abord (tri par état) ; un filtre demandé ailleurs (compteur de l'accueil, machine) est gardé tel quel
  const f = useFilter(snap.data.hosts, facets, text, route.startsWith("#services/watch") ? { alert: ["on"] } : initial);   // the old « To watch » address: the alerts
  const keyOf = useCallback((r: Host, k: string): string | number => {
    switch (k) {
      case "status": return ["bad", "warn", "ok", "off"].indexOf(status(r)[0]);
      case "machine": return (r.machine || "~").toLowerCase();
      case "target": return ipNum(r.ip || "0") * 65536 + (r.port || 0);
      case "kind": return r.service?.kind || "~";
      default: return hostName(r).toLowerCase();
    }
  }, []);
  const sort = useSort(f.shown, keyOf, "status");
  const [grouped, setGrouped] = useGrouped(), [expanded, setExpanded] = useState<string[]>(() => (initial && Object.keys(initial).length ? groupByMachine(f.shown).map((g) => g.name) : []));   // groups are folded until opened, except when arriving with a filter (link from a machine): then they are already open
  const groups = useMemo(() => (grouped ? groupByMachine(sort.sorted) : [{ name: "", ip: "", rows: sort.sorted }]), [grouped, sort.sorted]);

  const [hours, setHours] = usePeriod(), hist = useServicesHistory(hours, snap.data.generated), now = Math.floor(Date.now() / 1000);
  const every = figures(snap.data.hosts), followed = every.ok + every.warn + every.bad, health = followed ? Math.round((every.ok / followed) * 100) : 0, fig = figures(snap.data.hosts.filter((r) => !isHidden(r, hiddenMap))), watchAll = toWatch(snap.data.hosts), admin = snap.me.role === "admin";   // the tiles leave out the services hidden from « To watch », the header counts them all
  const watchKeys = new Set(watchAll.map(keyOfRow));
  const view = usePageView(route, "services", SERVICE_VIEWS, "all");   // « To watch » is no longer a page: the alerts are a filter of the list
  const pageKey = decodeURIComponent(route.split("/")[2] ?? "");
  const page = ["item", "edit", "manual"].includes(view) ? snap.data.hosts.find((r) => keyOfRow(r) === pageKey) : undefined;
  if (view === "new" || (page && view === "manual")) return <ServicePageSettings r={page} snap={snap} />;
  if (page) return <ServicePage r={page} snap={snap} admin={admin} editing={admin && view === "edit"} />;
  if (view !== "watch" && view !== "all" && view !== "fresh") return <Empty>{tx("Ce service n'existe plus.")} <a href="#services/all" className="text-link hover:underline">{tx("Tous les services")}</a></Empty>;
  return (
    <div className="flex flex-col gap-4 py-4">
      <PageHead icon={Boxes} title={tx("Services")} tags={<HeadTags counts={[tx("{0} services", every.total), tx("{0} avec domaine", every.withDomain), tx("{0} locaux", every.local), tx("{0} machines", every.machines)]} at={snap.data.generated} />}
        actions={<><PeriodSwitch value={hours} onChange={setHours} />{admin && <a href="#services/new" className={`${primary} py-1 no-underline`} title={tx("Déclarer un service que la détection ne voit pas")}><Plus size={14} aria-hidden />{tx("Service")}</a>}</>} />
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <HistoryTile n={fig.ok} label={tx("En ligne")} tone="ok" kind="curve" points={hist?.up ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={(p) => `${p[1]}/${p[2]}`} goodHigh />
        <HistoryTile n={fig.bad} label={tx("En panne")} tone={fig.bad ? "bad" : undefined} kind="strip" points={hist?.up ?? null} hours={hours} now={now} figure={(p) => p[2] - p[1]} fmt={(p) => tx("{0} en panne", p[2] - p[1])} goodHigh={false} />
        <HistoryTile n={fig.warn} label={tx("Avertissement")} tone={fig.warn ? "warn" : undefined} fact={fig.warnWhy.join(", ")} kind="strip" points={hist?.warn ?? null} hours={hours} now={now} figure={(p) => p[2] - p[1]} fmt={(p) => tx("{0} en avertissement", p[2] - p[1])} goodHigh={false} />
        <HistoryTile n={followed ? `${health} %` : "-"} label={tx("Santé des services")} tone={followed ? (health >= 90 ? "ok" : health >= 70 ? "warn" : "bad") : undefined} fact={tx("{0} en avertissement · {1} en panne", every.warn, every.bad)} scale={100} kind="curve" points={hist?.health ?? null} hours={hours} now={now} figure={(p) => p[1]} fmt={(p) => `${p[1]} %`} goodHigh />
        <StatTile n={fig.toCheck} label={tx("À vérifier")} tone={fig.toCheck ? "warn" : undefined} sub={fig.checkWhy.map((k) => CHECK[k][0]).join(", ") || tx("rien à confirmer")} />
      </div>
      {view === "fresh" && admin && <NewServices generated={snap.data.generated} />}
      {(view === "all" || view === "watch") && <FoldPanel id="services-all" icon={Layers} title={tx("Tous les services")} count={snap.data.hosts.length} pinned>
      <FilterBar f={f} primary={["alert", "status", "domain"]} oneLine bare placeholder={tx("Domaine, IP, port, conteneur, image…")}   // one line in the panel's frame; Machine behind « More filters »
        extra={<button type="button" onClick={() => setGrouped(!grouped)} aria-pressed={grouped} title={tx("Regrouper les services sous le nom de leur machine")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${grouped ? "border-link bg-link/15 text-txt" : "border-line text-link hover:bg-link/10"}`}>
          <Server size={14} aria-hidden />{tx("Par machine")}</button>} />
      {sort.sorted.length === 0 ? <Empty>{tx("Aucun service pour ce filtre.")}</Empty> : (
        <>
          <Table fixed head={<>
            <Th k="status" sort={sort} className={grouped ? "w-[24rem] !pl-9" : "w-80"}>{tx("État")}</Th><Th k="name" sort={sort} className="w-[26%] !pl-10">{tx("Domaine")}</Th><Th k="target" sort={sort} className="w-80 !pl-6">{tx("Cible")}</Th>
            {!grouped && <Th k="machine" sort={sort} className="w-[16%] !pl-6">{tx("Machine")}</Th>}<Th k="kind" sort={sort} className="!pl-10">{tx("Service")}</Th>
          </>}>
            {groups.map((g) => (
              <Fragment key={g.name}>
                {grouped && <GroupHeader g={g} cols={4} map={hiddenMap} folded={!expanded.includes(g.name)} onToggle={() => setExpanded(expanded.includes(g.name) ? expanded.filter((n) => n !== g.name) : [...expanded, g.name])} />}
                {(!grouped || expanded.includes(g.name)) && mergePorts(g.rows).map(({ lead: r, ports }) => <ServiceRow key={keyOfRow(r)} r={r} ports={ports} grouped={grouped} hidden={isHidden(r, hiddenMap)} watched={watchKeys.has(keyOfRow(r))} admin={admin} onOpen={() => openService(r)} onPort={openService} onEdit={admin ? () => { location.hash = servicePage("edit", r); } : undefined} />)}
              </Fragment>
            ))}
          </Table>
          <Cards>
            {sort.sorted.map((r) => {
              const k = keyOfRow(r), [cls, label] = status(r);
              return (
                <div key={k} className={`rounded-2xl border border-line bg-card p-3.5 ${r.enabled ? "" : "opacity-70"}`}>
                  <button type="button" onClick={() => openService(r)} className="flex w-full items-start justify-between gap-2 text-left">
                    <ServiceLogo r={r} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{hostName(r)}</b>
                      <span className="block text-xs text-dim">{r.machine || tx("machine inconnue")} · {r.ip ? `${r.ip}:${r.port}` : r.target || ""}</span>
                    </span>
                    <Badge tone={ST_TONE[cls]}>{label}</Badge>
                  </button>
                  {admin && <div className="mt-2 flex justify-end"><HideToggle r={r} hidden={isHidden(r, hiddenMap)} watched={watchKeys.has(k)} /></div>}
                </div>
              );
            })}
          </Cards>
        </>
      )}
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
