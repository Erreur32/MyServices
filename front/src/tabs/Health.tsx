// Santé des machines (health.py / Beszel) : une fiche par machine, avec ce qui ne va pas en premier.
import { Fragment, useCallback, useMemo, useState } from "react";
import type { Snapshot } from "../api";
import { useFilter, type Facet, type Selected } from "../lib/filter";
import { dateTime, splitHostName } from "../lib/format";
import type { AsleepHost, HealthHost } from "../types";
import { Badge, Cards, Count, Dim, Empty, Fill, FilterBar, Level, Table, Td, Th } from "../components/ui";
import { DiskCell, ResCell, SystemdCell, UpdatesCell } from "./Machines";
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
import { tx } from "../lib/i18n";

const gb = (mb?: number) => ((mb ?? 0) / 1024).toFixed(1);
const levelOf = (h: HealthHost) => (h.reachable === false ? "down" : h.level || "ok");
const RANK: Record<string, number> = { down: 0, crit: 1, warn: 2, ok: 3, na: 4 };

/** Ce qui ne va pas sur une machine, en phrases courtes (vide = rien à signaler) : la même liste que la colonne « À surveiller » de l'onglet Machines. */
function problems(h: HealthHost): [("bad" | "warn"), string][] {
  return healthItems(h).map((i) => [i.tone === "bad" ? "bad" : "warn", i.text]);
}

function HostCard({ h, os }: { h: HealthHost; os?: OsInfo }) {
  const lv = levelOf(h), pb = problems(h);
  const [name, ip] = splitHostName(h.name);
  return (
    <section className={`rounded-2xl border bg-card p-4 has-[details[open]]:!border-link has-[details[open]]:ring-1 has-[details[open]]:ring-link ${lv === "ok" ? "border-line" : lv === "warn" ? "border-warn/50" : "border-bad/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div><b>{name}</b><span className="flex items-center gap-1.5 text-xs text-dim">{os?.kind && <OsGlyph kind={os.kind} name={os.name} />}{ip}{os?.name ? ` · ${shortOs(os.name)}` : h.os === "windows" ? tx(" · Windows") : ""}</span></div>
        <Level level={lv} />
      </div>
      {pb.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {pb.map(([t, s], i) => <li key={i} className={t === "bad" ? "text-bad" : "text-warn"}>• {s}</li>)}
        </ul>
      ) : h.reachable !== false && <p className="mt-3 text-sm text-ok">{tx("Rien à signaler.")}</p>}
      {h.reachable !== false && (
        <details className="group mt-3 rounded-lg border border-line/60 bg-bg2/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted hover:text-txt [&::-webkit-details-marker]:hidden">
            <ChevronRight size={13} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            <span className="font-semibold">{tx("Détails")}</span>
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5"><ResCell h={h} what="cpu" /><ResCell h={h} what="mem" /><DiskCell h={h} /></span>
          </summary>
          <div className="px-2 pb-2 pt-1"><HostDetails h={h} /></div>
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
  const source = !!h.sources?.length && <Badge tone="info" title={tx("Source de la santé : la première de la liste répond, les suivantes complètent ce qu'elle n'a pas lu")}>{tx("lu par")} {h.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" + ")}</Badge>;
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
    <section className={`rounded-2xl border border-line bg-card p-4 ${a.ping ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div><b>{name}</b><span className="block flex items-center gap-1.5 text-xs text-dim">{os?.kind && <OsGlyph kind={os.kind} name={os.name} />}{ip}{os?.name ? ` · ${shortOs(os.name)}` : a.os === "windows" ? tx(" · Windows") : ""}</span></div>
        {a.ping ? <Badge tone="ok" title={tx("Répond au ping : son agent n'a pas encore envoyé de relevé")}>{tx("allumée, agent en attente")}</Badge>
          : <Badge tone="off" title={tx("Éteinte volontairement, aucune alerte")}>{tx("éteinte (voulu)")}</Badge>}
      </div>
      <p className="mt-3 text-sm text-muted">{a.last_seen ? tx("Dernier relevé de l'agent : {0}", dateTime(a.last_seen * 1000)) : tx("Pas encore de relevé.")}</p>
    </section>
  );
}

interface OsInfo { kind?: OsKind; name?: string }

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
                  <Td><ResCell h={h} what="cpu" /></Td><Td><ResCell h={h} what="mem" /></Td><Td><DiskCell h={h} /></Td><Td><SystemdCell h={h} /></Td><Td><UpdatesCell h={h} /></Td>
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
  const allOpen = f.shown.length > 0 && f.shown.every((h) => open.has(h.id));
  const asleep = (snap.health?.asleep ?? []).filter((a) => !Object.keys(f.sel).length && a.name.toLowerCase().includes(f.query.trim().toLowerCase()));
  const services = snap.data.services_status ?? [], virt = snap.data.virtualization ?? [], docker = snap.data.containers ?? [];
  if (!snap.health) return services.length || virt.length || docker.length ? <div className="py-1"><InfraCards virt={virt} docker={docker} services={services} /><Empty>{tx("Santé pas encore relevée.")}</Empty></div> : <Empty>{tx("Santé pas encore relevée.")}</Empty>;
  return (
    <div className="py-1">
      <FilterBar f={f} placeholder={tx("Machine, disque, service en échec…")}
        extra={<>
          <ViewToggle view={view} onPick={pickView} />
          {view === "table" && f.shown.length > 0 && (
            <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(f.shown.map((h) => h.id)))} aria-pressed={allOpen}
              className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:text-txt md:inline-flex">
              {allOpen ? <ChevronsDownUp size={14} aria-hidden /> : <ChevronsUpDown size={14} aria-hidden />}{allOpen ? tx("Tout replier") : tx("Tout déplier")}
            </button>
          )}
          <span className="text-xs text-dim">{tx("relevé du")} {dateTime(snap.health.timestamp)}</span>
        </>} />
      <InfraCards virt={virt} docker={docker} services={services} />
      {f.shown.length === 0 && !asleep.length ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (() => {
        const groups = ACCESS.map(([key, title]) => ({ key, title, hosts: f.shown.filter((h) => accessOf(h) === key), asleep: key === "agent" ? asleep : [] }))   // a PC that is off is known by its agent
          .filter((g) => g.hosts.length || g.asleep.length);
        const cards = groups.map((g) => (
          <section key={g.key} className="mb-4" aria-label={g.title}>
            <h2 className="mb-2 flex items-center gap-2 border-b border-line/60 pb-1 text-xs font-bold uppercase tracking-wider text-dim">{g.title} <Count n={g.hosts.length + g.asleep.length} tone="off" /></h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
