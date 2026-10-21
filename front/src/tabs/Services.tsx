// Services in « state » mode: a title line, four figures, « To watch » (down, warning or with a point to check, worst first, a row
// opens the detail window), the services newly seen on the machines (admin), then « See all » folded: every service (NPM and direct)
// with its state, machine and source, filters, sort, « By machine »; on a phone, one card per service.
import { foldHeaderProps } from "../lib/foldHeader";
import { ChevronDown, ChevronRight, ExternalLink, EyeOff, Globe, Layers, Pencil, Search, Plus, Server, Boxes, Undo2 } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { send, type Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { Dot, Logo } from "../components/marks";
import { appIcon, serviceIcon } from "../lib/appIcons";
import { CHECK, CLEANUP, KIND_NAME, checks, exposure, hostName, noIdentity, status, type Check } from "../lib/status";
import type { Host } from "../types";
import { Badge, Cards, Dim, Empty, FilterBar, Table, Td, Th, type Tone } from "../components/ui";
import { ServiceDetail } from "./ServiceDetail";
import { ServiceEdit } from "../components/ServiceEdit";
import { Overlay } from "../components/Overlay";
import { dateTime, ipNum } from "../lib/format";
import { tx } from "../lib/i18n";
import { FoldPanel } from "../components/FoldPanel";
import { NewServices } from "../components/NewServices";
import { ManualActions, ManualService, type ManualInitial } from "../components/ManualService";
import { StatTile } from "../components/StatTile";
import { WatchPanel } from "../components/WatchPanel";
import { quiet, worstTone } from "../lib/forms";
import { figures, liveChecks, mergePorts, toWatch } from "../lib/servicesState";
import { HeadTags } from "../components/HeadTags";
import { isHidden, serviceKey, setServiceHidden, useServicesHidden, type HiddenMap } from "../lib/servicesHidden";
import { useStoredFlag } from "../lib/storedFlag";

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

function url(r: Host): string | null {
  if (r.domains.length) return `https://${r.domains[0]}/`;
  return r.ip ? `${r.scheme || "http"}://${r.ip}:${r.port}/` : null;
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
  const u = url(r);
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
function ServiceLogo({ r }: { r: Host }) {
  const src = serviceIcon(r);
  return src ? <span className="grid h-10 w-10 min-w-10 shrink-0 place-items-center rounded-md bg-bg2" title={r.app?.label || r.service?.name}><img src={src} alt="" className="h-7 w-7" /></span> : <span className="block h-10 w-10 shrink-0" aria-hidden />;
}

function Tech({ r }: { r: Host }) {
  const s = r.service;
  if (!s && r.app) {  // pas d'identification sûre : l'appli devinée par la page, les en-têtes HTTP ou le port, avec son degré de confiance
    const how = CONFIDENCE[r.app.confidence];
    return <div className="min-w-0"><span className="font-medium">{r.app.label}</span><span className="block truncate text-xs text-dim" title={how[1]}>{how[0]}</span></div>;
  }
  if (!s) return <Dim>{noIdentity(r) ?? tx("non identifié")}</Dim>;
  return (
    <div className="min-w-0">
      <span className="font-medium">{s.title || s.name}{s.stale && <span className="ml-1.5 text-xs font-normal text-dim" title={tx("Le backend ne répond plus : identification du dernier passage où il répondait")}>⏳ {tx("dernière connue")}</span>}</span>
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

function GroupHeader({ g, folded, onToggle, cols }: Readonly<{ g: { name: string; ip: string; rows: Host[] }; folded: boolean; onToggle: () => void; cols: number }>) {
  const count = (c: string) => g.rows.filter((r) => status(r)[0] === c).length;
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

function ServiceRow({ r, ports = [r], grouped, hidden, onOpen, onPort, onEdit }: Readonly<{ r: Host; ports?: Host[]; grouped: boolean; hidden: boolean; onOpen: () => void; onPort?: (p: Host) => void; onEdit?: () => void }>) {   // grouped: the rows of an opened group sit on a darker background with a coloured edge
  const edge = grouped ? `${OPEN_EDGE} !pl-9` : "";   // the state lines up under the server icon of the group header
  return (
    <tr onClick={onOpen} className={`cursor-pointer ${grouped ? "bg-bg/30 even:bg-bg/70" : "even:bg-bg/50"} hover:!bg-bg2/60 ${r.enabled ? "" : "opacity-60"}`}>
      <Td className={`!py-1 overflow-hidden align-middle whitespace-nowrap ${edge}`}><State r={r} ck={checks(r)} source={<Badge tone="off" title={sourceTip(r)}>{via(r)}</Badge>} />{hidden && <span className="ml-1.5" title={tx("Masqué de « À surveiller » : son état reste ici")}><Badge tone="off" outline>{tx("masqué")}</Badge></span>}</Td>
      <Td className="!py-1 overflow-hidden !pl-10 align-middle"><span className="flex items-center gap-2"><Name r={r} />{ports.length > 1 && <Badge tone="info" outline>{tx("{0} ports", ports.length)}</Badge>}</span></Td>
      <Td className="!py-1 overflow-hidden whitespace-nowrap !pl-6 align-middle font-mono text-xs text-muted">
        {ports.length > 1 ? <PortChips ip={r.ip} ports={ports} onPort={onPort} /> : <span className="block truncate" title={targetOf(r)}>{targetOf(r)}</span>}
      </Td>
      {!grouped && <Td className="!py-1 !pl-6 align-middle">{r.machine ? <><b className="font-medium">{r.machine}</b>{r.category && <span className="block text-xs text-dim">{r.category}</span>}</> : <Dim>-</Dim>}</Td>}
      <Td className="!py-1 overflow-hidden !pl-10 align-middle"><div className="flex items-center gap-2.5"><ServiceLogo r={r} /><Tech r={r} />
        {onEdit && <button type="button" className="ml-auto shrink-0 text-dim hover:text-link" title={tx("Modifier")} aria-label={tx("Modifier")} onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={15} aria-hidden /></button>}
      </div></Td>
    </tr>
  );
}

/** « To watch »: the services down, in warning or with a point to check; a row opens the detail window. An admin can hide a service from here
 *  (and from the tab's dot and the home page) until its problem changes; « Show hidden » lists them again, greyed, with a button to show them back. */
function Watch({ rows, hidden, map, admin, onOpen }: Readonly<{ rows: Host[]; hidden: Host[]; map: HiddenMap; admin: boolean; onOpen: (key: string) => void }>) {
  const [showHidden, setShowHidden] = useStoredFlag("myservices.services.showHidden", false);
  const worst = worstTone(rows.some((r) => status(r)[0] === "bad"), rows.length > 0);
  const list = showHidden ? [...rows, ...hidden] : rows;
  const extra = hidden.length > 0 && (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted" data-no-fold>
      <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />{tx("Afficher les masqués")} <Dim>({hidden.length})</Dim>
    </label>
  );
  return (
    <WatchPanel id="services" tone={worst} count={rows.length} keep={hidden.length > 0} extra={extra} hint={tx("en panne, en avertissement ou avec un point à vérifier")}>
      {list.length === 0 ? <p className="px-4 py-3 text-sm text-dim">{tx("Les services à surveiller sont tous masqués.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-dim">
              <th className="px-3 py-2">{tx("Service")}</th><th className="px-3 py-2">{tx("Machine")}</th><th className="px-3 py-2">{tx("Accès")}</th><th className="px-3 py-2">{tx("État")}</th><th className="w-24 px-3 py-2" />
            </tr></thead>
            <tbody>
              {list.map((r) => {
                const [cls, label, why] = status(r), ex = exposure(r), flags = liveChecks(r).filter((k) => k !== "down").map((k) => CHECK[k][0]), domain = declaredDomains(r)[0];
                const off = map[keyOfRow(r)] && isHidden(r, map) ? map[keyOfRow(r)] : null;
                return (
                  <tr key={keyOfRow(r)} className={`border-t border-line/60 even:bg-bg/50 hover:bg-bg2/40 ${off ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2"><span className="flex items-center gap-2"><ServiceLogo r={r} /><span className="min-w-0"><b className="block truncate font-semibold">{hostName(r)}</b>
                      {domain && domain !== hostName(r) && <span className="block truncate font-mono text-[11px] text-dim">{domain}</span>}
                      {off && <span className="block text-[11px] text-dim">{tx("masqué le {0}", dateTime(off.at * 1000))}</span>}</span></span></td>
                    <td className="px-3 py-2">{r.machine || <Dim>{tx("machine inconnue")}</Dim>}</td>
                    <td className="px-3 py-2">{ex ? <Badge tone={EXPO[ex][0]} outline plainText title={EXPO[ex][2]}>{EXPO[ex][1]}</Badge> : <Dim>-</Dim>}</td>
                    <td className="px-3 py-2"><StateBadges cls={cls} label={label} title={why} />{flags.length > 0 && <span className="ml-1.5 text-xs text-muted">{flags.join(" · ")}</span>}</td>
                    <td className="px-3 py-2 text-right"><span className="inline-flex items-center gap-2">
                      {admin && ex === "ouvert" && r.domains[0] && (
                        <button type="button" className="text-dim hover:text-ok" title={tx("Ouvert à Internet volontairement (site, blog, page de contact) : ne plus le signaler")} aria-label={tx("Site public voulu")}
                          onClick={() => void send("PUT", "services/public", { domain: r.domains[0], public: true }).catch(() => undefined)}><Globe size={15} aria-hidden /></button>
                      )}
                      {admin && (off
                        ? <button type="button" className="text-dim hover:text-txt" title={tx("Afficher de nouveau dans « À surveiller »")} aria-label={tx("Afficher de nouveau dans « À surveiller »")} onClick={() => void setServiceHidden(r, hostName(r), false)}><Undo2 size={15} aria-hidden /></button>
                        : <button type="button" className="text-dim hover:text-txt" title={tx("Ne plus afficher ici, ni dans le point de l'onglet, tant que le problème ne change pas")} aria-label={tx("Masquer de « À surveiller »")} onClick={() => void setServiceHidden(r, hostName(r), true)}><EyeOff size={15} aria-hidden /></button>)}
                      <button type="button" onClick={() => onOpen(keyOfRow(r))} aria-haspopup="dialog" title={tx("Détail")} aria-label={tx("Détail")} className="text-dim hover:text-link"><Search size={16} aria-hidden /></button>
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </WatchPanel>
  );
}

export function Services({ snap, initial }: Readonly<{ snap: Snapshot; initial?: Selected }>) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const hiddenMap = useServicesHidden();
  const [editKey, setEditKey] = useState<string | null>(null);   // the « Edit » window (pencil of a row or of the detail)
  const [manual, setManual] = useState<{ initial?: ManualInitial } | null>(null);   // the « + Service » window: empty to declare, filled to edit
  const machines = useMemo(() => new Map(snap.data.machine_list.map((m) => [m.ip, m.name])), [snap.data.machine_list]);
  const facets = useMemo((): Facet<Host>[] => [
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
  ], [machines]);
  const text = useCallback((r: Host) => [
    ...declaredDomains(r), r.name, r.ip, r.port, r.target, r.machine, r.category, r.service?.name, r.service?.image, r.service?.title, r.description,
  ].join(" "), []);
  // Tout s'affiche par défaut, les pannes d'abord (tri par état) ; un filtre demandé ailleurs (compteur de l'accueil, machine) est gardé tel quel
  const f = useFilter(snap.data.hosts, facets, text, initial);
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
  const opened = sort.sorted.find((r) => keyOfRow(r) === openKey);
  const editing = editKey ? snap.data.hosts.find((r) => keyOfRow(r) === editKey) : undefined;
  const [grouped, setGrouped] = useGrouped(), [expanded, setExpanded] = useState<string[]>(() => (initial && Object.keys(initial).length ? groupByMachine(f.shown).map((g) => g.name) : []));   // groups are folded until opened, except when arriving with a filter (link from a machine): then they are already open
  const groups = useMemo(() => (grouped ? groupByMachine(sort.sorted) : [{ name: "", ip: "", rows: sort.sorted }]), [grouped, sort.sorted]);

  const fig = figures(snap.data.hosts), watchAll = toWatch(snap.data.hosts), admin = snap.me.role === "admin";
  const watch = watchAll.filter((r) => !isHidden(r, hiddenMap)), hiddenRows = watchAll.filter((r) => isHidden(r, hiddenMap));
  const filtered = !!initial && Object.keys(initial).length > 0;   // came with a filter (home counter, a machine): the list is wanted open
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold"><Boxes size={18} aria-hidden />{tx("Services")}</h1>
        <HeadTags counts={[tx("{0} services", fig.total), tx("{0} avec domaine", fig.withDomain), tx("{0} locaux", fig.local), tx("{0} machines", fig.machines)]} at={snap.data.generated} />
        {admin && <button type="button" className={`${quiet} ml-auto py-1`} onClick={() => setManual({})} title={tx("Déclarer un service que la détection ne voit pas")}><Plus size={14} aria-hidden />{tx("Service")}</button>}
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        <StatTile n={fig.ok} label={tx("En ligne")} tone="ok" />
        <StatTile n={fig.bad} label={tx("En panne")} tone={fig.bad ? "bad" : undefined} />
        <StatTile n={fig.warn} label={tx("Avertissement")} tone={fig.warn ? "warn" : undefined} sub={fig.warnWhy.join(", ") || undefined} />
        <StatTile n={fig.toCheck} label={tx("À vérifier")} tone={fig.toCheck ? "warn" : undefined} sub={fig.checkWhy.map((k) => CHECK[k][0]).join(", ") || tx("rien à confirmer")} />
      </div>
      <Watch rows={watch} hidden={hiddenRows} map={hiddenMap} admin={admin} onOpen={setOpenKey} />
      {admin && <NewServices generated={snap.data.generated} />}
      <FoldPanel id="services-all" icon={Layers} title={tx("Tout voir")} count={snap.data.hosts.length} startFolded={!filtered}>
      <FilterBar f={f} primary={["status", "domain", "machine"]} placeholder={tx("Domaine, IP, port, conteneur, image…")}
        side={<button type="button" onClick={() => setGrouped(!grouped)} aria-pressed={grouped} title={tx("Regrouper les services sous le nom de leur machine")}
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
                {grouped && <GroupHeader g={g} cols={4} folded={!expanded.includes(g.name)} onToggle={() => setExpanded(expanded.includes(g.name) ? expanded.filter((n) => n !== g.name) : [...expanded, g.name])} />}
                {(!grouped || expanded.includes(g.name)) && mergePorts(g.rows).map(({ lead: r, ports }) => <ServiceRow key={keyOfRow(r)} r={r} ports={ports} grouped={grouped} hidden={isHidden(r, hiddenMap)} onOpen={() => setOpenKey(keyOfRow(r))} onPort={(x) => setOpenKey(keyOfRow(x))} onEdit={admin ? () => setEditKey(keyOfRow(r)) : undefined} />)}
              </Fragment>
            ))}
          </Table>
          <Cards>
            {sort.sorted.map((r) => {
              const k = keyOfRow(r), [cls, label] = status(r);
              return (
                <div key={k} className={`rounded-2xl border border-line bg-card p-3.5 ${r.enabled ? "" : "opacity-70"}`}>
                  <button type="button" onClick={() => setOpenKey(k)} aria-haspopup="dialog" className="flex w-full items-start justify-between gap-2 text-left">
                    <ServiceLogo r={r} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{hostName(r)}</b>
                      <span className="block text-xs text-dim">{r.machine || tx("machine inconnue")} · {r.ip ? `${r.ip}:${r.port}` : r.target || ""}</span>
                    </span>
                    <Badge tone={ST_TONE[cls]}>{label}</Badge>
                  </button>
                </div>
              );
            })}
          </Cards>
        </>
      )}
      </FoldPanel>
      {opened && (
        <Overlay wide onClose={() => setOpenKey(null)} title={<><ServiceLogo r={opened} />{hostName(opened)} <Badge tone="off">{via(opened)}</Badge></>}
          actions={admin && <button type="button" className={quiet} onClick={() => setEditKey(keyOfRow(opened))}><Pencil size={14} aria-hidden />{tx("Modifier")}</button>}>
          {admin && opened.manual && opened.ip && opened.port && <ManualActions r={opened} onEdit={() => { setManual({ initial: { name: hostName(opened), ip: opened.ip!, port: opened.port!, scheme: opened.scheme ?? "http" } }); setOpenKey(null); }} />}
          <div className="mt-3"><ServiceDetail r={opened} admin={snap.me.role === "admin"} ports={portsOf(opened, snap.data.hosts)} related={relatedOf(opened, snap.data.hosts)} onOpen={(x) => setOpenKey(keyOfRow(x))} /></div>
        </Overlay>
      )}
      {editing && <ServiceEdit r={editing} name={hostName(editing)} onClose={() => setEditKey(null)} />}
      {manual && <ManualService machines={snap.data.machine_list.filter((m) => !m.disabled)} initial={manual.initial} onDone={() => setOpenKey(null)} onClose={() => setManual(null)} />}
    </div>
  );
}
