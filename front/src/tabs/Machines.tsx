// Machines : accès (ping, SSH), système, serveurs (NPM, Apache, Docker), services et santé de chaque machine.
import { ArrowRight, ArrowUpCircle, Boxes, Plus, Bug, Check, ChevronDown, ChevronRight, Container, Cpu, Eye, EyeOff, Gauge, Globe, HardDrive, HeartPulse, IdCard, Info, KeyRound, MemoryStick, Plug, RotateCw, ScanSearch, ServerCrash, ShieldAlert, Thermometer, Unplug, WifiOff, type LucideIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { dateTime, dur, ipNum, splitHostName } from "../lib/format";
import { status } from "../lib/status";
import type { HealthHost, Machine, MachineLinks, NetDevice, NetScan, ServiceStatus, Unlinked } from "../types";
import { AddonStrip, HaAddons } from "../components/ServiceStatusCards";
import { MSTATE, ORDER, OS_LABEL, OS_ORDER, mState, osOfMachine, type MState, type OsKind } from "../lib/machines";
import { OsGlyph } from "../components/OsGlyph";
import { shortOs } from "../lib/osName";
import { ViewToggle, useStoredView } from "../components/ViewToggle";
import { Dot } from "../components/marks";
import { LEVEL } from "../lib/level";
import { rolesOf } from "../lib/ssh";
import { SshAccess } from "../components/ssh";
import { DetailRow, DetailSection } from "../components/DetailSection";
import { OPEN_DETAIL, OPEN_ROW, quiet } from "../lib/forms";
import { rereadMachines } from "../lib/scan";
import { watchItems, worst, type WatchItem, type WatchKind, type WatchTone } from "../lib/machineWatch";
import { MachineIcon } from "../components/MachineIcon";
import { Badge, Cards, Dim, Empty, Fill, FilterBar, Level, Table, Td, Th } from "../components/ui";
import { tx } from "../lib/i18n";
import { hardwareRows } from "../lib/hardware";


function healthByIp(hosts: HealthHost[] = []): Map<string, HealthHost> {
  return new Map(hosts.map((h) => [splitHostName(h.name)[1], h]));
}

function topDisk(h?: HealthHost) {
  return (h?.disks || []).reduce<NonNullable<HealthHost["disks"]>[number] | null>((a, d) => (!a || d.used_pct > a.used_pct ? d : a), null);
}

/** Logiciels de service détectés sur la machine, en icônes ; les nombres (conteneurs, vhosts) sont dans l'info-bulle.
 *  max : au-delà, une pastille « +N » (la liste complète est dans le détail déplié) */
function Servers({ m, snap, max }: { m: Machine; snap: Snapshot; max?: number }) {
  const rows = snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.service);
  const npm = rows.some((r) => /nginx-proxy-manager/.test(r.service!.image || ""));
  const apDown = rows.filter((r) => r.enabled && r.service!.kind === "apache" && status(r)[0] === "bad").length;
  const i = m.info || {}, vh = (i.vhosts || []).length, unread = (i.vhosts_unreadable || []).length;
  const chips: { key: string; icon: string; tip: string; bad?: boolean }[] = [
    ...(npm ? [{ key: "npm", icon: "nginx-proxy-manager", tip: tx("Nginx Proxy Manager : la machine héberge un NPM") }] : []),
    ...(i.apache ? [{ key: "apache", icon: "apache", bad: apDown > 0,
      tip: tx("Apache : {0} vhost(s)", vh) + (unread ? `\n${tx("Vhosts actifs dont la config n'est pas lisible par le compte SSH : {0}. Leurs domaines et ports restent inconnus.", (i.vhosts_unreadable || []).join(", "))}` : "") + (apDown ? `\n${tx("{0} en panne", apDown)}` : "") }] : []),
    ...(i.nginx ? [{ key: "nginx", icon: "nginx", tip: tx("nginx installé et actif sur la machine (hors conteneur)") }] : []),
    ...(i.docker ? [{ key: "docker", icon: "docker", tip: tx("Docker : {0} conteneur(s) en cours", i.docker) }] : []),
  ];
  const shown = max && chips.length > max ? chips.slice(0, max) : chips, more = chips.slice(shown.length);
  return chips.length ? (
    <div className={`flex items-center gap-1 ${max ? "flex-nowrap" : "flex-wrap"}`}>
      {shown.map((c) => (
        <span key={c.key} title={c.tip} tabIndex={0} className={`grid h-7 w-7 place-items-center rounded-md border ${c.bad ? "border-bad/60 bg-bad/10" : "border-line bg-bg2"}`}>
          <img src={`${import.meta.env.BASE_URL}icons/${c.icon}.svg`} alt="" className="h-4 w-4" />
        </span>
      ))}
      {more.length > 0 && <span title={tx("Aussi : {0} (détail déplié)", more.map((c) => c.key).join(", "))} className="grid h-7 min-w-7 place-items-center rounded-md border border-line bg-bg2 px-1 text-[11px] font-bold text-muted">+{more.length}</span>}
    </div>
  ) : <Dim>-</Dim>;
}

/** Clé utilisée par l'alias (chemin et début d'empreinte) */
function KeyCell({ m }: { m: Machine }) {
  const s = m.ssh;
  if (!s) return <Dim>-</Dim>;
  if (!s.identity) return <Dim>{tx("aucune (accès manuel)")}</Dim>;
  return <div className="flex flex-col"><code className="break-all text-xs">{s.identity}</code>{s.key_fp && <span className="truncate font-mono text-[11px] text-dim" title={s.key_fp}>{s.key_fp.slice(0, 22)}…</span>}</div>;
}

/** ✓ vert = sûr, ⚠ orange = à revoir, - = inconnu ; l'explication est au survol */
function Mark({ tone, title, children }: { tone: "ok" | "warn" | "bad" | "off"; title: string; children: string }) {
  const c = { ok: "text-ok", warn: "text-warn", bad: "text-bad", off: "text-dim" }[tone];
  return <span className={`text-base font-bold ${c}`} title={title} aria-label={title}>{children}</span>;
}

function HostKey({ m }: { m: Machine }) {
  if (!m.ssh) return <Dim>-</Dim>;
  return m.ssh.host_key ? <Mark tone="ok" title={tx("Clé d'hôte connue (known_hosts)")}>✓</Mark>
    : <Mark tone="bad" title={tx("Clé d'hôte absente de known_hosts : 1re connexion non vérifiée")}>✗</Mark>;
}

/** Root et mot de passe selon sshd : refusé ou clé seule = vert, autorisé = orange */
function Sshd({ m, what }: { m: Machine; what: "root" | "pwd" }) {
  if (!m.ssh) return <Dim>-</Dim>;
  const sd = m.info?.sshd || {};
  const v = what === "root" ? sd.permitrootlogin
    : m.ssh.methods ? (m.ssh.methods.some((x) => x === "password" || x === "keyboard-interactive") ? "yes" : "no") : sd.passwordauthentication;
  if (!v) return <Dim>-</Dim>;
  const k = v.split(" ")[0];
  if (k === "yes") return <Mark tone="warn" title={what === "root" ? tx("root peut se connecter en SSH") : tx("sshd accepte le mot de passe")}>⚠</Mark>;
  if (/prohibit-password|without-password/.test(k)) return <Mark tone="ok" title={tx("Par clé uniquement")}>🔑</Mark>;
  return <Mark tone="ok" title={what === "root" ? tx("root refusé en SSH") : tx("mot de passe refusé : clé seulement")}>✓</Mark>;
}

/** Colonnes santé de la v1 : disque le plus rempli, services systemd en échec, mises à jour et redémarrage */
export function DiskCell({ h }: { h?: HealthHost }) {
  const d = topDisk(h);
  if (!d) return <Dim>-</Dim>;
  return <span title={tx("Disque le plus rempli")}><b className={d.critical || d.used_pct >= 90 ? "text-bad" : d.warning || d.used_pct >= 80 ? "text-warn" : "text-ok"}>{d.used_pct} %</b> <code className="text-xs">{d.mount}</code></span>;
}
export function ResCell({ h, what }: { h?: HealthHost; what: "cpu" | "mem" }) {
  const v = what === "cpu" ? h?.res?.cpu_pct : h?.res?.mem_pct;
  if (!h?.res?.available || v == null) return <Dim>-</Dim>;
  const tone = what === "mem" && v >= 97 ? "text-bad" : (what === "mem" && v >= 90) || (what === "cpu" && v >= 90) ? "text-warn" : "text-ok";
  return <b className={tone} title={what === "mem" && h.res?.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} Go` : undefined}>{Math.round(v)} %</b>;
}
export function SystemdCell({ h }: { h?: HealthHost }) {
  if (!h) return <Dim>-</Dim>;
  const f = h.systemd?.failed || [];
  return f.length ? <Mark tone="bad" title={f.map((u) => u.unit).join(", ")}>{String(f.length)}</Mark> : <Mark tone="ok" title={tx("Aucun service en échec")}>✓</Mark>;
}
export function UpdatesCell({ h }: { h?: HealthHost }) {
  if (!h) return <Dim>-</Dim>;
  const n = h.apt?.upgradable || 0;
  return (
    <span className="inline-flex items-center gap-1">
      {n ? <Mark tone="warn" title={tx("{0} paquet(s) à mettre à jour", n)}>{String(n)}</Mark> : <Mark tone="ok" title={tx("À jour")}>✓</Mark>}
      {h.reboot_required && <Mark tone="warn" title={tx("Redémarrage requis")}>↻</Mark>}
    </span>
  );
}

/** Compact cards: a strip of small figures (label on top, value under), shared by the Machines and Health cards */
export function Stat({ label, children, title }: Readonly<{ label: string; children: React.ReactNode; title?: string }>) {
  return (
    <div className="flex min-w-0 flex-col items-center px-1" title={title}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-dim">{label}</span>
      <span className="truncate text-sm tabular-nums">{children}</span>
    </div>
  );
}
/** Colour of a disk filling: red from 90 % (or the health check's critical), orange from 80 % (or its warning) */
function diskTone(d: { critical?: boolean; warning?: boolean; used_pct: number }): string {
  if (d.critical || d.used_pct >= 90) return "text-bad";
  if (d.warning || d.used_pct >= 80) return "text-warn";
  return "text-ok";
}
function DiskPct({ h }: Readonly<{ h?: HealthHost }>) {
  const d = topDisk(h);
  if (!d) return <Dim>-</Dim>;
  return <b className={diskTone(d)}>{d.used_pct} %</b>;
}
/** CPU, memory and fullest disk in one strip; `first`: one more figure on the left (services on a machine card) */
export function ResStrip({ h, first }: Readonly<{ h?: HealthHost; first?: React.ReactNode }>) {
  const d = topDisk(h);
  return (
    <div className={`grid ${first ? "grid-cols-4" : "grid-cols-3"} divide-x divide-line/60 rounded-lg bg-bg2/50 py-1.5`}>
      {first}
      <Stat label={tx("CPU")}><ResCell h={h} what="cpu" /></Stat>
      <Stat label={tx("Mém.")} title={tx("Mémoire")}><ResCell h={h} what="mem" /></Stat>
      <Stat label={tx("Disque")} title={d ? tx("Disque le plus rempli : {0}", d.mount) : undefined}><DiskPct h={h} /></Stat>
    </div>
  );
}

const LEVEL_EDGE: Record<string, string> = { crit: "border-l-bad", down: "border-l-bad", warn: "border-l-warn" };
/** Health level of a machine for its card edge: « down » when unreachable, "" when health is not read */
const levelKey = (h?: HealthHost): string => (h?.reachable === false ? "down" : h?.level ?? "");

const WATCH_ICON: Record<WatchKind, LucideIcon> = {
  down: WifiOff, ssh: KeyRound, disk: HardDrive, systemd: ServerCrash, docker: Container, kernel: Bug, smart: ScanSearch, load: Gauge, ssh_auth: ShieldAlert,
  mem: MemoryStick, temp: Thermometer, reboot: RotateCw, updates: ArrowUpCircle, services: Globe, connector: Plug, access: Unplug,
};
const WATCH_STYLE: Record<WatchTone, string> = { bad: "border-bad/60 bg-bad/15 text-bad", warn: "border-warn/60 bg-warn/15 text-warn", info: "border-link/50 bg-link/10 text-link" };

/** « À surveiller » : une pastille-icône par sujet, rouge (grave), orange (à regarder) ou bleue (à savoir) ; le détail est dans l'info-bulle. Rien : une coche discrète. */
function WatchList({ items, wrap = false }: { items: WatchItem[]; wrap?: boolean }) {   // wrap : libellé « Rien à surveiller » écrit en toutes lettres (fiches)
  if (!items.length) return <span className="inline-flex items-center gap-1 text-xs text-ok" title={tx("Rien à surveiller")}><Check size={14} aria-hidden />{wrap && tx("Rien à surveiller")}</span>;
  return (
    <div className="flex flex-wrap items-center gap-1" role="list" aria-label={tx("À surveiller")}>   {/* tout est montré, jamais caché : les pastilles passent à la ligne */}
      {items.map((it, i) => {
        const Icon = WATCH_ICON[it.kind];
        return <span key={i} role="listitem" tabIndex={0} title={it.text} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border ${WATCH_STYLE[it.tone]}`}><Icon size={14} aria-hidden /></span>;
      })}
    </div>
  );
}

/** Synthèse de « À surveiller », dépliable : une ligne par sujet avec son icône, sa couleur et sa phrase complète (repliée : le nombre par gravité) */
function WatchSummary({ items }: { items: WatchItem[] }) {
  const count = (t: WatchTone) => items.filter((i) => i.tone === t).length;
  return (
    <details open={worst(items) >= 2} className="group rounded-lg border border-line/60 bg-card/60 p-3 text-xs sm:col-span-2 xl:col-span-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-dim [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden /><Eye size={13} aria-hidden />{tx("À surveiller")}
        <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
          {items.length === 0 ? <Badge tone="ok">{tx("rien")}</Badge> : (["bad", "warn", "info"] as WatchTone[]).filter(count).map((t) => <Badge key={t} tone={t === "info" ? "info" : t}>{count(t)}</Badge>)}
        </span>
      </summary>
      {items.length === 0 ? <p className="mt-2 text-ok">{tx("Rien à surveiller sur cette machine.")}</p> : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((it, i) => {
            const Icon = WATCH_ICON[it.kind];
            return <li key={i} className="flex items-start gap-2"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${WATCH_STYLE[it.tone]}`}><Icon size={13} aria-hidden /></span><span className="min-w-0 flex-1 pt-0.5 text-muted">{it.text}</span></li>;
          })}
        </ul>
      )}
    </details>
  );
}

/** Accès SSH comme dans la première version, sur une ligne : logo, pastilles compte, IP et port ; l'alias, la note et les alertes sont dans le détail déplié */
function SshShort({ m }: { m: Machine }) {
  if (!m.ssh) return <Dim>{m.local ? tx("local") : "-"}</Dim>;
  return <SshAccess noAlias alias={m.ssh.alias} user={m.ssh.user} ip={m.ip} port={m.ssh.port} refused={!m.info && !!m.ssh.identity} />;
}

/** Système sur une ligne : logo de la distribution (ou icône de la famille) puis le nom, coupé, entier au survol */
function OsShort({ m, kind }: { m: Machine; kind: OsKind | null }) {
  const os = m.info?.os || m.agent?.os;
  if (!os && !kind) return <Dim>-</Dim>;
  return <span className="inline-flex max-w-[11rem] items-center gap-1.5" title={os || (kind ? OS_LABEL[kind] : "")}>{kind && <OsGlyph kind={kind} name={os} />}<span className="truncate">{shortOs(os) || (kind ? OS_LABEL[kind] : "")}</span></span>;
}

/** Origine d'une donnée : le connecteur ou la source qui l'a lue (rouge si en panne) */
export interface Origin { label: string; ok?: boolean; tip?: string; href?: string }  // href : où régler cette source (Réglages)

/** D'où viennent les données de la machine : SSH, agent, recherche réseau, MynetworK, Beszel et connecteurs visant son IP */
function originsOf(m: Machine, snap: Snapshot, h: HealthHost | undefined, scanned: boolean, seen: boolean) {
  const linked = (types: string[]): Origin[] => (snap.data.connectors ?? []).filter((c) => c.ip === m.ip && types.includes(c.type))
    .map((c) => ({ label: c.type === "docker" ? "Docker (SSH)" : c.type === "process" ? tx("Ports (SSH)") : "AdGuard Home", ok: c.ok, tip: `${c.name} : ${c.message}`, href: `#settings/machines/${m.ip}` }));
  const here = `#settings/machines/${m.ip}`, connectors = "#settings/connectors";
  const health: Origin[] = (h?.sources ?? []).map((x) => ({ label: x === "ssh" ? "SSH" : x === "agent" ? tx("agent MyServices") : x === "beszel" ? "Beszel" : x === "ha" ? "Home Assistant" : x,
    href: x === "agent" ? `#settings/agents/${m.ip}` : x === "beszel" || x === "ha" ? connectors : here }));
  return {
    role: [{ label: tx("Réglages → Machines"), href: here }] as Origin[],
    mac: seen ? [{ label: "MynetworK", href: connectors }] : [],
    ssh: m.ssh ? [{ label: tx("alias SSH de MyServices"), href: here }] : [],
    os: m.info?.os ? [{ label: "SSH", href: here }] : m.agent ? [{ label: tx("agent MyServices"), href: `#settings/agents/${m.ip}` }] : scanned ? [{ label: tx("recherche réseau"), href: "#settings/network" }] : [],
    services: [...(m.npm ? [{ label: "NPM", href: connectors }] : []), ...linked(["docker", "process", "adguard"]),
               ...(m.api ?? []).map((a) => ({ label: a.label, ok: a.ok || !!a.stale, tip: `${a.name} : ${a.message ?? ""}`, href: connectors }))],
    health,
  };
}

function From({ list }: { list: Origin[] }) {
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px] font-normal normal-case tracking-normal text-dim">
      {tx("source")} : {list.map((o) => {
        const badge = <Badge tone={o.ok === false ? "bad" : "info"} title={o.tip ?? (o.href ? tx("Ouvrir les réglages de cette source") : undefined)}>{o.label}</Badge>;
        return o.href ? <a key={o.label} href={o.href} className="rounded-md outline-offset-2 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-link">{badge}</a> : <span key={o.label}>{badge}</span>;
      })}
    </span>
  );
}

const HOW: Record<string, string> = { ip: tx("reliée par son adresse IP"), mac: tx("reliée par son adresse MAC"), name: tx("reliée par son nom (à vérifier)") };

/** Matching layer: one badge per tool that sees the machine ; a name match is dashed (weaker than an address) */
function SeenBy({ links }: { links?: MachineLinks | null }) {
  const list = links?.sources ?? [];
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((x) => (
        <span key={`${x.source}/${x.instance}`} title={`${x.label}${x.instance ? ` (${x.instance})` : ""} : ${HOW[x.by]}${x.ok ? "" : ` · ${tx("hors ligne")}`}`}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border bg-bg2 px-1.5 py-0.5 text-[11px] font-semibold ${x.ok ? "text-muted" : "text-bad"} ${x.by === "name" ? "border-dashed border-txt/30" : "border-line"}`}>
          {x.label}{x.vmid != null ? ` · ${x.vmid}` : ""}
        </span>
      ))}
    </span>
  );
}

/** Names the other tools give the machine, minus its own (« dev.lan » is not another name for « dev ») */
const otherNames = (m: Machine) => (m.links?.names ?? []).filter((n) => n.split(".")[0].toLowerCase() !== m.name.toLowerCase());

/** « VM 101 sur pve » / « nœud Proxmox pve » */
function Virt({ links }: { links?: MachineLinks | null }) {
  const g = links?.guest, n = links?.hypervisor;
  if (g) return <>{g.type === "lxc" ? tx("conteneur LXC") : "VM"} {g.vmid} {tx("sur")} <b>{g.node}</b>{g.status && g.status !== "running" && <Dim> · {g.status}</Dim>}</>;
  if (n) return <>{n.source === "proxmox" || !n.source ? tx("nœud Proxmox") : tx("hôte VMware ESXi")} <b>{n.node}</b></>;
  return null;
}


/** Rubrique du détail, avec d'où viennent ses données à droite de la bande de titre */
function Section({ icon, title, tone, from, children }: { icon: typeof Info; title: string; tone: "link" | "violet" | "ok" | "warn" | "bad"; from?: Origin[]; children: React.ReactNode }) {
  return <DetailSection icon={icon} title={title} tone={tone} right={from?.length ? <From list={from} /> : undefined}>{children}</DetailSection>;
}
const Row = DetailRow;

/** Disques, processeur et mémoire de la dernière santé, en barres */
function HealthRows({ h }: { h: HealthHost }) {
  const bar = (label: string, pct: number | undefined, tone: "ok" | "warn" | "bad", extra?: string) => pct == null ? null : (
    <DetailRow key={label} k={label} title={label}><Fill pct={pct} tone={tone} /><span className="tabular-nums">{Math.round(pct)} %</span>{extra && <Dim>{extra}</Dim>}</DetailRow>
  );
  return (
    <>
      {h.res?.available && bar(tx("CPU"), h.res.cpu_pct, (h.res.cpu_pct ?? 0) >= 90 ? "warn" : "ok")}
      {h.res?.available && bar(tx("Mémoire"), h.res.mem_pct, (h.res.mem_pct ?? 0) >= 97 ? "bad" : (h.res.mem_pct ?? 0) >= 90 ? "warn" : "ok",
        h.res.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} ${tx("Go")}` : undefined)}
      {(h.disks || []).filter((d) => (d.size_gb ?? 1) >= 1).map((d) => bar(d.mount, d.used_pct, d.critical ? "bad" : d.warning ? "warn" : "ok", d.avail_gb != null ? `${d.avail_gb.toFixed(0)} ${tx("Go libres")}` : undefined))}
    </>
  );
}

/** Ligne dépliée à la demande : cinq rubriques (identité, système, accès, logiciels, santé), chacune avec l'origine de ses données */
function Detail({ m, h, mac, net, from, watch, servers, ha, onServices }: Readonly<{ m: Machine; h?: HealthHost; mac?: string; net?: NetDevice; from: ReturnType<typeof originsOf>; watch: WatchItem[]; servers?: React.ReactNode; ha?: ServiceStatus; onServices: () => void }>) {
  const i = m.info, hw = hardwareRows(m.agent?.hardware);
  return (
    <div className="grid gap-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-3">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 xl:col-span-3">
        <span className="text-sm text-muted">{tx("{0} service(s) sur cette machine", m.services)}{m.down > 0 && <span className="text-bad"> · {tx("{0} en panne", m.down)}</span>}</span>
        <button type="button" onClick={onServices} className={`${quiet} py-1 text-sm`}>{tx("Voir ses services")}<ArrowRight size={14} aria-hidden /></button>
      </div>
      <WatchSummary items={watch} />
      <IdentitySection m={m} mac={mac} net={net} from={[...from.role, ...from.mac]} />

      <Section icon={Cpu} title={tx("Système")} tone="violet" from={from.os}>
        <Row k={tx("Système")}>{i?.os || m.agent?.os || undefined}</Row>
        <Row k={tx("Noyau")}>{i?.kernel || m.agent?.kernel || undefined}</Row>
        <Row k={tx("En marche")}>{(i?.uptime_s ?? m.agent?.uptime_s) ? dur(i?.uptime_s ?? m.agent?.uptime_s) : undefined}</Row>
        {hw.map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}
        {!i && !m.agent && <Dim>-</Dim>}
      </Section>

      <AccessSection m={m} from={from.ssh} />

      <SoftwareSection m={m} servers={servers} ha={ha} from={from.services} />

      <HealthSection h={h} from={from.health} />
    </div>
  );
}

/** Detail, « Identity »: name, IP, state, roles, MAC, what the network tools saw, other names, virtualization */
function IdentitySection({ m, mac, net, from }: Readonly<{ m: Machine; mac?: string; net?: NetDevice; from: Origin[] }>) {
  const roles = rolesOf(m.role);
  const [stTone, stLabel, stTip] = MSTATE[mState(m)];
  return (
      <Section icon={IdCard} title={tx("Identité")} tone="link" from={from}>
        <Row k={tx("Nom")}><b>{m.name}</b></Row>
        <Row k="IP"><span className="font-mono">{m.ip}</span></Row>
        <Row k={tx("État")}><Badge tone={stTone} title={stTip}>{stLabel}</Badge></Row>
        <Row k={tx("Rôle")}>{roles.length ? <span className="flex flex-wrap gap-1">{roles.map((t) => <Badge key={t} tone="off">{t}</Badge>)}</span> : undefined}</Row>
        <Row k="MAC">{mac && <span className="font-mono">{mac}</span>}</Row>
        <Row k={tx("Ports ouverts")}>{net?.ports.length ? <span className="font-mono" title={tx("Vus par le scanner de MynetworK")}>{net.ports.join(", ")}</span> : undefined}</Row>
        <Row k={tx("Sur le réseau")}>{net?.first_seen ? <span title={tx("Vue par MynetworK")}>{tx("depuis le {0}", dateTime(net.first_seen))}{net.last_seen && <Dim> · {tx("vue le {0}", dateTime(net.last_seen))}</Dim>}{net.ping_ms != null && <Dim> · {Math.round(net.ping_ms)} ms</Dim>}</span> : undefined}</Row>
        <Row k={tx("Autres noms")}>{otherNames(m).join(", ") || undefined}</Row>
        <Row k={tx("Virtualisation")}>{m.links?.guest || m.links?.hypervisor ? <Virt links={m.links} /> : undefined}</Row>
        <Row k={tx("Vue par")}>{m.links?.sources.length ? <SeenBy links={m.links} /> : undefined}</Row>
        <Row k="TTL">{m.ttl ? <span title={tx("Durée de vie des paquets du ping : 64 Linux, 128 Windows")}>{m.ttl}</span> : undefined}</Row>
      </Section>
  );
}

/** Detail, « Access »: SSH (account, key, host security) or the Windows agent */
function AccessSection({ m, from }: Readonly<{ m: Machine; from: Origin[] }>) {
  const i = m.info, s = m.ssh;
  return (
      <Section icon={KeyRound} title={tx("Accès")} tone="ok" from={from}>
        {s ? <>
          <Row k={tx("Connexion")}><SshAccess alias={s.alias} user={s.user} ip={m.ip} port={s.port} refused={!i && !!s.identity} /></Row>
          <Row k={tx("Clé")}><KeyCell m={m} /></Row>
          <Row k={tx("Note")}>{s.note ?? undefined}</Row>
          <Row k={tx("Sécurité")}>
            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><HostKey m={m} />{tx("clé d'hôte")}</span>
              <span className="inline-flex items-center gap-1"><Sshd m={m} what="root" />root</span>
              <span className="inline-flex items-center gap-1"><Sshd m={m} what="pwd" />{tx("mot de passe")}</span>
            </span>
          </Row>
        </> : <Row k={tx("SSH")}>{m.local ? tx("local") : <Dim>{tx("pas d'accès SSH configuré")}</Dim>}</Row>}
        {m.agent && <Row k={tx("Agent")}>{tx("relevé par l'agent MyServices")}</Row>}
      </Section>
  );
}

/** Detail, « Software and services »: servers, services, Docker, linked APIs, Home Assistant add-ons, Apache and nginx */
function SoftwareSection({ m, servers, ha, from }: Readonly<{ m: Machine; servers?: React.ReactNode; ha?: ServiceStatus; from: Origin[] }>) {
  const i = m.info;
  const vhosts = (i?.vhosts ?? []) as { port?: number; names?: string[] }[];
  return (
      <Section icon={Boxes} title={tx("Logiciels et services")} tone="warn" from={from}>
        <Row k={tx("Serveurs")}>{servers}</Row>
        <Row k={tx("Services")}>{m.services}{m.npm > 0 && <Dim> · {m.npm} NPM</Dim>}{m.down > 0 && <span className="text-bad"> · {m.down} {tx("en panne")}</span>}</Row>
        <Row k="Docker">{i?.docker ? tx("{0} conteneur(s) en cours", i.docker) : m.agent?.docker != null ? (m.agent.docker ? tx("{0} conteneur(s) (lus par l'agent)", m.agent.docker) : <Dim>{tx("aucun conteneur")}</Dim>) : i?.docker_installed === false ? <Dim>{tx("absent")}</Dim> : undefined}</Row>
        <Row k="API">{m.api?.length ? <span className="flex flex-wrap gap-1">{m.api.map((a) => <Badge key={`${a.type}/${a.name}`} tone={a.ok ? "ok" : a.stale ? "warn" : "bad"} title={`${a.name} : ${a.message ?? ""}`}>{a.label}{a.version ? ` ${a.version}` : ""}</Badge>)}</span> : undefined}</Row>
        {ha?.addons?.length ? <div className="py-1"><HaAddons s={ha} /></div> : null}
        <Row k={tx("Applis")}>{m.agent?.apps?.length ? <span className="flex flex-wrap gap-1">{m.agent.apps.map((a) => <Badge key={a.key} tone="info" title={tx("Vue par les services Windows du PC")}>{a.label}</Badge>)}</span> : undefined}</Row>
        <Row k="Apache">{i?.apache ? <>{tx("{0} vhost(s)", vhosts.length)}{!!i.vhosts_unreadable?.length && <span className="text-warn"> · {i.vhosts_unreadable.length} {tx("illisible(s)")}</span>}</> : undefined}</Row>
        {i?.apache && vhosts.slice(0, 6).map((v, n) => <Row key={n} k=""><span className="font-mono text-[11px] text-muted">:{v.port} {(v.names ?? []).join(", ") || "-"}</span></Row>)}
        <Row k="nginx">{i?.nginx ? tx("actif sur la machine (hors conteneur)") : undefined}</Row>
        {!m.services && !i?.docker && !i?.apache && !i?.nginx && !m.agent?.docker && !m.agent?.apps?.length && !m.api?.length && <Dim>-</Dim>}
      </Section>
  );
}

/** Detail, « Health »: level, resources, failed systemd units, updates */
function HealthSection({ h, from }: Readonly<{ h?: HealthHost; from: Origin[] }>) {
  const failed = h?.systemd?.failed.length || 0, apt = h?.apt?.upgradable || 0;
  return (
      <Section icon={HeartPulse} title={tx("Santé")} tone="bad" from={from}>
        {h ? <>
          <Row k={tx("Niveau")}><Level level={h.reachable === false ? "down" : h.level} /></Row>
          <HealthRows h={h} />
          <Row k="Systemd">{failed ? <span className="text-bad">{tx("{0} service(s) en échec", failed)}</span> : undefined}</Row>
          <Row k={tx("Mises à jour")}>{apt ? tx("{0} paquet(s) à mettre à jour", apt) : undefined}{h.reboot_required && <span className="text-warn"> · {tx("redémarrage requis")}</span>}</Row>
        </> : <Dim>{tx("non suivie")}</Dim>}
      </Section>
  );
}

/** Compact machine card: who, state, system, figures, servers and what to watch; « Details » unfolds the same detail as the table,
 *  the card then taking the whole row. A Home Assistant machine shows its add-on icons. */
function MachineCard({ m, h, snap, scan, os, watch, ha, off, state, shown, onToggle, onMachine, detail }: Readonly<{
  m: Machine; h?: HealthHost; snap: Snapshot; scan?: { os?: string; apps: string[]; ssh?: boolean }; os: OsKind | null; watch: WatchItem[]; ha?: ServiceStatus;
  off: boolean; state: React.ReactNode; shown: boolean; onToggle: () => void; onMachine: (ip: string) => void; detail: React.ReactNode;
}>) {
  const up = m.info?.uptime_s ?? m.agent?.uptime_s;
  const edge = LEVEL_EDGE[levelKey(h)] ?? "";
  return (
    <div className={`flex flex-col gap-2.5 overflow-hidden rounded-xl border border-l-[3px] border-line bg-card p-3 transition-colors hover:border-link/50 ${edge} ${shown ? "col-span-full" : ""} ${off ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2.5">
        <MachineIcon m={m} scan={scan} reserve />
        <button type="button" onClick={() => onMachine(m.ip)} className="min-w-0 flex-1 text-left" title={tx("Voir ses services")}>
          <b className="block truncate font-semibold hover:text-link">{m.name}</b>
          <span className="block truncate font-mono text-[11px] text-dim">{m.ip}</span>
        </button>
        {state}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <OsShort m={m} kind={os} />
        {up ? <span className="shrink-0 text-dim">· {tx("up")} {dur(up)}</span> : null}
        {rolesOf(m.role).slice(0, 1).map((t) => <span key={t} className="ml-auto min-w-0 truncate rounded border border-line px-1.5 py-px text-[11px] text-dim" title={m.role}>{t}</span>)}
      </div>
      <ResStrip h={h} first={<Stat label={tx("Services")} title={m.down ? tx("{0} en panne", m.down) : undefined}><b>{m.services}</b>{m.down > 0 && <span className="text-xs text-bad"> ·{m.down}</span>}</Stat>} />
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Servers m={m} snap={snap} max={4} />
        <WatchList items={watch} />
      </div>
      {ha && <AddonStrip s={ha} max={8} />}
      <button type="button" onClick={onToggle} aria-expanded={shown} className="flex items-center gap-1.5 border-t border-line/60 pt-2 text-xs text-muted hover:text-txt">
        <ChevronRight size={13} className={`transition-transform ${shown ? "rotate-90" : ""}`} aria-hidden />{shown ? tx("Replier") : tx("Détails")}
      </button>
      {shown && <div className="-mx-3 -mb-3 border-t border-line/60 bg-bg2/40">{detail}</div>}
    </div>
  );
}

export function Machines({ snap, onMachine, initial }: { snap: Snapshot; onMachine: (ip: string) => void; initial?: Selected }) {
  const hb = useMemo(() => healthByIp(snap.health?.hosts), [snap.health]);
  // Système et applis vus par le dernier scan du réseau, pour les machines que le SSH ne renseigne pas
  const [scanOs, setScanOs] = useState<Record<string, { os?: string; apps: string[]; ssh?: boolean }>>({});
  useEffect(() => { read<NetScan>("network/scan").then((n) => setScanOs(Object.fromEntries((n.found || []).map((h) => [h.ip, { os: h.os ?? undefined, apps: h.apps ?? [], ssh: !!h.ssh_port }])))).catch(() => undefined); }, []);
  const osOf = useCallback((m: Machine): OsKind | null => osOfMachine({ os: m.agent ? "windows" : undefined, info: m.info, ttl: m.ttl, name: m.name }, scanOs[m.ip]?.os, scanOs[m.ip]?.ssh)?.kind ?? null, [scanOs]);
  const facets = useMemo((): Facet<Machine>[] => [
    { key: "state", label: tx("État"), get: mState, name: (v) => MSTATE[v as MState][1], order: ORDER, mark: (v) => <Dot tone={MSTATE[v as MState][0]} /> },
    { key: "health", label: tx("Santé"), get: (m) => { const h = hb.get(m.ip); return h ? (h.reachable === false ? "down" : h.level) : ""; },
      name: (v) => ({ ok: "OK", warn: tx("à surveiller"), crit: "critique", down: "injoignable" } as Record<string, string>)[v] || v, order: ["ok", "warn", "crit", "down"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
    { key: "os", label: tx("Système"), get: (m) => osOf(m) ?? "", name: (v) => OS_LABEL[v as OsKind], order: OS_ORDER, mark: (v) => <OsGlyph kind={v as OsKind} size={13} /> },
    { key: "access", label: tx("Accès"), get: (m) => (m.ssh ? "ssh" : m.agent ? "agent" : "none"), name: (v) => ({ ssh: "SSH", agent: tx("Agent"), none: tx("aucun") } as Record<string, string>)[v], order: ["ssh", "agent", "none"],
      mark: (v) => <Dot tone={v === "none" ? "off" : "ok"} /> },
    { key: "role", label: tx("Rôle"), get: (m) => rolesOf(m.role) },
    { key: "user", label: tx("Compte SSH"), get: (m) => m.ssh?.user || "" },
  ], [hb, osOf]);
  const text = useCallback((m: Machine) => [m.name, m.ip, m.role, MSTATE[mState(m)][1], m.ssh?.alias, m.ssh?.user, m.info?.os].join(" "), []);
  // « Ne plus suivre » se règle uniquement dans Réglages → Machines (interrupteur « Machine suivie ») ; ici, les machines non suivies restent masquées d'office.
  const isOff = (m: Machine) => !!m.disabled;
  // Machines non suivies : masquées d'office, un bouton les ramène (grisées)
  const [showOff, setShowOff] = useState(false);
  const nOff = snap.data.machine_list.filter(isOff).length;
  const items = useMemo(() => (showOff ? snap.data.machine_list : snap.data.machine_list.filter((m) => !isOff(m))), [snap.data.machine_list, showOff, isOff]);
  const f = useFilter(items, facets, text, initial);
  const keyOf = useCallback((m: Machine, k: string): string | number => {
    switch (k) {
      case "state": return ORDER.indexOf(mState(m));
      case "os": return m.info?.os || "~";
      case "svc": return -m.services;
      case "health": return -(topDisk(hb.get(m.ip))?.used_pct ?? -1);
      case "watch": { const it = watchItems(m, hb.get(m.ip), snap.data.connectors ?? []); return -(worst(it) * 100 + it.length); }   // le plus grave d'abord
      default: return ipNum(m.ip);
    }
  }, [hb, snap.data.connectors]);
  const sort = useSort(f.shown, keyOf, "ip");
  // Home Assistant running on this machine (its address points here): its add-ons in the unfolded detail
  const haOf = (m: Machine) => (snap.data.services_status ?? []).find((c) => c.connector === "home-assistant" && c.url && new URL(c.url).hostname === m.ip);
  const watchOf = (m: Machine) => watchItems(m, hb.get(m.ip), snap.data.connectors ?? []);
  // Tableau sur une seule ligne par machine ; un clic sur le chevron (ou « Tout déplier ») montre le détail
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (ip: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(ip)) n.add(ip); return n; });
  const [view, pickView] = useStoredView("ms.machines.view", "table");  // Tableau ou Cartes, retenu

  // Inventaire de MynetworK (connecteur « network ») : MAC et fabricant sous l'IP, et les appareils vus mais pas suivis
  const seen = useMemo(() => new Map((snap.data.network ?? []).flatMap((c) => c.devices ?? []).map((d) => [d.ip, d])), [snap.data.network]);
  // Seen by a tool but not followed here: the matching layer's list (all tools), or MynetworK alone for an older data.json
  const untracked: Unlinked[] = useMemo(() => snap.data.unlinked
    ?? [...seen.values()].filter((d) => !snap.data.machine_list.some((m) => m.ip === d.ip))
      .map((d) => ({ source: "mynetwork", label: "MynetworK", instance: "", ip: d.ip, mac: d.mac ?? undefined, name: d.hostname || d.vendor || undefined, online: d.status === "online" })),
  [seen, snap.data.unlinked, snap.data.machine_list]);
  const bySource = useMemo(() => {
    const g = new Map<string, Unlinked[]>();
    for (const u of untracked) g.set(u.label, [...(g.get(u.label) ?? []), u]);
    for (const l of g.values()) l.sort((a, b) => (a.ip && b.ip ? ipNum(a.ip) - ipNum(b.ip) : (a.name ?? "").localeCompare(b.name ?? "")));
    return [...g.entries()];
  }, [untracked]);
  // « Suivre » an untracked device: added like a machine found by the network search, then read and checked (admin only)
  const [following, setFollowing] = useState<Record<string, "busy" | "done" | string>>({});
  const follow = async (d: Unlinked) => {
    if (!d.ip) return;
    const ip = d.ip;
    setFollowing((f) => ({ ...f, [ip]: "busy" }));
    try {
      await send("PUT", `machines/settings/${ip}`, { machine: { name: (d.name || ip).slice(0, 60), role: "" }, extra: [] });
      setFollowing((f) => ({ ...f, [ip]: "done" }));
      await rereadMachines([ip]).catch(() => undefined);
    } catch (e) {
      if (e instanceof LoginRequired) location.replace(LOGIN);
      else setFollowing((f) => ({ ...f, [ip]: (e as Error).message }));
    }
  };
  const macOf = (m: Machine) => { const d = seen.get(m.ip); const mac = d?.mac || m.links?.mac, vendor = d?.vendor || m.links?.vendor; return mac || vendor ? [mac, vendor].filter(Boolean).join(" · ") : undefined; };
  const st = (m: Machine) => { const [tone, label, tip] = MSTATE[mState(m)]; return <Badge tone={tone} title={tip}>{label}</Badge>; };

  return (
    <div className="py-1">
      <FilterBar f={f} placeholder={tx("Nom, IP, rôle, système, compte SSH…")}
        options={nOff > 0 ? [{ id: "off", label: tx("Désactivées"), on: showOff, toggle: () => setShowOff(!showOff), mark: showOff ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />, count: nOff }] : []}
        extra={<>
          <ViewToggle view={view} onPick={pickView} />
        </>} />
      {untracked.length > 0 && (
        <details className="mb-3 rounded-xl border border-line bg-bg2/40 px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted hover:text-txt">{tx("Vus par vos outils, pas suivis ici")} <b className="text-dim">({untracked.length})</b></summary>
          {bySource.map(([label, list]) => (
            <div key={label} className="mt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">{label} <span className="font-normal">({list.length})</span></h4>
              <ul className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                {list.slice(0, 120).map((d, n) => (
                  <li key={`${d.ip ?? d.name}-${n}`} className="flex min-w-0 items-baseline gap-2 whitespace-nowrap" title={[d.ip, d.name, d.mac].filter(Boolean).join(" · ")}>
                    {d.online != null && <Badge tone={d.online ? "ok" : "off"}>{d.online ? tx("en ligne") : tx("hors ligne")}</Badge>}
                    {d.ip && <span className="shrink-0 font-mono text-xs">{d.ip}</span>}<span className="min-w-0 truncate">{d.name ?? ""}</span>
                    {d.vmid != null && <Dim>{d.type === "lxc" ? "LXC" : "VM"} {d.vmid}{d.node ? ` · ${d.node}` : ""}</Dim>}
                    {d.mac && <span className="hidden shrink-0 font-mono text-[11px] text-dim 2xl:inline">{d.mac}</span>}
                    {d.ip && (following[d.ip] === "done" ? <Badge tone="ok">{tx("suivie")}</Badge>
                      : <button type="button" className={`${quiet} ml-auto shrink-0 px-2 py-0.5 text-xs`} disabled={following[d.ip] === "busy"} onClick={() => void follow(d)}
                          title={following[d.ip] && following[d.ip] !== "busy" ? following[d.ip] : tx("Ajouter aux machines suivies (relevé et santé lancés)")}>
                          <Plus size={12} aria-hidden />{following[d.ip] && following[d.ip] !== "busy" ? <span className="text-bad">{tx("refusé")}</span> : tx("Suivre")}</button>)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-2 text-xs text-dim">{tx("« Suivre » l'ajoute aux machines (son accès SSH se règle ensuite dans Réglages → Machines).")}</p>
        </details>
      )}
      {sort.sorted.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <>
          {view === "table" && <Table fit head={<>
            <th className="w-8 px-1" aria-label={tx("Détails")} /><th className="w-10 px-2" aria-label={tx("Icône")} /><Th k="ip" sort={sort}>{tx("Machine")}</Th><Th k="state" sort={sort}>{tx("État")}</Th><Th k="watch" sort={sort}>{tx("À surveiller")}</Th><Th>{tx("SSH")}</Th><Th k="os" sort={sort}>{tx("Système")}</Th>
            <Th>{tx("Serveurs")}</Th><Th k="svc" sort={sort}>{tx("Services")}</Th>{snap.health && <><Th k="health" sort={sort}>{tx("Santé")}</Th><Th>{tx("CPU")}</Th><Th>{tx("Mémoire")}</Th><Th>{tx("Disque")}</Th><Th>{tx("Systemd")}</Th><Th>{tx("Mises à jour")}</Th></>}
          </>}>
            {sort.sorted.map((m) => {
              const shown = open.has(m.ip), h = hb.get(m.ip), cols = 9 + (snap.health ? 6 : 0);
              return (
                <Fragment key={m.ip}>
                  <tr className={`${shown ? OPEN_ROW : "hover:bg-bg2/60"} ${isOff(m) ? "opacity-50" : ""}`}>
                    <td className="w-8 px-1 py-2 align-middle">
                      <button type="button" onClick={() => toggleOpen(m.ip)} aria-expanded={shown} aria-label={tx("Détails de {0}", m.name)} title={shown ? tx("Replier") : tx("Déplier le détail")}
                        className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt">{shown ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                    </td>
                    <td className="w-10 px-2 py-2 align-middle"><MachineIcon m={m} scan={scanOs[m.ip]} reserve /></td>
                    <Td><button type="button" onClick={() => onMachine(m.ip)} className="flex items-baseline gap-2 text-left" title={tx("Voir ses services")}>
                      <b className="font-semibold hover:text-link">{m.name}</b><span className="text-xs text-dim">{m.ip}</span></button></Td>   {/* the tools that see it (can be many): in the unfolded detail only */}
                    <Td>{st(m)}</Td><Td><WatchList items={watchOf(m)} /></Td><Td><SshShort m={m} /></Td>
                    <Td><OsShort m={m} kind={osOf(m)} /></Td><Td><Servers m={m} snap={snap} max={2} /></Td>
                    <Td><b>{m.services}</b>{m.down > 0 && <span className="text-xs text-bad"> · {m.down} {tx("en panne")}</span>}</Td>
                    {snap.health && <><Td><Level level={h ? (h.reachable === false ? "down" : h.level) : "na"} /></Td>
                      <Td><ResCell h={h} what="cpu" /></Td><Td><ResCell h={h} what="mem" /></Td><Td><DiskCell h={h} /></Td><Td><SystemdCell h={h} /></Td><Td><UpdatesCell h={h} /></Td></>}
                    
                  </tr>
                  {shown && <tr className={`bg-bg2/40 ${OPEN_DETAIL} ${isOff(m) ? "opacity-50" : ""}`}><td colSpan={cols} className="p-0"><Detail m={m} h={h} watch={watchOf(m)} mac={macOf(m)} net={seen.get(m.ip)} from={originsOf(m, snap, h, !!scanOs[m.ip]?.os, seen.has(m.ip))} servers={<Servers m={m} snap={snap} />} ha={haOf(m)} onServices={() => onMachine(m.ip)} /></td></tr>}
                </Fragment>
              );
            })}
          </Table>}
          <Cards always={view === "cards"} dense>
            {sort.sorted.map((m) => {
              const h = hb.get(m.ip), shown = open.has(m.ip);
              return (
                <MachineCard key={m.ip} m={m} h={snap.health ? h : undefined} snap={snap} scan={scanOs[m.ip]} os={osOf(m)} watch={watchOf(m)} ha={haOf(m)} off={isOff(m)}
                  state={st(m)} shown={shown} onToggle={() => toggleOpen(m.ip)} onMachine={onMachine}
                  detail={shown && <Detail m={m} h={h} watch={watchOf(m)} mac={macOf(m)} net={seen.get(m.ip)} from={originsOf(m, snap, h, !!scanOs[m.ip]?.os, seen.has(m.ip))} servers={<Servers m={m} snap={snap} />} ha={haOf(m)} onServices={() => onMachine(m.ip)} />} />
              );
            })}
          </Cards>
        </>
      )}
    </div>
  );
}
