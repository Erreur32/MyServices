// Machines : accès (ping, SSH), système, serveurs (NPM, Apache, Docker), services et santé de chaque machine.
import { ArrowRight, ArrowUpCircle, Boxes, Plus, Bug, Check, ChevronRight, Container, Cpu, Eye, EyeOff, Gauge, Globe, HardDrive, HeartPulse, IdCard, Info, KeyRound, MemoryStick, Plug, RotateCw, ScanSearch, Settings2, ServerCrash, ShieldAlert, Thermometer, Unplug, WifiOff, type LucideIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LOGIN, LoginRequired, read, send, type Snapshot } from "../api";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { dateTime, dur, ipNum, splitHostName } from "../lib/format";
import { status } from "../lib/status";
import type { HealthHost, Machine, MachineLinks, NetDevice, NetScan, NetworkConnector, FreeboxInfo, ServiceStatus, UnifiDevice, UnifiSystem, Unlinked } from "../types";
import { AddonStrip, HaAddons } from "../components/ServiceStatusCards";
import { unifiDeviceOf, unifiDevices, unifiHealth, unifiSystem, withSystem } from "../lib/unifi";
import { freeboxHealth, freeboxOf } from "../lib/freebox";
import { modelIcon, serviceIcon } from "../lib/appIcons";
import { MachineModal } from "./MachinesSettings";
import { MSTATE, ORDER, OS_LABEL, OS_ORDER, mState, networkTool, osOfMachine, stateBadge, type MState, type OsKind } from "../lib/machines";
import { OsGlyph } from "../components/OsGlyph";
import { shortOs } from "../lib/osName";
import { ViewToggle, useStoredView } from "../components/ViewToggle";
import { Dot } from "../components/marks";
import { LEVEL } from "../lib/level";
import { rolesOf } from "../lib/ssh";
import { SshAccess } from "../components/ssh";
import { SourceBadges } from "../components/SourceBadges";
import { DetailRow, DetailSection } from "../components/DetailSection";
import { quiet } from "../lib/forms";
import { Overlay } from "../components/Overlay";
import { rereadMachines } from "../lib/scan";
import { healthItems, watchItems, worst, type WatchItem, type WatchKind, type WatchTone } from "../lib/machineWatch";
import { MachineIcon } from "../components/MachineIcon";
import { Badge, Cards, Dim, Empty, Fill, FilterBar, GradientFill, Level, Table, Td, Th, type Tone } from "../components/ui";
import { tx } from "../lib/i18n";
import { useStoredFlag } from "../lib/storedFlag";
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

/** The Docker containers behind the services of a machine (name, image, state), each with its service logo, one line each */
function DockerList({ m, snap }: Readonly<{ m: Machine; snap: Snapshot }>) {
  const seen = new Set<string>();
  const rows = snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.service?.kind === "docker").filter((r) => {
    const k = r.service!.name || r.service!.image || "";
    return k && !seen.has(k) && !!seen.add(k);
  });
  if (!rows.length) return null;
  return (
    <div className="py-1">
      <div className="mb-1 text-xs text-dim">{tx("Conteneurs Docker")} · {rows.length}</div>
      <ul className="flex flex-col gap-0.5">
        {rows.map((r) => {
          const sv = r.service!, icon = serviceIcon(r), up = !sv.state || /^(?:up|running)/i.test(sv.state);
          return (
            <li key={sv.name || sv.image} className="flex items-center gap-2 text-xs" title={[sv.image, sv.state].filter(Boolean).join(" · ")}>
              {icon ? <img src={icon} alt="" className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
              <b className="truncate font-medium">{sv.name || sv.image}</b>
              {sv.image && <span className="truncate font-mono text-[11px] text-dim">{sv.image}</span>}
              <span className={`ml-auto shrink-0 ${up ? "text-ok" : "text-warn"}`}>{sv.state ? sv.state.replace(/^Up /i, "") : tx("en marche")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
  if (k === "yes") return <Mark tone="warn" title={what === "root" ? tx("root peut se connecter en SSH") : tx("`sshd` accepte le mot de passe")}>⚠</Mark>;
  if (/prohibit-password|without-password/.test(k)) return <Mark tone="ok" title={tx("Par clé uniquement")}>🔑</Mark>;
  return <Mark tone="ok" title={what === "root" ? tx("root refusé en SSH") : tx("mot de passe refusé : clé seulement")}>✓</Mark>;
}

/** Colonnes santé de la v1 : disque le plus rempli, services systemd en échec, mises à jour et redémarrage */
export function ResCell({ h, what }: { h?: HealthHost; what: "cpu" | "mem" }) {
  const v = what === "cpu" ? h?.res?.cpu_pct : h?.res?.mem_pct;
  if (!h?.res?.available || v == null) return <Dim>-</Dim>;
  const tone = what === "mem" && v >= 97 ? "text-bad" : (what === "mem" && v >= 90) || (what === "cpu" && v >= 90) ? "text-warn" : "text-ok";
  return <b className={tone} title={what === "mem" && h.res?.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} Go` : undefined}>{Math.round(v)} %</b>;
}
type MeterTone = "ok" | "warn" | "bad";
const METER_TEXT: Record<MeterTone, string> = { ok: "text-txt", warn: "font-bold text-warn", bad: "font-bold text-bad" };   // plain when fine, bold and coloured only when it needs a look
const level = (v: number, warn: number, bad: number): MeterTone => {
  if (v >= bad) return "bad";
  return v >= warn ? "warn" : "ok";
};

/** Table cell: the value on top (with a hint on its right, e.g. the disk), a thin bar under it; the same width in every row */
function Meter({ pct, tone, hint, title, unit = "%" }: Readonly<{ pct: number; tone: MeterTone; hint?: string; title?: string; unit?: "%" | "°C" }>) {
  return (
    <div className="w-[5.5rem]" title={title}>
      <div className="flex items-baseline justify-between gap-1 leading-tight">
        <span className={`shrink-0 whitespace-nowrap text-sm tabular-nums ${METER_TEXT[tone]}`}>{Math.round(pct)} {unit}</span>
        {hint && <span className="min-w-0 truncate font-mono text-[10px] text-dim">{hint}</span>}
      </div>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-bg2"><GradientFill pct={pct} /></span>
    </div>
  );
}

/** The Freebox reports no load: its hottest CPU sensor stands in for the CPU, the memory given to its virtual machines for the memory (null for any other machine) */
function freeboxMeter(what: "cpu" | "mem", h?: HealthHost): React.ReactNode {
  if (what === "cpu" && h?.temp?.available && h.temp.source === "Freebox" && h.temp.celsius != null) {
    return <Meter pct={h.temp.celsius} unit="°C" tone={level(h.temp.celsius, 75, 85)} title={tx("Température la plus haute : la Freebox ne donne pas la charge de son processeur")} />;
  }
  if (what === "mem" && h?.vmem) {
    return <Meter pct={h.vmem.pct} tone="ok" hint="VM" title={tx("Mémoire des machines virtuelles de la Freebox : {0} / {1} Go (la box ne donne pas sa propre mémoire)", (h.vmem.used_mb / 1024).toFixed(1), (h.vmem.total_mb / 1024).toFixed(1))} />;
  }
  return null;
}

/** CPU, memory and fullest disk of a machine as table meters; « - » when health does not read them */
export function MeterCell({ h, what }: Readonly<{ h?: HealthHost; what: "cpu" | "mem" | "disk" }>) {
  if (what === "disk") {
    const d = topDisk(h);
    if (!d) return <Dim>-</Dim>;
    const warnAt = d.warning ? 0 : 80;   // the health check's own warning wins over the 80 % default
    const tone: MeterTone = d.critical ? "bad" : level(d.used_pct, warnAt, 90);
    return <Meter pct={d.used_pct} tone={tone} hint={d.mount} title={tx("Disque le plus rempli : {0}", d.mount)} />;
  }
  const v = what === "cpu" ? h?.res?.cpu_pct : h?.res?.mem_pct;
  if (!h?.res?.available || v == null) return freeboxMeter(what, h) ?? <Dim>-</Dim>;
  if (what === "cpu") return <Meter pct={v} tone={level(v, 90, 101)} />;
  const gb = h.res.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} Go` : undefined;
  return <Meter pct={v} tone={level(v, 90, 97)} hint={h.res.mem_total_mb ? `${Math.round(h.res.mem_total_mb / 1024)} Go` : undefined} title={gb} />;
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
  return <b className={`whitespace-nowrap ${diskTone(d)}`}>{d.used_pct} %</b>;
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
function WatchList({ items, wrap = false, quiet = false }: Readonly<{ items: WatchItem[]; wrap?: boolean; quiet?: boolean }>) {   // quiet : rien à dire = rien d'affiché (le badge de niveau le dit déjà)   // wrap : libellé « Rien à surveiller » écrit en toutes lettres (fiches)
  if (!items.length && quiet) return null;
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
/** Colour of a processor temperature: red from 85 °C, orange from 75 °C */
function heatClass(c: number): string {
  if (c >= 85) return "text-bad";
  return c >= 75 ? "text-warn" : "";
}

const DRIVE_STATE: Record<string, string> = { enabled: tx("actif"), disabled: tx("désactivé") };

/** One internal disk: its model, then its state, temperature and SMART as separate marks; only a problem is coloured */
export function DriveStatus({ d }: Readonly<{ d: NonNullable<HealthHost["drives"]>[number] }>) {
  const state = d.state ? DRIVE_STATE[d.state] ?? d.state : null;
  const fine = d.state === "enabled";
  let smart = tx("SMART inconnu");
  if (d.smart_ok === true) smart = tx("SMART OK");
  if (d.smart_ok === false) smart = tx("SMART en défaut");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {d.model && <span className="font-medium">{d.model}</span>}
      {state && <Badge tone={fine ? "off" : "warn"}>{state}</Badge>}
      {d.temperature != null && <Badge tone={d.temperature >= 85 ? "bad" : d.temperature >= 75 ? "warn" : "off"}>{Math.round(d.temperature)} °C</Badge>}
      <Badge tone={d.smart_ok === false ? "bad" : "off"}>{smart}</Badge>
    </span>
  );
}

/** Readings side by side, one small box each (name, then value), in name order: easier to tell apart than a line of values */
export function ProbeChips({ items }: Readonly<{ items: { name: string; value: string; tone: string; dim?: boolean }[] }>) {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <span className="flex flex-wrap gap-1.5">
      {sorted.map((x) => (
        <span key={x.name} className={`inline-flex items-baseline gap-1.5 rounded-md border border-line/60 bg-bg2/40 px-1.5 py-0.5 ${x.dim ? "opacity-50" : ""}`}>
          <span className="text-dim">{x.name}</span><span className={`tabular-nums ${x.tone}`}>{x.value}</span>
        </span>
      ))}
    </span>
  );
}

/** The processor temperature when the machine reports one (a gauge on a 0 to 100 °C scale, red from 85 °C), else nothing */
function TemperatureRow({ h }: Readonly<{ h: HealthHost }>) {
  const t = h.temp;
  if (!t?.available || t.celsius == null) return null;
  const hot = heatClass(t.celsius);
  return (
    <DetailRow k={tx("Température")} title={tx("Température du processeur")}>
      <Fill pct={t.celsius} /><span className={`tabular-nums ${hot}`}>{Math.round(t.celsius)} °C</span>{t.source && <Dim>{t.source}</Dim>}
    </DetailRow>
  );
}

function HealthRows({ h }: Readonly<{ h: HealthHost }>) {
  const bar = (label: string, pct: number | undefined, extra?: string) => pct == null ? null : (
    <DetailRow key={label} k={label} title={label}><Fill pct={pct} /><span className="tabular-nums">{Math.round(pct)} %</span>{extra && <Dim>{extra}</Dim>}</DetailRow>
  );
  return (
    <>
      {h.res?.available && bar(tx("CPU"), h.res.cpu_pct)}
      {h.res?.available && bar(tx("Mémoire"), h.res.mem_pct,
        h.res.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} ${tx("Go")}` : undefined)}
      {(h.disks || []).filter((d) => (d.size_gb ?? 1) >= 1).map((d) => bar(d.mount, d.used_pct, d.avail_gb != null ? `${d.avail_gb.toFixed(0)} ${tx("Go libres")}` : undefined))}
      <TemperatureRow h={h} />
      {(h.drives ?? []).map((d) => (
        <DetailRow key={d.model ?? "disk"} k={tx("État du disque")} title={tx("État du disque")}><DriveStatus d={d} /></DetailRow>
      ))}
      {!!h.temp?.sensors?.length && (
        <DetailRow k={tx("Sondes")} title={tx("Sondes")}>
          <ProbeChips items={h.temp.sensors.map((x) => ({ name: x.name, value: `${Math.round(x.celsius)} °C`, tone: heatClass(x.celsius) }))} />
        </DetailRow>
      )}
      {!!h.fans?.length && (
        <DetailRow k={tx("Ventilateur")} title={tx("Ventilateur")}>
          <ProbeChips items={h.fans.map((f) => ({ name: f.name, value: `${Math.round(f.rpm)} ${tx("tr/min")}`, tone: "" }))} />
        </DetailRow>
      )}
      {h.vmem && bar(tx("Mémoire VM"), h.vmem.pct, `${(h.vmem.used_mb / 1024).toFixed(1)} / ${(h.vmem.total_mb / 1024).toFixed(1)} ${tx("Go")}`)}
      {h.vms && (
        <DetailRow k={tx("Machines virtuelles")} title={tx("Machines virtuelles")}>
          <span className={h.vms.running ? "" : "text-dim"}>{tx("{0} en marche sur {1}", h.vms.running, h.vms.total)}</span>
        </DetailRow>
      )}
    </>
  );
}

/** Ligne dépliée à la demande : cinq rubriques (identité, système, accès, logiciels, santé), chacune avec l'origine de ses données */
function Detail({ m, h, mac, net, from, watch, servers, ha, unifi, unifiSys, unifiNet, freebox, containers, onFilter }: Readonly<{ onFilter?: (sel: Selected) => void; m: Machine; containers?: React.ReactNode; h?: HealthHost; mac?: string; net?: NetDevice; from: ReturnType<typeof originsOf>; watch: WatchItem[]; servers?: React.ReactNode; ha?: ServiceStatus; unifi?: UnifiDevice; unifiSys?: UnifiSystem; unifiNet?: UnifiNet; freebox?: FreeboxInfo }>) {
  const unifiOnly = !!unifi && !m.info && !m.agent;   // read only through UniFi: no SSH, no agent
  const i = m.info, hw = hardwareRows(m.agent?.hardware);
  return (
    <div className="grid gap-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-3">
      <WatchSummary items={watch} />
      <IdentitySection m={m} mac={mac} net={net} from={[...from.role, ...from.mac]} tool={freebox || unifi ? "MynetworK" : undefined} />

      <Section icon={Cpu} title={tx("Système")} tone="violet" from={from.os}>
        <Row k={tx("Système")}>{i?.os || m.agent?.os || haSystemName(ha) || undefined}</Row>
        {ha?.system && <HaSystemRows sys={ha.system} />}
        {unifi && <UnifiRows d={unifi} sys={unifiSys} />}
        {freebox?.system && <FreeboxRows fb={freebox} />}
        <Row k={tx("Noyau")}>{i?.kernel || m.agent?.kernel || undefined}</Row>
        <Row k={tx("En marche")}>{uptimeOf(m, unifi, freebox) ? dur(uptimeOf(m, unifi, freebox)!) : undefined}</Row>
        {hw.map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}
        <GpuRows m={m} />
        {!i && !m.agent && !ha?.system && !unifi && !freebox && <Dim>-</Dim>}
      </Section>

      {freebox && <FreeboxAccessSection fb={freebox} from={from.ssh} />}
      {!freebox && unifiOnly && <UnifiAccessSection d={unifi} sys={unifiSys} mac={mac} from={from.ssh} />}
      {!freebox && !unifiOnly && <AccessSection m={m} from={from.ssh} />}

      {freebox && (freebox.vms || freebox.vm_system) && <FreeboxVmSection fb={freebox} from={from.services} />}
      {!freebox && unifiOnly && <UnifiNetworkSection d={unifi} sys={unifiSys} net={unifiNet} from={from.services} />}
      {!(freebox && (freebox.vms || freebox.vm_system)) && !(!freebox && unifiOnly) && <SoftwareSection m={m} servers={servers} ha={ha} from={from.services} containers={containers} onFilter={onFilter} />}

      <HealthSection h={h} from={from.health} />
      <UpdatesSection h={h} windows={!!m.agent || h?.os === "windows"} from={from.health} freebox={freebox} unifi={unifi} unifiSys={unifiSys} />
    </div>
  );
}

/** GPUs read by GpuViewR (matched by the machine's name): model, temperature, load, memory, power */
function GpuRows({ m }: Readonly<{ m: Machine }>) {
  const src = m.links?.sources.find((x) => x.source === "gpuviewr"), gpus = src?.gpus ?? [], models = src?.models ?? [];
  const go = (mb: number) => `${(mb / 1024).toFixed(1)} Go`;
  return <>
    {gpus.map((g, n) => (
      <Row key={`${g.name}-${n}`} k={gpus.length > 1 ? `GPU ${n + 1}` : "GPU"}>
        <span title={tx("Lu par GpuViewR")}>{g.name || "?"}
          <Dim>{[g.temp != null && `${Math.round(g.temp)} °C`, g.util != null && `${Math.round(g.util)} %`,
            g.mem_total ? `${go(g.mem_used ?? 0)} / ${(g.mem_total / 1024).toFixed(0)} Go` : null,
            g.power != null && `${Math.round(g.power)} W`].filter(Boolean).map((x) => ` · ${x}`).join("")}</Dim>
          {g.day && <span className="block text-xs text-dim">{tx("24 h :")} {[g.day.temp_max != null && tx("max {0} °C", Math.round(g.day.temp_max)),
            g.day.util_avg != null && tx("charge moy. {0} %, max {1} %", Math.round(g.day.util_avg), Math.round(g.day.util_max ?? 0)),
            g.day.mem_max != null && tx("mémoire max {0}", go(g.day.mem_max)), g.day.pow_avg != null && tx("{0} W en moyenne", Math.round(g.day.pow_avg))].filter(Boolean).join(" · ")}</span>}
        </span>
      </Row>
    ))}
    {models.map((x, n) => (
      <Row key={`${x.model}-${n}`} k={models.length > 1 ? tx("Modèle {0}", n + 1) : tx("Modèle IA")}>
        <span title={x.alias ? `${x.alias} · ${tx("Lu par GpuViewR")}` : tx("Lu par GpuViewR")}>{x.model || "?"}<Dim>{[x.runtime, x.port ? tx("port {0}", x.port) : null,
          x.state === "idle" ? tx("au repos") : x.state, x.mem_mb ? go(x.mem_mb) : null,
          gpus.length > 1 && x.gpu != null ? `GPU ${x.gpu + 1}` : null].filter(Boolean).map((v) => ` · ${v}`).join("")}</Dim></span>
      </Row>
    ))}
  </>;
}

/** « Home Assistant OS 18.3 »: the system of a machine read only through Home Assistant (no SSH, no agent) */
function haSystemName(ha?: ServiceStatus): string {
  const sys = ha?.system;
  if (!sys?.method) return "";
  return sys.os ? `${sys.method} ${sys.os}` : sys.method;
}

/** The system line of a card: the system read (SSH, agent), else Home Assistant's, else the UniFi model and firmware */
function SystemLine({ m, os, ha, unifi, freebox }: Readonly<{ m: Machine; os: OsKind | null; ha?: ServiceStatus; unifi?: UnifiDevice; freebox?: FreeboxInfo }>) {
  if (m.info?.os || m.agent?.os) return <OsShort m={m} kind={os} />;
  if (haSystemName(ha)) return <span className="truncate" title={tx("Lu par Home Assistant")}>{haSystemName(ha)}</span>;
  if (freebox?.system?.model) return <span className="truncate" title={tx("Lu par MynetworK (Freebox)")}>{[freebox.system.model, freebox.system.firmware].filter(Boolean).join(" · ")}</span>;
  if (unifi?.version) return <span className="truncate" title={tx("Lu par MynetworK (UniFi)")}>{[unifi.model, `UniFi ${unifi.version}`].filter(Boolean).join(" · ")}</span>;
  return <OsShort m={m} kind={os} />;
}

const UNIFI_KIND: Record<string, string> = { udm: "Passerelle", ugw: "Passerelle", uxg: "Passerelle", usw: "Switch", uap: "Borne Wi-Fi", ubb: "Pont Wi-Fi", uph: "Téléphone", uck: "Contrôleur" };
const isGateway = (d: UnifiDevice, sys?: UnifiSystem) => !!sys?.gateway && ["udm", "ugw", "uxg"].includes(d.type ?? "");
export type UnifiNet = { clients: NonNullable<NetworkConnector["unifi"]>["clients"]; devices: UnifiDevice[] };

/** A UniFi device as MynetworK relays it: model (photo), kind, and on the gateway UniFi OS and the UniFi Network application with their versions
 *  (MynetworK 0.10.68+); its firmware and update are in the Updates section */
function UnifiRows({ d, sys }: Readonly<{ d: UnifiDevice; sys?: UnifiSystem }>) {
  const gateway = isGateway(d, sys), kind = UNIFI_KIND[d.type ?? ""];
  return <>
    <Row k={tx("Appareil")}>{[d.name, d.model].filter(Boolean).length ? <span className="inline-flex items-center gap-2">{modelIcon(d.model) && <img src={modelIcon(d.model)!} alt="" className="h-9 w-auto" />}{[d.name, d.model].filter(Boolean).join(" · ")}</span> : undefined}</Row>
    <Row k={tx("Type")}>{kind ? tx(kind) : d.type?.toUpperCase()}</Row>
    {gateway && sys?.console_version && <Row k="UniFi OS"><span className="font-mono">{sys.console_version}</span></Row>}
    {gateway && sys?.version && <Row k="UniFi Network"><span className="font-mono">{sys.version}</span>{sys.update_available && <span className="text-warn"> · {tx("mise à jour disponible")}</span>}</Row>}
  </>;
}

/** The device firmware in the Updates section: the installed version, then what is on offer or that MynetworK does not tell (like the Freebox's) */
export function UnifiFirmware({ d, sys }: Readonly<{ d: UnifiDevice; sys?: UnifiSystem }>) {
  const gateway = isGateway(d, sys);
  return <>
    <Row k="Firmware">{d.version ? <span className="font-mono">{d.version}</span> : undefined}</Row>
    {d.upgradable == null && <Row k={tx("Mise à jour")}><Dim>{tx("non transmise par MynetworK")}</Dim></Row>}
    {d.upgradable && <Row k={tx("Disponible")}><span className="font-mono text-warn">{d.upgrade_to_firmware ? `→ ${d.upgrade_to_firmware}` : tx("disponible")}</span></Row>}
    {gateway && sys?.update_available && <Row k="UniFi Network"><span className="text-warn">{tx("mise à jour disponible")}</span>{sys.version && <Dim>{sys.version}</Dim>}</Row>}
  </>;
}

/** A UniFi device has no SSH here: its section says how it is read (MynetworK, through the UniFi API), at which address, and its state */
export function UnifiAccessSection({ d, sys, mac, from }: Readonly<{ d: UnifiDevice; sys?: UnifiSystem; mac?: string; from: Origin[] }>) {
  const on = d.state === "connected", addr = d.ip ?? sys?.gateway?.lan_ip;
  return (
    <Section icon={Plug} title={tx("Lecture")} tone="ok" from={from}>
      <Row k={tx("Lue par")}><Badge tone="ok">MynetworK</Badge> <Dim>{tx("API UniFi, sans SSH ni agent")}</Dim></Row>
      <Row k={tx("Adresse")}>{addr ? <span className="font-mono">{addr}</span> : undefined}</Row>
      <Row k="MAC">{d.mac || mac ? <span className="font-mono">{d.mac ?? mac}</span> : undefined}</Row>
      <Row k={tx("État UniFi")}>{d.state ? <Badge tone={on ? "ok" : "bad"}>{on ? tx("connecté") : d.state}</Badge> : undefined}</Row>
    </Section>
  );
}

/** What the UniFi side shows around the device: its clients, and for the gateway the whole network (devices by kind, clients wired / Wi-Fi, network names) */
export function UnifiNetworkSection({ d, sys, net, from }: Readonly<{ d: UnifiDevice; sys?: UnifiSystem; net?: UnifiNet; from: Origin[] }>) {
  const gateway = isGateway(d, sys), clients = net?.clients ?? [], devices = net?.devices ?? [];
  const kinds = Object.entries(devices.reduce<Record<string, number>>((n, x) => ({ ...n, [UNIFI_KIND[x.type ?? ""] ?? x.type ?? "?"]: (n[UNIFI_KIND[x.type ?? ""] ?? x.type ?? "?"] ?? 0) + 1 }), {}));
  const wired = clients.filter((c) => c.wired).length, ssids = [...new Set(clients.map((c) => c.essid).filter((x): x is string => !!x))];
  return (
    <Section icon={Boxes} title={tx("Infos UniFi")} tone="warn" from={from}>
      {d.clients != null && <Row k={tx("Clients")}>{d.clients}</Row>}
      {gateway && <>
        <Row k={tx("Appareils UniFi")}>{kinds.length ? kinds.map(([k, n]) => `${n} ${tx(k).toLowerCase()}`).join(" · ") : undefined}</Row>
        <Row k={tx("Clients du réseau")}>{clients.length ? `${clients.length} · ${wired} ${tx("filaires")} / ${clients.length - wired} Wi-Fi` : undefined}</Row>
        {ssids.length > 0 && <Row k={tx("Réseaux Wi-Fi")}><ProbeChips items={ssids.map((x) => ({ name: x, value: tx("{0} appareil(s)", clients.filter((c) => c.essid === x).length), tone: "" }))} /></Row>}
      </>}
      {d.clients == null && !gateway && <Dim>-</Dim>}
    </Section>
  );
}

/** The Freebox as MynetworK relays it: model, line, firmware and the update it offers */
/** Line speed in bits per second, as « 8 Gb/s » or « 70 Mb/s » */
const bitRate = (bits: number): string => (bits >= 1e9 ? `${(bits / 1e9).toFixed(1).replace(".0", "")} Gb/s` : `${Math.round(bits / 1e6)} Mb/s`);

/** The box firmware in the Updates section: the installed version, then what is on offer (version, date, release notes) or that MynetworK does not tell */
export function FreeboxFirmware({ fb }: Readonly<{ fb: FreeboxInfo }>) {
  const sys = fb.system ?? {}, offer = fb.firmware_update?.server;
  const latest = offer?.latest ?? sys.latest_firmware;
  return <>
    <Row k="Firmware">{sys.firmware ? <span className="font-mono">{sys.firmware}</span> : undefined}</Row>
    {sys.update_available == null && <Row k={tx("Mise à jour")}><Dim>{tx("non transmise par MynetworK")}</Dim></Row>}
    {sys.update_available && (
      <Row k={tx("Disponible")}>
        <span className="font-mono text-warn">{latest ? `→ ${latest}` : tx("disponible")}</span>{offer?.date && <Dim>{offer.date}</Dim>}
        {offer?.url && <a href={offer.url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">{tx("notes de version")}</a>}
      </Row>
    )}
  </>;
}

/** The line: state and medium, speeds and fibre power */
function FreeboxLine({ fb }: Readonly<{ fb: FreeboxInfo }>) {
  const c = fb.connection ?? {}, fibre = fb.ftth;
  const medium = c.media ? ` · ${c.media.toUpperCase()}` : "";
  let speed: string | undefined;
  if (c.bandwidth_down) speed = c.bandwidth_up ? `${bitRate(c.bandwidth_down)} / ${bitRate(c.bandwidth_up)}` : bitRate(c.bandwidth_down);
  const now = c.rate_down == null ? undefined : `${bitRate(8 * c.rate_down)} / ${bitRate(8 * (c.rate_up ?? 0))}`;
  return <>
    <Row k={tx("Ligne")}>{c.state ? `${c.state}${medium}` : undefined}</Row>
    {speed && <Row k={tx("Débit max")}>{speed}</Row>}
    {now && <Row k={tx("Débit actuel")}>{now}</Row>}
    {fibre?.sfp_pwr_rx != null && (
      <Row k={tx("Fibre")}><span className={fibre.sfp_has_signal === false ? "text-bad" : ""}>{fibre.sfp_pwr_rx.toFixed(1)} dBm {tx("reçus")}{fibre.sfp_pwr_tx == null ? "" : ` · ${fibre.sfp_pwr_tx.toFixed(1)} dBm ${tx("émis")}`}</span></Row>
    )}
  </>;
}

/** The box's DHCP server and the DNS it hands out (MynetworK 0.10.72+; nothing shown without them) */
export function FreeboxNetwork({ dhcp }: Readonly<{ dhcp?: FreeboxInfo["dhcp"] }>) {
  if (!dhcp) return null;
  const range = dhcp.ip_range_start && dhcp.ip_range_end ? `${dhcp.ip_range_start} → ${dhcp.ip_range_end}` : "";
  const detail = [dhcp.gateway ? `${tx("passerelle")} ${dhcp.gateway}` : "", dhcp.netmask ? `${tx("masque")} ${dhcp.netmask}` : ""].filter(Boolean).join(" · ");
  return <>
    <Row k="DHCP">
      {dhcp.enabled === false ? <span className="text-warn">{tx("coupé")}</span> : <span className="text-ok">{tx("activé")}</span>}
      {range && <span className="font-mono text-xs"> · {range}</span>} {detail && <Dim>{detail}</Dim>}
    </Row>
    <Row k="DNS">{dhcp.dns.length ? <span className="font-mono text-xs">{dhcp.dns.join(" · ")}</span> : <Dim>{tx("celui de la box")}</Dim>}</Row>
  </>;
}

const BAND: Record<string, string> = { "2d4g": "2,4 GHz", "5g": "5 GHz", "6g": "6 GHz" };
const bandLabel = (b: string | null): string => (b ? BAND[b.toLowerCase()] ?? b.toUpperCase() : "");

/** Wi-Fi: how many radios are on and how many devices are connected, then each radio (band, channel, width; a disabled one is dimmed) and each network name */
export function FreeboxWifi({ wifi }: Readonly<{ wifi: NonNullable<FreeboxInfo["wifi"]> }>) {
  const radios = wifi.aps ?? [], on = radios.filter((a) => a.state === "active").length;
  const nets = (wifi.networks ?? []).filter((n) => n.ssid);
  const summary = [radios.length ? tx("{0} bande(s) active(s) sur {1}", on, radios.length) : "", wifi.stations_count == null ? "" : tx("{0} appareil(s)", wifi.stations_count)].filter(Boolean).join(" · ");
  return <>
    <Row k="Wi-Fi">{wifi.enabled === false ? <span className="text-warn">{tx("coupé")}</span> : <Dim>{summary || tx("activé")}</Dim>}</Row>
    {radios.length > 0 && (
      <Row k={tx("Bandes")}>
        <ProbeChips items={radios.map((a) => {
          const active = a.state === "active";
          const detail = active ? [bandLabel(a.band), a.channel ? `ch. ${a.channel}` : "", a.width ? `${a.width} MHz` : ""].filter(Boolean).join(" · ") : tx("désactivée");
          return { name: a.name ?? bandLabel(a.band), value: detail, tone: "", dim: !active };
        })} />
      </Row>
    )}
    {nets.length > 0 && (
      <Row k={tx("Réseaux")}>
        <ProbeChips items={nets.map((n) => ({ name: n.ssid ?? "", value: [bandLabel(n.band), n.hidden ? tx("masqué") : "", n.enabled === false ? tx("coupé") : ""].filter(Boolean).join(" · "), tone: "", dim: n.enabled === false }))} />
      </Row>
    )}
  </>;
}

/** What is given to the virtual machines, then each virtual machine */
function FreeboxVms({ fb }: Readonly<{ fb: FreeboxInfo }>) {
  const sys = fb.vm_system, gb = (mb?: number | null) => ((mb ?? 0) / 1024).toFixed(1);
  const cpus = sys?.total_cpus ? `${sys.used_cpus ?? 0} / ${sys.total_cpus} CPU` : "";
  const mem = sys?.total_memory_mb ? `${gb(sys.used_memory_mb)} / ${gb(sys.total_memory_mb)} ${tx("Go")}` : "";
  return <>
    {(cpus || mem) && <Row k={tx("Alloué aux VM")}>{[cpus, mem].filter(Boolean).join(" · ")} <Dim>{tx("part des VM, pas la charge de la box")}</Dim></Row>}
    {(fb.vms ?? []).map((v) => (
      <Row key={v.id ?? v.name ?? "vm"} k={tx("Machine virtuelle")}>
        <Badge tone={v.status === "running" ? "ok" : "off"}>{v.status === "running" ? tx("en marche") : tx("arrêtée")}</Badge> <b className="font-medium">{v.name}</b>{" "}
        <Dim>{[v.vcpus == null ? "" : tx("{0} CPU", v.vcpus), v.memory_mb == null ? "" : `${Math.round(v.memory_mb / 1024)} ${tx("Go")}`, v.os].filter(Boolean).join(" · ")}</Dim>
      </Row>
    ))}
  </>;
}

/** The exact model of the box: its photo (Ultra, Pop, Revolution) when there is one, and the name */
function FreeboxModel({ model }: Readonly<{ model: string }>) {
  const photo = modelIcon(model);
  return <span className="inline-flex items-center gap-2">{photo && <img src={photo} alt="" className="h-9 w-auto" />}{model}</span>;
}

/** The Freebox has no SSH: its section says how it is read (MynetworK, through the Freebox OS API), at which address, and whether the paired app has every right it needs */
export function FreeboxAccessSection({ fb, from }: Readonly<{ fb: FreeboxInfo; from: Origin[] }>) {
  const missing = fb.missing_rights ?? [];
  const known = fb.hosts ?? null, active = fb.hosts_active ?? null;
  return (
    <Section icon={Plug} title={tx("Lecture")} tone="ok" from={from}>
      <Row k={tx("Lue par")}><Badge tone="ok">MynetworK</Badge> <Dim>{tx("API Freebox OS, sans SSH ni agent")}</Dim></Row>
      <Row k={tx("Adresse")}>{fb.system?.lan_ip ? <span className="font-mono">{fb.system.lan_ip}</span> : undefined}</Row>
      <Row k={tx("Droits de l'application")}>
        {missing.length ? <span className="text-warn">{tx("manquants : {0}", missing.join(", "))}</span> : <span className="text-ok">{tx("tous accordés")}</span>}
      </Row>
      <Row k={tx("Appareils vus")}>{known == null ? undefined : `${active ?? 0} ${tx("actifs")} / ${known}`}</Row>
    </Section>
  );
}

/** The Freebox has no software or services to list: its section is about the virtual machines it runs */
function FreeboxVmSection({ fb, from }: Readonly<{ fb: FreeboxInfo; from: Origin[] }>) {
  const none = !(fb.vms ?? []).length && !fb.vm_system?.total_memory_mb && !fb.vm_system?.total_cpus;
  return (
    <Section icon={Boxes} title={tx("Infos VM")} tone="warn" from={from}>
      <FreeboxVms fb={fb} />
      {none && <Dim>{tx("aucune machine virtuelle")}</Dim>}
    </Section>
  );
}

/** What MynetworK reads of the Freebox (line, firmware, then storage, fibre, Wi-Fi, temperatures and virtual machines from 0.10.69) */
function FreeboxRows({ fb }: Readonly<{ fb: FreeboxInfo }>) {
  const sys = fb.system ?? {};
  return <>
    <Row k={tx("Appareil")}>{sys.model ? <FreeboxModel model={sys.model} /> : undefined}</Row>
    <FreeboxLine fb={fb} />
    <FreeboxNetwork dhcp={fb.dhcp} />
    {fb.wifi && <FreeboxWifi wifi={fb.wifi} />}
    {fb.missing_rights && fb.missing_rights.length > 0 && (
      <Row k={tx("Droits manquants")}><span className="text-warn">{fb.missing_rights.join(", ")}</span>{" "}
        <Dim>{tx("à donner à l'application MynetworK dans Freebox OS (gestion des accès)")}</Dim></Row>
    )}
  </>;
}

/** Home Assistant's parts and their versions, as its own « About » page lists them */
function HaSystemRows({ sys }: Readonly<{ sys: NonNullable<ServiceStatus["system"]> }>) {
  return <>
    <Row k={tx("Installation")}>{sys.method ?? <Dim>{tx("Core ou Container")}</Dim>}</Row>
    <Row k="Core">{sys.core ? <span className="font-mono">{sys.core}</span> : undefined}</Row>
    <Row k="Supervisor">{sys.supervisor ? <span className="font-mono">{sys.supervisor}</span> : undefined}</Row>
    <Row k="Operating System">{sys.os ? <span className="font-mono">{sys.os}</span> : undefined}</Row>
  </>;
}

/** Detail, « Identity »: name, IP, state, roles, MAC, what the network tools saw, other names, virtualization */
function IdentitySection({ m, mac, net, from, tool }: Readonly<{ m: Machine; mac?: string; net?: NetDevice; from: Origin[]; tool?: string }>) {
  const roles = rolesOf(m.role);
  // read by a network tool's API (the Freebox, a UniFi gateway): « online, no SSH » would be wrong, it is followed through that tool
  const viaTool = tool && mState(m) === "nossh";
  const [stTone, stLabel, stTip]: [Tone, string, string] = viaTool ? ["ok", tx("Par le connecteur {0}", tool), tx("Lue par le connecteur {0} (son API) : en ligne, sans SSH ni agent", tool)] : stateBadge(m);
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
function SoftwareSection({ m, servers, ha, from, containers, onFilter }: Readonly<{ onFilter?: (sel: Selected) => void; m: Machine; servers?: React.ReactNode; ha?: ServiceStatus; from: Origin[]; containers?: React.ReactNode }>) {
  const i = m.info;
  const vhosts = (i?.vhosts ?? []) as { port?: number; names?: string[] }[];
  return (
      <Section icon={Boxes} title={tx("Logiciels et services")} tone="warn" from={from}>
        <Row k={tx("Serveurs")}>{servers}</Row>
        <Row k={tx("Services")}>
          {onFilter && m.services > 0 ? <button type="button" className="text-link hover:underline" title={tx("Voir ses services")} onClick={() => onFilter({ machine: [m.ip] })}>{m.services}</button> : m.services}
          {m.npm > 0 && <Dim> · {onFilter ? <button type="button" className="text-link hover:underline" title={tx("Voir ses services NPM")} onClick={() => onFilter({ machine: [m.ip], src: ["npm"] })}>{m.npm} NPM</button> : `${m.npm} NPM`}</Dim>}{m.down > 0 && <span className="text-bad"> · {m.down} {tx("en panne")}</span>}</Row>
        <Row k="Docker">{i?.docker ? tx("{0} conteneur(s) en cours", i.docker) : m.agent?.docker != null ? (m.agent.docker ? tx("{0} conteneur(s) (lus par l'agent)", m.agent.docker) : <Dim>{tx("aucun conteneur")}</Dim>) : i?.docker_installed === false ? <Dim>{tx("absent")}</Dim> : undefined}</Row>
        {containers}
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

/** Updates waiting on a machine, always shown in the detail window: the packages (apt, « name → version ») or the Windows updates, up to 30 named */
/** The summary line of the pending updates: Windows updates, a box firmware, or packages */
function updatesLabel(n: number, windows: boolean, firmware?: boolean): string {
  if (firmware) return tx("Mise à jour du firmware disponible");
  return windows ? tx("{0} mise(s) à jour Windows", n) : tx("{0} paquet(s) à mettre à jour", n);
}

function UpdatesFold({ h, windows }: Readonly<{ h: HealthHost; windows: boolean }>) {
  const n = h.apt?.upgradable ?? 0, list = h.apt?.sample ?? [];
  if (!n) return null;
  const more = n - list.length;
  return (
    <div className="my-1 rounded-lg border border-line/60">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
        <ArrowUpCircle size={13} className="shrink-0 text-warn" aria-hidden />
        <span className="text-warn">{updatesLabel(n, windows, h.apt?.firmware)}</span>
        {!!h.apt?.security && <Badge tone="bad">{tx("{0} de sécurité", h.apt.security)}</Badge>}
      </div>
      {list.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto border-t border-line/40 px-2.5 py-1.5 font-mono text-[11px] text-muted">
          {list.map((u) => <li key={u} className="break-all">{u}</li>)}
          {more > 0 && <li className="font-sans text-dim">{tx("… et {0} autres", more)}</li>}
        </ul>
      )}
    </div>
  );
}

/** Folded card: an orange arrow with the number of updates waiting (their names on hover) */
function UpdatesChip({ h }: Readonly<{ h?: HealthHost }>) {
  const n = h?.apt?.upgradable ?? 0;
  if (!n && !h?.reboot_required) return null;
  const names = (h?.apt?.sample ?? []).slice(0, 12).join("\n");
  const tip = [n ? tx("{0} mise(s) à jour en attente", n) : "", h?.reboot_required ? tx("redémarrage requis") : "", names].filter(Boolean).join("\n");
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-warn/50 bg-warn/10 px-1.5 py-0.5 text-[11px] font-semibold text-warn" title={tip}>
      {n > 0 && <><ArrowUpCircle size={12} aria-hidden />{n}</>}{h?.reboot_required && <RotateCw size={12} aria-hidden />}
    </span>
  );
}

/** Detail, « Updates »: up to date, or the packages / Windows updates waiting (folded list), and a reboot required */
export function UpdatesSection({ h, windows, from, freebox, unifi, unifiSys }: Readonly<{ h?: HealthHost; windows: boolean; from: Origin[]; freebox?: FreeboxInfo; unifi?: UnifiDevice; unifiSys?: UnifiSystem }>) {
  if (!h) return null;
  const n = h.apt?.upgradable ?? 0;
  return (
    <Section icon={ArrowUpCircle} title={tx("Mises à jour")} tone={n || h.reboot_required ? "warn" : "ok"} from={from}>
      {freebox && <FreeboxFirmware fb={freebox} />}
      {!freebox && unifi && <UnifiFirmware d={unifi} sys={unifiSys} />}
      {!n && <Row k={tx("État")}><span className="text-ok">{tx("à jour")}</span></Row>}
      {h.reboot_required && <Row k={tx("Redémarrage")}><span className="text-warn">{tx("redémarrage requis")}</span></Row>}
      <UpdatesFold h={h} windows={windows} />
    </Section>
  );
}

/** Detail, « Health »: level, resources, failed systemd units, updates */
export function HealthSection({ h, from }: Readonly<{ h?: HealthHost; from: Origin[] }>) {
  const failed = h?.systemd?.failed.length || 0;
  return (
      <Section icon={HeartPulse} title={tx("Santé")} tone="bad" from={from}>
        {h ? <>
          <Row k={tx("Niveau")}><Level level={h.reachable === false ? "down" : h.level} /></Row>
          <HealthRows h={h} />
          <Row k="Systemd">{failed ? <span className="text-bad">{tx("{0} service(s) en échec", failed)}</span> : undefined}</Row>
        </> : <Dim>{tx("non suivie")}</Dim>}
      </Section>
  );
}

/** Health column: the level read; without one, why: switched off on purpose, not answering, or not followed by the health check */
/** Order of the « Santé » column, the same as its badges: critical or offline first, then to watch, waiting, OK, and last what is not read at all */
const LEVEL_RANK: Record<string, number> = { down: 0, crit: 0, warn: 1, ok: 3 };
function healthRank(m: Machine, h: HealthHost | undefined, followed: boolean): number {
  if (h) return LEVEL_RANK[levelKey(h)] ?? 4;
  if (followed && !m.off) return 2;
  return !m.off && m.ping === false ? 0 : 4;
}

/** How long a machine has been up, from whatever reads it: SSH, its agent, the UniFi console or the Freebox */
function uptimeOf(m: Machine, unifi?: UnifiDevice, fb?: FreeboxInfo): number | undefined {
  return m.info?.uptime_s ?? m.agent?.uptime_s ?? unifi?.uptime ?? fb?.system?.uptime ?? undefined;
}

/** The model a network tool reads for this machine (the Freebox, a UniFi device): its photo is the icon */
function modelOf(m: Machine, network: NetworkConnector[] | undefined, unifi?: UnifiDevice): string | undefined {
  return freeboxOf(m, network)?.system?.model ?? unifi?.model;
}

/** Flag after the name: only the system updates waiting (and a reboot required), the packages named in the tooltip; the other things to watch have their own column */
function ProblemFlag({ h }: Readonly<{ h?: HealthHost }>) {
  const n = h && h.reachable !== false ? h.apt?.upgradable ?? 0 : 0;
  if (!n) return null;
  const names = (h?.apt?.sample ?? []).slice(0, 12).join("\n");
  return <span className="text-xs text-warn" title={[tx("{0} mise(s) à jour en attente", n), names].filter(Boolean).join("\n")}>⚑ {n}</span>;
}

function HealthLevel({ m, h, followed }: Readonly<{ m: Machine; h?: HealthHost; followed: boolean }>) {
  if (h) {
    const key = levelKey(h), [tone, label] = LEVEL[key] ?? ["off", key], items = key === "ok" ? [] : healthItems(h);
    // not OK: the tooltip says why (the same sentences as the « À surveiller » column)
    const title = items.length ? [label.charAt(0).toUpperCase() + label.slice(1), ...items.map((i) => `• ${i.text}`)].join("\n") : undefined;
    return <Badge tone={tone} title={title}>{label}</Badge>;
  }
  if (followed && !m.off) return <Badge tone="info" title={tx("Une source de santé existe (SSH, agent, Beszel ou Home Assistant) : la machine sera lue au prochain passage de la tâche Santé (Réglages → Tâches et horaires)")}>{tx("en attente du relevé")}</Badge>;
  if (m.off) return <Badge tone="off" title={tx("Éteinte volontairement, aucune alerte")}>{tx("éteinte")}</Badge>;
  if (m.ping === false) return <Badge tone="bad" title={tx("Ne répond pas au ping")}>{tx("hors ligne")}</Badge>;
  if (networkTool(m)) return <Badge tone="off" title={tx("Vue par {0} : en ligne, mais ses ressources (CPU, mémoire, disque) ne sont lues que par SSH, l'agent, Beszel ou Home Assistant", networkTool(m)!)}>{tx("Via {0}", networkTool(m)!)}</Badge>;
  return <Badge tone="off" title={tx("Pas de santé relevée : ni SSH, ni agent, ni Beszel, ni Home Assistant pour cette machine")}>{tx("non suivie")}</Badge>;
}

/** Services of a machine that are down, each with its problem: the tooltip of the red count */
function downOf(m: Machine, snap: Snapshot): string[] {
  return snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.enabled && status(r)[0] === "bad")
    .map((r) => [r.domains?.[0] || r.service?.name || [r.ip, r.port].join(":"), status(r)[2]].join(" : "));
}

/** Red count of the services down on a machine; what fails is in the tooltip */
function DownBadge({ m, snap }: Readonly<{ m: Machine; snap: Snapshot }>) {
  if (!m.down) return null;
  const list = downOf(m, snap);
  const tip = [tx("{0} en panne", m.down), ...list].join("\n");
  return <span className="rounded-md border border-bad/50 bg-bad/10 px-1.5 py-px text-[11px] font-semibold tabular-nums text-bad" title={tip}>{m.down}</span>;
}

/** Compact machine card: who, state, system, figures, servers and what to watch; « Details » unfolds the same detail as the table,
 *  the card then taking the whole row. A Home Assistant machine shows its add-on icons. */
function MachineCard({ m, h, snap, scan, os, watch, ha, unifi, off, state, shown, onToggle, onMachine, detail }: Readonly<{
  m: Machine; h?: HealthHost; snap: Snapshot; scan?: { os?: string; apps: string[]; ssh?: boolean }; os: OsKind | null; watch: WatchItem[]; ha?: ServiceStatus; unifi?: UnifiDevice;
  off: boolean; state: React.ReactNode; shown: boolean; onToggle: () => void; onMachine: (ip: string) => void; detail: React.ReactNode;
}>) {
  const up = uptimeOf(m, unifi, freeboxOf(m, snap.data.network));
  const edge = LEVEL_EDGE[levelKey(h)] ?? "";
  return (
    <div className={`flex flex-col gap-2.5 overflow-hidden rounded-xl border border-l-[3px] border-line bg-card p-3 transition-colors hover:border-link/50 ${edge} ${shown ? "col-span-full" : ""} ${off ? "opacity-50" : ""}`}>
      <div className="-mx-3 -mt-3 flex items-center gap-2.5 border-b border-line/60 bg-bg px-3 py-2.5">
        <MachineIcon m={{ ...m, model: modelOf(m, snap.data.network, unifi) }} scan={scan} reserve />
        <button type="button" onClick={() => onMachine(m.ip)} className="min-w-0 flex-1 text-left" title={tx("Voir ses services")}>
          <b className="block truncate font-semibold hover:text-link">{m.name}</b>
          <span className="block truncate font-mono text-[11px] text-dim">{m.ip}</span>
        </button>
        {state}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <SystemLine m={m} os={os} ha={ha} unifi={unifi} freebox={freeboxOf(m, snap.data.network)} />
        {up ? <span className="shrink-0 text-dim">· {tx("up")} {dur(up)}</span> : null}
        <UpdatesChip h={h} />
        {rolesOf(m.role).slice(0, 1).map((t) => <span key={t} className="ml-auto min-w-0 truncate rounded border border-line px-1.5 py-px text-[11px] text-dim" title={m.role}>{t}</span>)}
      </div>
      <ResStrip h={h} first={<Stat label={tx("Services")}><span className="inline-flex items-center gap-1"><b>{m.services}</b><DownBadge m={m} snap={snap} /></span></Stat>} />
      <div className="flex min-h-7 items-center justify-between gap-2">
        {ha?.addons?.length ? <AddonStrip s={ha} max={6} /> : <Servers m={m} snap={snap} max={4} />}   {/* Home Assistant: its add-ons stand for the servers */}
        <WatchList items={watch} />
      </div>
      <button type="button" onClick={onToggle} aria-expanded={shown} className="flex items-center gap-1.5 border-t border-line/60 pt-2 text-xs text-muted hover:text-txt">
        <ChevronRight size={13} className={`transition-transform ${shown ? "rotate-90" : ""}`} aria-hidden />{shown ? tx("Replier") : tx("Détails")}
      </button>
      {shown && <div className="-mx-3 -mb-3 border-t border-line/60 bg-bg2/40">{detail}</div>}
    </div>
  );
}

export function Machines({ snap, onMachine, onFilter, initial }: { snap: Snapshot; onMachine: (ip: string) => void; onFilter?: (sel: Selected) => void; initial?: Selected }) {
  // Health by IP: the health check's, completed by UniFi (through MynetworK) for the devices read no other way (the gateway…)
  const devices = useMemo(() => unifiDevices(snap.data.network), [snap.data.network]);
  const sysUnifi = useMemo(() => unifiSystem(snap.data.network), [snap.data.network]);
  const unifiNetwork = useMemo<UnifiNet>(() => ({ clients: (snap.data.network ?? []).flatMap((c) => c.unifi?.clients ?? []), devices }), [snap.data.network, devices]);
  const unifiOf = useCallback((m: Machine) => { const d = unifiDeviceOf(m, devices, sysUnifi); return d && withSystem(d, sysUnifi); }, [devices, sysUnifi]);
  const hb = useMemo(() => {
    const map = healthByIp(snap.health?.hosts);
    for (const m of snap.data.machine_list) {
      if (map.has(m.ip) || m.ssh || m.agent) continue;
      const d = unifiOf(m), fb = freeboxOf(m, snap.data.network);
      if (d) map.set(m.ip, unifiHealth(m, d));
      else if (fb) map.set(m.ip, freeboxHealth(m, fb));
    }
    return map;
  }, [snap.health, snap.data.machine_list, unifiOf]);
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
  const text = useCallback((m: Machine) => [m.name, m.ip, m.role, stateBadge(m)[1], m.ssh?.alias, m.ssh?.user, m.info?.os].join(" "), []);
  // « Ne plus suivre » se règle uniquement dans Réglages → Machines (interrupteur « Machine suivie ») ; ici, les machines non suivies restent masquées d'office.
  const isOff = (m: Machine) => !!m.disabled;
  // Machines non suivies : masquées d'office, un bouton les ramène (grisées)
  const [showOff, setShowOff] = useState(false);
  const [hideTools, setHideTools] = useStoredFlag("myservices.machines.hideSeenByTools", false);   // « Vus par vos outils, pas suivis ici »
  const nOff = snap.data.machine_list.filter(isOff).length;
  const items = useMemo(() => (showOff ? snap.data.machine_list : snap.data.machine_list.filter((m) => !isOff(m))), [snap.data.machine_list, showOff, isOff]);
  const f = useFilter(items, facets, text, initial);
  // Home Assistant running on this machine (its address points here): its add-ons in the unfolded detail
  const haOf = (m: Machine) => (snap.data.services_status ?? []).find((c) => c.connector === "home-assistant" && c.url && new URL(c.url).hostname === m.ip);
  const keyOf = useCallback((m: Machine, k: string): string | number => {
    switch (k) {
      case "state": return ORDER.indexOf(mState(m));
      case "os": return m.info?.os || "~";
      case "svc": return -m.services;
      case "health": return healthRank(m, hb.get(m.ip), !!(m.ssh || m.agent || haOf(m) || m.links?.sources.some((x) => x.source === "beszel"))) * 1e10 + ipNum(m.ip);   // les plus graves d'abord, puis par adresse
      case "up": return -(uptimeOf(m, unifiOf(m), freeboxOf(m, snap.data.network)) ?? -1);   // the longest up first
      case "watch": { const it = watchItems(m, hb.get(m.ip), snap.data.connectors ?? [], !!freeboxOf(m, snap.data.network) || !!unifiOf(m)); return -(worst(it) * 100 + it.length); }   // le plus grave d'abord
      default: return ipNum(m.ip);
    }
  }, [hb, snap.data.connectors, snap.data.services_status]);
  const sort = useSort(f.shown, keyOf, "ip");
  const watchOf = (m: Machine) => watchItems(m, hb.get(m.ip), snap.data.connectors ?? [], !!freeboxOf(m, snap.data.network) || !!unifiOf(m));
  // Tableau sur une seule ligne par machine ; un clic sur le chevron (ou « Tout déplier ») montre le détail
  const [detailIp, setDetailIp] = useState<string | null>(null);   // détail d'une machine : dans une fenêtre, plus de ligne qui se déplie
  const [editIp, setEditIp] = useState<string | null>(null);   // fenêtre de réglages d'une machine (engrenage, admin seulement)
  const admin = snap.me.role === "admin";
  const detailOf = (m: Machine) => {
    const h = hb.get(m.ip);
    return <Detail m={m} h={h} watch={watchOf(m)} mac={macOf(m)} net={seen.get(m.ip)} from={originsOf(m, snap, h, !!scanOs[m.ip]?.os, seen.has(m.ip))} servers={<Servers m={m} snap={snap} />} containers={<DockerList m={m} snap={snap} />} onFilter={onFilter} ha={haOf(m)} unifi={unifiOf(m)} unifiSys={unifiOf(m) ? sysUnifi : undefined} unifiNet={unifiNetwork} freebox={freeboxOf(m, snap.data.network)} />;
  };
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
  // Sources de lecture (SSH, agent, connecteurs), un badge court coloré par source ; la Freebox est lue par MynetworK (rapprochée par son nom)
  const st = (m: Machine, all: boolean) => {
    const fb = freeboxOf(m, snap.data.network) && snap.data.network?.find((c) => c.freebox?.system);
    return <SourceBadges all={all} m={m} extra={fb ? [{ type: fb.connector, name: fb.name, label: fb.label }] : []} />;
  };

  return (
    <div className="py-1">
      <FilterBar f={f} placeholder={tx("Nom, IP, rôle, système, compte SSH…")}
        options={[
          ...(nOff > 0 ? [{ id: "off", label: tx("Désactivées"), on: showOff, toggle: () => setShowOff(!showOff), mark: showOff ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />, count: nOff }] : []),
          ...(untracked.length > 0 ? [{ id: "tools", label: tx("Masquer « Vus par vos outils »"), on: hideTools, toggle: () => setHideTools(!hideTools), mark: <EyeOff size={12} aria-hidden />, count: untracked.length }] : []),
        ]}
        extra={<>
          <ViewToggle view={view} onPick={pickView} />
        </>} />
      {untracked.length > 0 && !hideTools && (
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
            <th className="w-10 px-2" aria-label={tx("Icône")} /><Th k="ip" sort={sort}>{tx("Machine")}</Th><Th k="state" sort={sort}>{tx("Sources")}</Th><Th k="os" sort={sort}>{tx("Système")}</Th>
            <Th k="svc" sort={sort}>{tx("Services")}</Th><Th k="watch" sort={sort}>{tx("Santé")}</Th>{snap.health && <><Th className="!px-1.5">{tx("CPU")}</Th><Th className="!px-1.5">{tx("Mémoire")}</Th><Th className="!px-1.5">{tx("Disque")}</Th></>}
            <Th k="up" sort={sort} className="w-px !pl-2 !pr-1 !text-right">{tx("En marche")}</Th>
            {admin && <th className="w-8 px-1" aria-label={tx("Réglages")} />}
          </>}>
            {sort.sorted.map((m) => {
              const h = hb.get(m.ip);
              return (
                <Fragment key={m.ip}>
                  <tr className={`cursor-pointer hover:bg-bg2/60 ${isOff(m) ? "opacity-50" : ""}`}
                    tabIndex={0} aria-haspopup="dialog" aria-label={tx("Détails de {0}", m.name)}
                    onClick={(e) => { if (!(e.target as Element).closest("button, a, input, select, label, summary, [role=button]")) setDetailIp(m.ip); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setDetailIp(m.ip); }}>   {/* toute la ligne ouvre le détail, sauf ses boutons et liens ; au clavier : Entrée sur la ligne */}
                    <td className="w-10 px-2 py-2 align-middle"><MachineIcon m={{ ...m, model: modelOf(m, snap.data.network, unifiOf(m)) }} scan={scanOs[m.ip]} reserve /></td>
                    <Td><span className="flex items-baseline gap-2"><b className="font-semibold">{m.name}</b><span className="text-xs text-dim">{m.ip}</span><ProblemFlag h={h} /></span></Td>   {/* the tools that see it (can be many): in the unfolded detail only */}
                    <Td>{st(m, false)}</Td>
                    <Td><div className="max-w-[11rem]"><SystemLine m={m} os={osOf(m)} ha={haOf(m)} unifi={unifiOf(m)} freebox={freeboxOf(m, snap.data.network)} /></div></Td>
                    <Td><span className="inline-flex items-center gap-1.5">
                      <button type="button" onClick={() => onMachine(m.ip)} title={tx("Voir ses services")} aria-label={tx("Voir les services de {0}", m.name)}
                        className="rounded-md px-1.5 py-0.5 hover:bg-link/10 hover:text-link"><span className="tabular-nums">{m.services}</span></button><DownBadge m={m} snap={snap} /></span></Td>
                    <Td><span className="flex flex-wrap items-center gap-1.5">   {/* one column: the level, then what explains it (the updates have their flag near the name) */}
                      {snap.health && <HealthLevel m={m} h={h} followed={!!(m.ssh || m.agent || haOf(m) || m.links?.sources.some((x) => x.source === "beszel"))} />}
                      <WatchList quiet={!!snap.health} items={watchOf(m).filter((i) => i.kind !== "updates")} /></span></Td>
                    {snap.health && <><Td className="!px-1.5"><MeterCell h={h} what="cpu" /></Td><Td className="!px-1.5"><MeterCell h={h} what="mem" /></Td><Td className="!px-1.5"><MeterCell h={h} what="disk" /></Td></>}
                    <Td className="w-px whitespace-nowrap !pl-2 !pr-1 text-right text-muted tabular-nums">{(() => { const up = uptimeOf(m, unifiOf(m), freeboxOf(m, snap.data.network)); return up ? dur(up) : <Dim>-</Dim>; })()}</Td>
                    {admin && <td className="w-8 px-1 py-2 align-middle"><button type="button" onClick={() => setEditIp(m.ip)} aria-label={tx("Réglages de {0}", m.name)} title={tx("Réglages de cette machine")}
                      className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt"><Settings2 size={14} aria-hidden /></button></td>}
                  </tr>
                </Fragment>
              );
            })}
          </Table>}
          <Cards always={view === "cards"} dense>
            {sort.sorted.map((m) => {
              const h = hb.get(m.ip);
              return (
                <MachineCard key={m.ip} m={m} h={h} snap={snap} scan={scanOs[m.ip]} os={osOf(m)} watch={watchOf(m)} ha={haOf(m)} unifi={unifiOf(m)} off={isOff(m)}
                  state={st(m, false)} shown={false} onToggle={() => setDetailIp(m.ip)} onMachine={onMachine}
                  detail={null} />
              );
            })}
          </Cards>
        </>
      )}
      {detailIp && (() => {
        const m = snap.data.machine_list.find((x) => x.ip === detailIp);
        return m && <Overlay wide onClose={() => setDetailIp(null)} title={<><MachineIcon m={{ ...m, model: modelOf(m, snap.data.network, unifiOf(m)) }} scan={scanOs[m.ip]} reserve />{m.name} <Dim>{m.ip}</Dim>{m.services > 0 && <button type="button" onClick={() => onMachine(m.ip)} className={`${quiet} ml-2 py-1 text-sm font-normal`}>{tx("Voir ses services")}<ArrowRight size={14} aria-hidden /></button>}</>}><div className="mt-3 -mx-4 -mb-4 overflow-hidden rounded-b-2xl bg-bg2/40">{detailOf(m)}</div></Overlay>;
      })()}
      {editIp && <MachineModal ip={editIp} snap={snap} onClose={() => setEditIp(null)} />}
    </div>
  );
}
