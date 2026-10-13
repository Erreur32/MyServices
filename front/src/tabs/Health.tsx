// Santé des machines (health.py / Beszel) : une fiche par machine, avec ce qui ne va pas en premier.
import { NETWORK_CARDS } from "../lib/network";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { searchHit, useFilter, type Facet, type Selected } from "../lib/filter";
import { dateTime, splitHostName } from "../lib/format";
import type { AsleepHost, HealthHost } from "../types";
import { Badge, Cards, Count, Dim, Empty, Fill, FilterBar, Level, Table, Td, Th } from "../components/ui";
import { MeterCell, ResStrip, SystemdCell, UpdatesCell } from "./Machines";
import { OsGlyph } from "../components/OsGlyph";
import { shortOs } from "../lib/osName";
import { healthItems } from "../lib/machineWatch";
import { Dot } from "../components/marks";
import { OS_LABEL, OS_ORDER, osOfMachine, type OsKind } from "../lib/machines";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Gauge } from "lucide-react";
import { DetailRow, DetailSection } from "../components/DetailSection";
import { OPEN_DETAIL, OPEN_ROW } from "../lib/forms";
import { ViewToggle, useStoredView } from "../components/ViewToggle";
import { InfraCards } from "../components/InfraCards";
import { LEVEL } from "../lib/level";
import { saveCalm, savedCalm, worrying } from "../lib/healthCalm";
import { tx } from "../lib/i18n";

const gb = (mb?: number) => ((mb ?? 0) / 1024).toFixed(1);
const levelOf = (h: HealthHost) => (h.reachable === false ? "down" : h.level || "ok");
const RANK: Record<string, number> = { down: 0, crit: 1, warn: 2, ok: 3, na: 4 };

/** Ce qui ne va pas sur une machine, en phrases courtes (vide = rien à signaler) : la même liste que la colonne « À surveiller » de l'onglet Machines. */
function problems(h: HealthHost): [("bad" | "warn"), string][] {
  return healthItems(h).map((i) => [i.tone === "bad" ? "bad" : "warn", i.text]);
}

const EDGE: Record<string, string> = { ok: "", warn: "border-l-warn" };   // anything worse: red

/** Compact card: who and how it goes, the CPU / memory / disk strip, the first problems; the rest folded under « Détails » */
function HostCard({ h, os }: Readonly<{ h: HealthHost; os?: OsInfo }>) {
  const lv = levelOf(h), pb = problems(h);
  const [name, ip] = splitHostName(h.name);
  return (
    <section className={`flex flex-col gap-2.5 rounded-xl border border-l-[3px] border-line bg-card p-3 has-[details[open]]:!border-link ${EDGE[lv] ?? "border-l-bad"}`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">{os?.kind ? <OsGlyph kind={os.kind} name={os.name} /> : <Gauge size={15} className="text-muted" aria-hidden />}</span>
        <span className="min-w-0 flex-1">
          <b className="block truncate">{name}</b>
          <span className="block truncate text-[11px] text-dim"><span className="font-mono">{ip}</span>{osSuffix(os, h.os)}</span>
        </span>
        <Level level={lv} />
      </div>
      {h.reachable !== false && <ResStrip h={h} />}
      {pb.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {pb.slice(0, 3).map(([t, x]) => <li key={x} className={`truncate ${t === "bad" ? "text-bad" : "text-warn"}`} title={x}>• {x}</li>)}
          {pb.length > 3 && <li className="text-dim">{tx("+{0} autre(s), dans les détails", pb.length - 3)}</li>}
        </ul>
      ) : h.reachable !== false && <p className="text-xs text-ok">{tx("Rien à signaler.")}</p>}
      {h.reachable !== false && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-txt [&::-webkit-details-marker]:hidden">
            <ChevronRight size={13} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />{tx("Détails")}
          </summary>
          <div className="mt-2 flex flex-col gap-2">{pb.length > 3 && <Problems h={h} />}<HostDetails h={h} /></div>
        </details>
      )}
    </section>
  );
}

/** Ce qui est à signaler, en rubrique colorée selon la gravité */
function Problems({ h }: { h: HealthHost }) {
  const pb = problems(h);
  return (
    <DetailSection icon={pb.length ? AlertTriangle : CheckCircle2} title={tx("À signaler")} tone={pb.some(([t]) => t === "bad") ? "bad" : pb.length ? "warn" : "ok"}>
      <div className="flex flex-col gap-1 px-2 py-1 text-sm">
        {pb.length ? pb.map(([t, x], i) => <span key={i} className={t === "bad" ? "text-bad" : "text-warn"}>• {x}</span>) : <span className="text-ok">{tx("Rien à signaler.")}</span>}
      </div>
    </DetailSection>
  );
}

/** Tout ce que la fiche d'une machine garde replié : CPU, mémoire, disques, et les repères (Docker, charge, température, SMART, SSH refusés) ;
 *  la source de la santé à droite de la bande de titre */
function HostDetails({ h }: { h: HealthHost }) {
  const marks = [
    h.docker?.accessible && <Badge key="docker" tone="off">{tx("Docker ·")} {h.docker.total ?? 0} {tx("conteneurs")}</Badge>,
    h.load?.available && <Badge key="load" tone="off">{tx("charge")} {h.load.load_1} / {h.load.ncpu} {tx("CPU")}</Badge>,
    !h.temp?.available && h.temp?.virt && <Badge key="vm" tone="off" title={tx("Machine virtuelle ({0}) : pas de capteur de température", h.temp.virt)}>{tx("VM")}</Badge>,
    h.temp?.available && <Badge key="temp" tone={h.temp.celsius! >= 95 ? "bad" : h.temp.celsius! >= 85 ? "warn" : "off"} title={h.temp.source}>{tx("CPU")} {h.temp.celsius} °C</Badge>,
    h.smart?.accessible && <Badge key="smart" tone="off">{tx("SMART ·")} {h.smart.disks.length} {tx("disque(s)")}</Badge>,
    h.ssh_auth?.available && <Badge key="ssh" tone="off">{tx("SSH refusés 24 h :")} {h.ssh_auth.failed_24h}</Badge>,
  ].filter(Boolean);
  const source = !!h.sources?.length && <Badge tone="info" title={tx("Source de la santé : la première de la liste répond, les suivantes complètent ce qu'elle n'a pas lu")}>{tx("lu par")} {h.sources.map((s) => (s === "ha" && h.api_name) || SOURCE_LABEL[s] || s).join(" + ")}</Badge>;
  return (
    <DetailSection icon={Gauge} title={tx("Ressources")} tone="link" right={source || undefined}>
      {h.res?.available && <>
        <DetailRow k={tx("CPU")}><Fill pct={h.res.cpu_pct ?? 0} tone={(h.res.cpu_pct ?? 0) >= 90 ? "warn" : "ok"} /><span>{Math.round(h.res.cpu_pct ?? 0)} %</span></DetailRow>
        <DetailRow k={tx("Mémoire")}>
          <Fill pct={h.res.mem_pct ?? 0} tone={(h.res.mem_pct ?? 0) >= 97 ? "bad" : (h.res.mem_pct ?? 0) >= 90 ? "warn" : "ok"} /><span>{Math.round(h.res.mem_pct ?? 0)} %</span>
          {h.res.mem_total_mb != null && <Dim>· {gb(h.res.mem_used_mb)} / {gb(h.res.mem_total_mb)} {tx("Go")}</Dim>}
        </DetailRow>
        {!!h.res.swap_total_mb && (h.res.swap_used_mb ?? 0) > 0 && <DetailRow k={tx("swap")}>{gb(h.res.swap_used_mb)} / {gb(h.res.swap_total_mb)} {tx("Go")}</DetailRow>}
      </>}
      {(h.disks || []).filter((d) => (d.size_gb ?? 1) >= 1).map((d) => (
        <DetailRow key={d.mount} k={d.mount} title={d.mount}>
          <Fill pct={d.used_pct} tone={d.critical ? "bad" : d.warning ? "warn" : "ok"} />
          <span>{d.used_pct} %</span>{d.avail_gb != null && <Dim>· {d.avail_gb.toFixed(0)} {tx("Go libres")}</Dim>}
        </DetailRow>
      ))}
      <DetailRow k={tx("Repères")}>{marks.length ? marks : undefined}</DetailRow>
    </DetailSection>
  );
}

function AsleepCard({ a, os }: { a: AsleepHost; os?: OsInfo }) {
  const [name, ip] = splitHostName(a.name);
  return (
    <section className={`flex flex-col gap-2.5 rounded-xl border border-line bg-card p-3 ${a.ping ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg2">{os?.kind ? <OsGlyph kind={os.kind} name={os.name} /> : <Gauge size={15} className="text-muted" aria-hidden />}</span>
        <span className="min-w-0 flex-1"><b className="block truncate">{name}</b><span className="block truncate text-[11px] text-dim"><span className="font-mono">{ip}</span>{osSuffix(os, a.os)}</span></span>
        {a.ping ? <Badge tone="ok" title={tx("Répond au ping : son agent n'a pas encore envoyé de relevé")}>{tx("allumée, agent en attente")}</Badge>
          : <Badge tone="off" title={tx("Éteinte volontairement, aucune alerte")}>{tx("éteinte (voulu)")}</Badge>}
      </div>
      <p className="text-xs text-muted">{a.last_seen ? tx("Dernier relevé de l'agent : {0}", dateTime(a.last_seen * 1000)) : tx("Pas encore de relevé.")}</p>
    </section>
  );
}

interface OsInfo { kind?: OsKind; name?: string }

/** « · Debian 13 » after the IP: the system's short name, or « Windows » when only the family is known */
function osSuffix(os: OsInfo | undefined, family?: string): string {
  if (os?.name) return ` · ${shortOs(os.name)}`;
  return family === "windows" ? tx(" · Windows") : "";
}

function OsCell({ os }: { os: OsInfo }) {
  return os.kind ? <span className="inline-flex max-w-[15rem] items-center gap-1.5" title={os.name}><OsGlyph kind={os.kind} name={os.name} /><span className="truncate">{shortOs(os.name) || OS_LABEL[os.kind]}</span></span> : <Dim>-</Dim>;
}

/** Machines rangées par accès : celles lues par SSH, celles qui envoient un relevé (agent), puis celles lues par Beszel */
const ACCESS: [string, string][] = [["ssh", "SSH"], ["agent", tx("Agent")], ["beszel", "Beszel"], ["ha", tx("API")]];
const accessOf = (h: HealthHost) => (h.source && ACCESS.some(([k]) => k === h.source) ? h.source : "ssh");

/** Tableau : une ligne légère par machine ; le chevron déplie ce qui est à signaler et le détail (disques, Docker, charge, SMART…) */
type TableGroup = { key: string; title: string; hosts: HealthHost[]; asleep: AsleepHost[] };

function HealthTable({ groups, osOf, open, toggle }: {
  groups: TableGroup[]; osOf: (ip: string, fallback?: string) => OsInfo; open: Set<string>; toggle: (id: string) => void;
}) {
  return (
    <Table fit head={<><th className="w-8 px-1" aria-label={tx("Détails")} /><Th>{tx("Machine")}</Th><Th>{tx("Système")}</Th><Th>{tx("État")}</Th><Th>{tx("CPU")}</Th><Th>{tx("Mémoire")}</Th><Th>{tx("Disque")}</Th><Th>{tx("Systemd")}</Th><Th>{tx("Mises à jour")}</Th></>}>
      {groups.map(({ key, title, hosts, asleep }) => (
        <Fragment key={key}>
          <tr className="border-0 bg-bg2/50"><td colSpan={9} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">{title} <Count n={hosts.length + asleep.length} tone="off" /></td></tr>
          {hosts.map((h) => {
            const [name, ip] = splitHostName(h.name), pb = problems(h), shown = open.has(h.id);
            return (
              <Fragment key={h.id}>
                <tr className={shown ? OPEN_ROW : "hover:bg-bg2/60"}>
                  <td className="w-8 px-1 py-2 align-middle">
                    <button type="button" onClick={() => toggle(h.id)} aria-expanded={shown} aria-label={tx("Détails de {0}", name)} title={shown ? tx("Replier") : tx("Déplier le détail")}
                      className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt">{shown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                  </td>
                  <Td><b>{name}</b> <span className="text-xs text-dim">{ip}</span>{pb.length > 0 && <span className={`ml-2 text-xs ${pb.some(([t]) => t === "bad") ? "text-bad" : "text-warn"}`} title={pb.map((x) => x[1]).join("\n")}>⚑ {pb.length}</span>}</Td>
                  <Td><OsCell os={osOf(ip, h.os)} /></Td><Td><Level level={levelOf(h)} /></Td>
                  <Td><MeterCell h={h} what="cpu" /></Td><Td><MeterCell h={h} what="mem" /></Td><Td><MeterCell h={h} what="disk" /></Td><Td><SystemdCell h={h} /></Td><Td><UpdatesCell h={h} /></Td>
                </tr>
                {shown && (
                  <tr className={`bg-bg2/40 ${OPEN_DETAIL}`}><td colSpan={9} className="p-0">
                    <div className="grid items-start gap-3 px-3 py-3 lg:grid-cols-2">
                      <Problems h={h} />
                      {h.reachable !== false && <HostDetails h={h} />}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}
          {asleep.map((a) => {
            const [name, ip] = splitHostName(a.name);
            return (
              <tr key={a.id} className={a.ping ? "" : "opacity-60"}>
                <td className="w-8 px-1" /><Td><b>{name}</b> <span className="text-xs text-dim">{ip}</span></Td><Td><OsCell os={osOf(ip, a.os)} /></Td>
                <Td>{a.ping ? <Badge tone="ok">{tx("allumée, agent en attente")}</Badge> : <Badge tone="off">{tx("éteinte (voulu)")}</Badge>}</Td>
                <Td className="!whitespace-normal text-xs text-muted">{a.last_seen ? tx("Dernier relevé de l'agent : {0}", dateTime(a.last_seen * 1000)) : tx("Pas encore de relevé.")}</Td>
                <Td /><Td /><Td /><Td />
              </tr>
            );
          })}
        </Fragment>
      ))}
    </Table>
  );
}

/** One line on top: all fine, or which machines need a look (first problem of each); the button shows or hides the healthy ones */
function Summary({ hosts, asleep, calm, onCalm, filtering }: { hosts: HealthHost[]; asleep: number; calm: boolean; onCalm: (on: boolean) => void; filtering: boolean }) {
  const bad = hosts.filter((h) => worrying(levelOf(h))), others = hosts.length - bad.length + asleep;
  const tone = !bad.length ? "border-ok/40 bg-ok/5" : bad.some((h) => levelOf(h) !== "warn") ? "border-bad/40 bg-bad/5" : "border-warn/40 bg-warn/5";
  return (
    <div role="status" className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-4 py-2.5 text-sm ${tone}`}>
      {bad.length ? <AlertTriangle size={16} className="shrink-0 text-warn" aria-hidden /> : <CheckCircle2 size={16} className="shrink-0 text-ok" aria-hidden />}
      <span className="min-w-0 flex-1">
        {bad.length ? <>
          <b>{tx("{0} machine(s) à regarder", bad.length)}</b>{" : "}
          {bad.slice(0, 4).map((h) => `${splitHostName(h.name)[0]} (${problems(h)[0]?.[1] ?? LEVEL[levelOf(h)][1]})`).join(", ")}{bad.length > 4 ? ", …" : ""}
        </> : <b>{tx("{0} machine(s), toutes en bonne santé", hosts.length)}</b>}
        {asleep > 0 && <Dim> · {tx("{0} éteinte(s)", asleep)}</Dim>}
      </span>
      {!filtering && others > 0 && (
        <button type="button" onClick={() => onCalm(!calm)} aria-pressed={!calm} className="text-sm text-link hover:underline">
          {calm ? tx("Afficher les {0} autres", others) : tx("Masquer les machines sans souci")}
        </button>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { ssh: "SSH", agent: tx("agent"), beszel: "Beszel", ha: "Home Assistant" };

export function Health({ snap, initial }: { snap: Snapshot; initial?: Selected }) {
  const hosts = useMemo(() => [...(snap.health?.hosts || [])].sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)]), [snap.health]);
  // Système d'une machine : logo de la distribution quand on la connaît (relevé SSH ou agent), sinon la famille (Linux, Windows…)
  const byIp = useMemo(() => new Map(snap.data.machine_list.map((m) => [m.ip, m])), [snap.data.machine_list]);
  const osOf = useCallback((ip: string, fallback?: string): OsInfo => {
    const m = byIp.get(ip), name = m?.info?.os || m?.agent?.os || undefined;
    const kind = osOfMachine({ os: m?.agent || fallback === "windows" ? "windows" : undefined, info: m?.info, ttl: m?.ttl }, undefined, !!m?.ssh)?.kind ?? (fallback === "windows" ? "windows" : fallback ? "linux" : undefined);
    return { kind, name };
  }, [byIp]);
  const facets = useMemo((): Facet<HealthHost>[] => [
    { key: "level", label: tx("État"), get: levelOf, name: (v) => LEVEL[v]?.[1] || v, order: ["down", "crit", "warn", "ok"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
    { key: "os", label: tx("Système"), get: (h) => osOf(splitHostName(h.name)[1], h.os).kind ?? "", name: (v) => OS_LABEL[v as OsKind], order: OS_ORDER, mark: (v) => <OsGlyph kind={v as OsKind} size={13} /> },
    { key: "access", label: tx("Accès"), get: accessOf, name: (v) => ACCESS.find(([k]) => k === v)?.[1] ?? v, order: ACCESS.map(([k]) => k) },
  ], [osOf]);
  const text = useCallback((h: HealthHost) => [h.name, ...problems(h).map((p) => p[1])].join(" "), []);
  const f = useFilter(hosts, facets, text, initial);
  const [view, pickView] = useStoredView("ms.health.view", "table");
  const [open, setOpen] = useState<Set<string>>(new Set());  // lignes du tableau dépliées
  const toggleOpen = (id: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const [calm, setCalm] = useState(savedCalm);
  const pickCalm = (on: boolean) => { setCalm(on); saveCalm(on); };
  const hideFine = calm && f.active === 0;   // a search or a filter always shows everything it finds
  const listed = hideFine ? f.shown.filter((h) => worrying(levelOf(h))) : f.shown;
  const allOpen = listed.length > 0 && listed.every((h) => open.has(h.id));
  // Machines that are off: no health, so only the search and the « System » / « Access » filters apply (a « State » filter hides them)
  const asleep = hideFine ? [] : (snap.health?.asleep ?? []).filter((a) => searchHit(a.name, f.query) && !f.sel.level?.length
    && (!f.sel.os?.length || f.sel.os.includes(osOf(splitHostName(a.name)[1], a.os).kind ?? "")) && (!f.sel.access?.length || f.sel.access.includes("agent")));
  const services = (snap.data.services_status ?? []).filter((c) => !NETWORK_CARDS.includes(c.connector)), docker = (snap.data.containers ?? []).filter((c) => !c.links_only);   // hypervisors and PBS: Virtualization tab; Freebox, UniFi…: Network tab
  if (!snap.health) return services.length || docker.length ? <div className="py-1"><InfraCards docker={docker} services={services} /><Empty>{tx("Santé pas encore relevée.")}</Empty></div> : <Empty>{tx("Santé pas encore relevée.")}</Empty>;
  return (
    <div className="py-1">
      <Summary hosts={hosts} asleep={snap.health.asleep?.length ?? 0} calm={calm} onCalm={pickCalm} filtering={f.active > 0} />
      <FilterBar f={f} placeholder={tx("Machine, disque, service en échec…")}
        extra={<>
          <ViewToggle view={view} onPick={pickView} />
          {view === "table" && listed.length > 0 && (
            <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(listed.map((h) => h.id)))} aria-pressed={allOpen}
              className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:text-txt md:inline-flex">
              {allOpen ? <ChevronsDownUp size={14} aria-hidden /> : <ChevronsUpDown size={14} aria-hidden />}{allOpen ? tx("Tout replier") : tx("Tout déplier")}
            </button>
          )}
          <span className="text-xs text-dim">{tx("relevé du")} {dateTime(snap.health.timestamp)}</span>
        </>} />
      <InfraCards docker={docker} services={services} />
      {listed.length === 0 && !asleep.length && hideFine && (
        <Empty>{tx("Toutes les machines vont bien : elles sont masquées.")} <button type="button" onClick={() => pickCalm(false)} className="text-link hover:underline">{tx("Les afficher")}</button></Empty>
      )}
      {listed.length === 0 && !asleep.length && !hideFine && <Empty>{tx("Aucune machine pour ce filtre.")}</Empty>}
      {(listed.length > 0 || asleep.length > 0) && (() => {
        const groups = ACCESS.map(([key, title]) => ({ key, title, hosts: listed.filter((h) => accessOf(h) === key), asleep: key === "agent" ? asleep : [] }))   // a PC that is off is known by its agent
          .filter((g) => g.hosts.length || g.asleep.length);
        const cards = groups.map((g) => (
          <section key={g.key} className="mb-4" aria-label={g.title}>
            <h2 className="mb-2 flex items-center gap-2 border-b border-line/60 pb-1 text-xs font-bold uppercase tracking-wider text-dim">{g.title} <Count n={g.hosts.length + g.asleep.length} tone="off" /></h2>
            <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {g.hosts.map((h) => <HostCard key={h.id} h={h} os={osOf(splitHostName(h.name)[1], h.os)} />)}
              {g.asleep.map((a) => <AsleepCard key={a.id} a={a} os={osOf(splitHostName(a.name)[1], a.os)} />)}
            </div>
          </section>
        ));
        return view === "table" ? <><HealthTable groups={groups} osOf={osOf} open={open} toggle={toggleOpen} /><Cards>{cards}</Cards></> : <>{cards}</>;
      })()}
    </div>
  );
}
