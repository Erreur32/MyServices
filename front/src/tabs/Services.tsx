// Services : tous les services (NPM et directs) avec leur état, leur machine et leur source ; clic sur une ligne
// = fiche détaillée dans une fenêtre (comme Machines). Sur mobile, une fiche par service.
import { ChevronDown, ChevronRight, ExternalLink, Server } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { ipNum } from "../lib/format";
import { Dot, Logo } from "../components/marks";
import { appIcon, serviceIcon } from "../lib/appIcons";
import { CHECK, CLEANUP, KIND_NAME, checks, exposure, hostName, noIdentity, status, type Check } from "../lib/status";
import type { Host } from "../types";
import { Badge, Cards, Dim, Empty, FilterBar, Table, Td, Th, type Tone } from "../components/ui";
import { ServiceDetail } from "./ServiceDetail";
import { Overlay } from "../components/Overlay";
import { tx } from "../lib/i18n";

const ST_TONE: Record<string, Tone> = { ok: "ok", warn: "warn", bad: "bad", off: "off" };
const ST_NAME: Record<string, string> = { ok: "OK", warn: "avertissement", bad: tx("en panne"), off: tx("désactivé / non testé") };
const TYPE_NAME: Record<string, string> = { proxy: tx("Proxy NPM"), redirect: "Redirection", dead: "404", stream: "Stream", local: tx("Service") };
const EXPO: Record<string, [Tone, string, string]> = {
  prive: ["ok", tx("🔒 protégé"), tx("Seul le réseau local ou le VPN peut l'ouvrir, grâce à une liste d'accès NPM (ACL) ou à une garde LAN dans la configuration.")],
  public: ["info", tx("🌍 public"), tx("Ouvert à Internet volontairement : le site est déclaré public, sans liste d'accès.")],
  ouvert: ["bad", tx("⚠ ouvert ?"), tx("Ni liste d'accès ni déclaration « public » : le site est peut-être joignable depuis Internet sans aucune restriction. À vérifier.")],
};
/** Every real domain of a service: its NPM domains, or the ones its Apache / nginx declares */
const declaredDomains = (r: Host): string[] => (r.domains.length ? r.domains : r.vhost_domains ?? []);
const domainSource = (r: Host) => (r.domains.length ? "NPM" : r.vhost_server === "nginx" ? "nginx" : "Apache");
const hostIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";
const keyOfRow = (r: Host) => `${r.type}${r.id}`;

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

function Name({ r }: { r: Host }) {
  const u = url(r);
  return (
    <div className="min-w-0">
      {u ? (
        <a href={u} target="_blank" rel="noopener" onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 font-semibold hover:text-link">
          <span className="truncate">{hostName(r)}</span><ExternalLink size={12} className="shrink-0 text-dim" />
        </a>
      ) : <b>{hostName(r)}</b>}
      {r.domains.length > 1 && <span className="ml-1 text-xs text-dim" title={r.domains.slice(1).join(", ")}>+{r.domains.length - 1}</span>}
      <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
        <Badge tone="off" title={`${tx("Source")}\n${tx("Lu via : {0}", via(r))}${r.forward_declared ? `\n${tx("Cible réelle : {0}:{1} (advanced_config). NPM déclare {2}, ignoré.", r.ip, r.port, r.forward_declared)}` : ""}`}>{via(r)}</Badge>
      </span>
    </div>
  );
}

/** Icon-only marks next to the state, in fixed slots so they line up from row to row: exposure (private, public, open) and SSL */
function Marks({ r }: { r: Host }) {
  const e = exposure(r), risk = sslRisk(r), domains = declaredDomains(r);
  const slot = "inline-flex w-7 justify-center";
  return (
    <>
      <span className={slot}>{e && <Badge tone={EXPO[e][0]} title={`${EXPO[e][1].replace(/^\S+\s/, "")}\n${EXPO[e][2]}`}>{EXPO[e][1].split(" ")[0]}</Badge>}</span>
      <span className={slot}>{domains.length > 0 && <Badge tone="info" title={`${tx("Domaines déclarés ({0})", domainSource(r))}\n${domains.join("\n")}`}>🌐</Badge>}</span>
      <span className={slot}>{risk && <Badge tone={r.ssl ? "warn" : "bad"} title={`${risk}\n${tx("Ouvrez la fiche pour le détail de l'accès.")}`}>🔓</Badge>}</span>
    </>
  );
}

/** One readable state; the reason and the flags to check are in the tooltip */
function State({ r, ck }: { r: Host; ck: Check[] }) {
  const [cls, label, why] = status(r);
  const flags = ck.filter((k) => !CLEANUP.includes(k)).map((k) => `⚑ ${CHECK[k][0]}`);
  return (
    <span className="inline-flex items-center gap-1">
      <Marks r={r} />
      <Badge tone={ST_TONE[cls]} title={[label, why, ...flags].filter(Boolean).join("\n")}>{label}{flags.length > 0 && <span className="ml-1">⚑</span>}</Badge>
    </span>
  );
}

/** Logo du service, dans sa propre colonne pour ne pas déformer le nom ; la place est gardée quand il n'y en a pas */
function ServiceLogo({ r }: { r: Host }) {
  const src = serviceIcon(r);
  return src ? <span className="grid h-7 w-7 min-w-7 shrink-0 place-items-center rounded-md bg-bg2" title={r.app?.label || r.service?.name}><img src={src} alt="" className="h-4 w-4" /></span> : <span className="block h-7 w-7 shrink-0" aria-hidden />;
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

function GroupHeader({ g, folded, onToggle, cols }: { g: { name: string; ip: string; rows: Host[] }; folded: boolean; onToggle: () => void; cols: number }) {
  const count = (c: string) => g.rows.filter((r) => status(r)[0] === c).length;
  return (
    <tr onClick={onToggle} className={`cursor-pointer hover:bg-bg2 ${folded ? "bg-bg2/70" : "bg-link/15"}`}>
      <td colSpan={cols} className={`p-0 ${folded ? "" : OPEN_EDGE}`}>
        {/* width 0 + min-width 100%: the title adds nothing to the column widths, so the columns below keep their own size */}
        <span className="flex w-0 min-w-full flex-wrap items-center gap-2 px-3 py-2">
          {folded ? <ChevronRight size={15} className="text-dim" aria-hidden /> : <ChevronDown size={15} className="text-dim" aria-hidden />}
          <Server size={15} className="text-link" aria-hidden /><b>{g.name}</b>{g.ip && g.ip !== g.name && <Dim>{g.ip}</Dim>}
          <Badge tone="off">{g.rows.length}</Badge>
          {count("bad") > 0 && <Badge tone="bad">{count("bad")} {tx("en panne")}</Badge>}
          {count("warn") > 0 && <Badge tone="warn">{count("warn")} {tx("avertissement")}</Badge>}
        </span>
      </td>
    </tr>
  );
}

function ServiceRow({ r, grouped, onOpen }: { r: Host; grouped: boolean; onOpen: () => void }) {   // grouped: the rows of an opened group sit on a darker background with a coloured edge
  return (
    <tr onClick={onOpen} className={`cursor-pointer ${grouped ? "bg-bg/60 hover:bg-bg2/60" : "hover:bg-bg2/60"} ${r.enabled ? "" : "opacity-60"}`}>
      <Td className={`overflow-hidden align-middle whitespace-nowrap ${grouped ? `${OPEN_EDGE} !pl-14` : ""}`}><State r={r} ck={checks(r)} /></Td>
      <Td className="overflow-hidden !pl-10 align-middle"><Name r={r} /></Td>
      <Td className="overflow-hidden whitespace-nowrap !pl-6 align-middle font-mono text-xs text-muted">
        {r.type === "redirect" ? `→ ${r.target}` : r.type === "dead" ? tx("aucune (404)") : `${r.ip}:${r.port}`}
      </Td>
      {!grouped && <Td className="!pl-6 align-middle">{r.machine ? <><b className="font-medium">{r.machine}</b>{r.category && <span className="block text-xs text-dim">{r.category}</span>}</> : <Dim>-</Dim>}</Td>}
      <Td className="overflow-hidden !pl-10 align-middle"><div className="flex items-center gap-2.5"><ServiceLogo r={r} /><Tech r={r} /></div></Td>
    </tr>
  );
}

export function Services({ snap, initial }: { snap: Snapshot; initial?: Selected }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const machines = useMemo(() => new Map(snap.data.machine_list.map((m) => [m.ip, m.name])), [snap.data.machine_list]);
  const facets = useMemo((): Facet<Host>[] => [
    { key: "src", label: tx("Source"), get: (r) => (r.type === "local" ? "local" : "npm"), name: (v) => (v === "npm" ? "NPM" : tx("Services")), order: ["npm", "local"],
      mark: (v) => (v === "npm" ? <Logo src={`${import.meta.env.BASE_URL}icons/nginx-proxy-manager.svg`} /> : <Dot tone="info" />) },
    { key: "status", label: tx("État"), get: (r) => status(r)[0], name: (v) => ST_NAME[v] || v, order: ["bad", "warn", "ok", "off"], mark: (v) => <Dot tone={v as Tone} /> },
    { key: "domain", label: tx("Domaine"), get: (r) => (declaredDomains(r).length ? "with" : "without"), name: (v) => (v === "with" ? tx("avec domaine") : tx("sans domaine")), order: ["with", "without"],
      mark: (v) => <Dot tone={v === "with" ? "info" : "off"} /> },
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
  const [grouped, setGrouped] = useGrouped(), [expanded, setExpanded] = useState<string[]>([]);   // groups are folded until opened
  const groups = useMemo(() => (grouped ? groupByMachine(sort.sorted) : [{ name: "", ip: "", rows: sort.sorted }]), [grouped, sort.sorted]);

  return (
    <div className="py-1">
      <FilterBar f={f} primary={["status", "domain", "machine"]} placeholder={tx("Domaine, IP, port, conteneur, image…")}
        side={<button type="button" onClick={() => setGrouped(!grouped)} aria-pressed={grouped} title={tx("Regrouper les services sous le nom de leur machine")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-colors ${grouped ? "border-link bg-link/15 text-txt" : "border-line text-link hover:bg-link/10"}`}>
          <Server size={14} aria-hidden />{tx("Par machine")}</button>} />
      {sort.sorted.length === 0 ? <Empty>{tx("Aucun service pour ce filtre.")}</Empty> : (
        <>
          <Table fixed head={<>
            <Th k="status" sort={sort} className={grouped ? "w-[19.5rem] !pl-14" : "w-64"}>{tx("État")}</Th><Th k="name" sort={sort} className="w-[30%] !pl-10">{tx("Service")}</Th><Th k="target" sort={sort} className="w-60 !pl-6">{tx("Cible")}</Th>
            {!grouped && <Th k="machine" sort={sort} className="w-[16%] !pl-6">{tx("Machine")}</Th>}<Th k="kind" sort={sort} className="!pl-10">{tx("Logiciel")}</Th>
          </>}>
            {groups.map((g) => (
              <Fragment key={g.name}>
                {grouped && <GroupHeader g={g} cols={4} folded={!expanded.includes(g.name)} onToggle={() => setExpanded(expanded.includes(g.name) ? expanded.filter((n) => n !== g.name) : [...expanded, g.name])} />}
                {(!grouped || expanded.includes(g.name)) && g.rows.map((r) => <ServiceRow key={keyOfRow(r)} r={r} grouped={grouped} onOpen={() => setOpenKey(keyOfRow(r))} />)}
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
      {opened && (
        <Overlay wide onClose={() => setOpenKey(null)} title={<><ServiceLogo r={opened} />{hostName(opened)} <Badge tone="off">{via(opened)}</Badge></>}>
          <div className="mt-3"><ServiceDetail r={opened} admin={snap.me.role === "admin"} /></div>
        </Overlay>
      )}
    </div>
  );
}
