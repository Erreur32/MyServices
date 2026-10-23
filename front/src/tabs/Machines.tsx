// Machines : accès (ping, SSH), système, serveurs (NPM, Apache, Docker), services et santé de chaque machine.
import { Archive, Plus, Puzzle, FolderOpen, Bot, Box, Copy, Cpu, Crosshair, ArrowUpCircle, Boxes, Bug, Check, ChevronDown, ChevronRight, ChevronUp, Container, Clock, Database, Eye, EyeOff, FolderSync, Gauge, Globe, HardDrive, HeartPulse, IdCard, Info, KeyRound, Layers, MemoryStick, Plug, RefreshCw, RotateCw, ScanSearch, SlidersHorizontal, ServerCrash, ShieldAlert, Thermometer, Timer, Unplug, WifiOff, Workflow, type LucideIcon } from "lucide-react";
import { Fragment, createContext, useContext, useRef, useCallback, useEffect, useMemo, useState } from "react";
import { read, type Snapshot } from "../api";
import { Copyable } from "../components/form";
import { useFilter, useSort, type Facet, type Selected } from "../lib/filter";
import { ageDays, bytes, dateTime, dur, durShort, ipNum, isDate, splitHostName } from "../lib/format";
import { machineFigures, shortProbe } from "../lib/machineFigures";
import { hostName, status } from "../lib/status";
import { modelService } from "../lib/modelService";
import { SwitchPanel } from "./UnifiCards";
import type { AddressSheet, Backups, LinkSource, HealthHost, Host, HostSystem, Machine, MachineLinks, NetDevice, NetScan, NetworkConnector, FreeboxInfo, ServiceStatus, UnifiDevice, UnifiSystem } from "../types";
import { AddonStrip, HaAddons } from "../components/ServiceStatusCards";
import { unifiDeviceOf, unifiDevices, unifiHealth, unifiSystem, withSystem } from "../lib/unifi";
import { freeboxHealth, freeboxOf } from "../lib/freebox";
import { appIcon, modelIcon } from "../lib/appIcons";
import { MachinePage } from "./MachinePage";
import { machineFromHash } from "../lib/machineHash";
import { MSTATE, ORDER, OS_LABEL, OS_ORDER, mState, networkTool, osOfMachine, stateBadge, type MState, type OsKind } from "../lib/machines";
import { OsGlyph } from "../components/OsGlyph";
import { shortOs } from "../lib/osName";
import { ViewToggle, useStoredView } from "../components/ViewToggle";
import { Dot } from "../components/marks";
import { LEVEL } from "../lib/level";
import { rolesOf } from "../lib/ssh";
import { tipAction } from "../lib/tip";
import { isHidden, useServicesHidden, type HiddenMap } from "../lib/servicesHidden";
import { SshAccess } from "../components/ssh";
import { SourceBadges } from "../components/SourceBadges";
import { DetailRow, DetailSection } from "../components/DetailSection";
import { ContainerList, SitePaths, WebServersTable, modeLabel } from "../components/WebServers";
import { veeamOf, type VeeamRow } from "../lib/veeamMachines";
import { primary, quiet } from "../lib/forms";
import { SHARE_STATE, UU_STALE_DAYS, WATCH_SECTION, ZFS_BAD, healthItems, kernelLine, watchItems, worst, type WatchItem, type WatchKind, type WatchTone } from "../lib/machineWatch";
import { MachineIcon } from "../components/MachineIcon";
import { Badge, Cards, Dim, Empty, Fill, FilterBar, GradientFill, Level, Pct, Table, Td, Th, type Tone } from "../components/ui";
import { tx } from "../lib/i18n";
import { hardwareRows } from "../lib/hardware";


/** Opens the page of a machine (#machines/<ip>), or its settings page (#machines/<ip>/settings) */
function openPage(ip: string, tab?: "settings"): void {
  location.hash = `machines/${ip}${tab ? "/settings" : ""}`;
}

function healthByIp(hosts: HealthHost[] = []): Map<string, HealthHost> {
  return new Map(hosts.map((h) => [splitHostName(h.name)[1], h]));
}

function topDisk(h?: HealthHost) {
  return (h?.disks || []).reduce<NonNullable<HealthHost["disks"]>[number] | null>((a, d) => (!a || d.used_pct > a.used_pct ? d : a), null);
}

/** Web servers of the machine (NPM, Anubis, Apache, nginx…) then Docker, as icons; each tooltip lists the instances (port, how it runs,
 *  what it forwards to). max: beyond, a « +N » chip (the full list is in the unfolded detail) */
/** One web server in the tooltip of its chip: ports, how it runs, where it sends to, its vhosts and whether it is stopped */
function webLine(w: NonNullable<Machine["web"]>[number]): string {
  const ports = w.ports.map((p) => ":" + p).join(" ") || "-";
  const behind = w.behind ? " → " + (w.behind.name ?? w.behind.addr) : "";
  const vhosts = w.vhosts ? " · " + tx("{0} vhost(s)", w.vhosts) : "";
  const stopped = w.up ? "" : " · " + tx("arrêté");
  return `${ports}  ${modeLabel(w.mode)} · ${w.name}${behind}${vhosts}${stopped}`;
}

function Servers({ m, snap, max }: { m: Machine; snap: Snapshot; max?: number }) {
  const apDown = snap.data.hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.enabled && r.service?.kind === "apache" && status(r)[0] === "bad").length;
  const i = m.info || {}, groups = new Map<string, NonNullable<Machine["web"]>>();
  for (const w of m.web ?? []) groups.set(w.key, [...(groups.get(w.key) ?? []), w]);
  const chips: { key: string; icon: string | null; label: string; tip: string; bad?: boolean }[] = [...groups].map(([key, ws]) => {
    const stopped = ws.filter((w) => !w.up).length, down = stopped + (key === "apache" ? apDown : 0);
    const head = [ws[0].label, ws.length > 1 ? tx("{0} instances", ws.length) : "", stopped ? tx("{0} arrêtée(s)", stopped) : "", key === "apache" && apDown ? tx("{0} en panne", apDown) : ""].filter(Boolean).join(" · ");
    const lines = ws.map(webLine);
    return { key, icon: appIcon([ws[0].label]), label: ws[0].label, tip: [head, ...lines].join("\n"), bad: down > 0 };
  });
  if (i.docker) chips.push({ key: "docker", icon: appIcon(["Docker"]), label: "Docker", tip: tx("Docker : {0} conteneur(s) en cours", i.docker) });
  const shown = max && chips.length > max ? chips.slice(0, max) : chips, more = chips.slice(shown.length);
  return chips.length ? (
    <div className={`flex items-center gap-1 ${max ? "flex-nowrap" : "flex-wrap"}`}>
      {shown.map((c) => (
        <span key={c.key} title={c.tip} tabIndex={0} className={`grid h-7 w-7 place-items-center rounded-md border ${c.bad ? "border-bad/60 bg-bad/10" : "border-line bg-bg2"}`}>
          {c.icon ? <img src={c.icon} alt="" className="h-4 w-4" /> : <span className="text-[11px] font-bold text-muted">{c.label.slice(0, 2)}</span>}
        </span>
      ))}
      {more.length > 0 && <span title={tx("Aussi : {0} (détail déplié)", more.map((c) => c.label).join(", "))} className="grid h-7 min-w-7 place-items-center rounded-md border border-line bg-bg2 px-1 text-[11px] font-bold text-muted">+{more.length}</span>}
    </div>
  ) : <Dim>-</Dim>;
}

/** Clé utilisée par l'alias (chemin et début d'empreinte) */
function KeyCell({ m }: { m: Machine }) {
  const s = m.ssh;
  if (!s) return <Dim>-</Dim>;
  if (!s.identity) return <Dim>{tx("aucune (accès manuel)")}</Dim>;
  return <div className="flex flex-col"><code className="break-all text-xs">{s.identity}</code>{s.key_fp && <span className="break-all font-mono text-[11px] text-dim">{s.key_fp}</span>}</div>;
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
  return <b className={tone} title={what === "mem" && h.res?.mem_total_mb ? `${((h.res.mem_used_mb ?? 0) / 1024).toFixed(1)} / ${(h.res.mem_total_mb / 1024).toFixed(1)} Go` : undefined}><Pct value={Math.round(v)} /></b>;
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
    <div className="w-[7rem]" title={title}>
      <div className="flex items-baseline justify-between gap-1 leading-tight">
        <span className={`shrink-0 text-xs ${METER_TEXT[tone]}`}><Pct value={Math.round(pct)} unit={unit} /></span>
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
  pm2: Workflow, raid: Layers, zfs: Database, mounts: FolderSync, ntp: Clock, timers: Timer, auto_upd: RefreshCw,
};
const WATCH_STYLE: Record<WatchTone, string> = { bad: "border-bad/60 bg-bad/15 text-bad", warn: "border-warn/60 bg-warn/15 text-warn", info: "border-link/50 bg-link/10 text-link" };

/** « À surveiller » : une pastille-icône par sujet, rouge (grave), orange (à regarder) ou bleue (à savoir) ; le détail est dans l'info-bulle. Rien : une coche discrète. */
const DOT_COLOR: Record<WatchTone, string> = { bad: "bg-bad", warn: "bg-warn", info: "bg-link" };
const TONE_OF_RANK: WatchTone[] = ["info", "info", "warn", "bad"];   // RANK 1..3 -> tone

/** A coloured dot on the corner of a machine's icon, the colour of its worst notice (red, yellow, blue): the same notices as the badges of the "To watch" column */
function AlertDot({ items, children }: Readonly<{ items: WatchItem[]; children: React.ReactNode }>) {
  const w = worst(items);
  if (!w) return <>{children}</>;
  const tone = TONE_OF_RANK[w], n = items.filter((i) => i.tone === tone).length;
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      <span className={`absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-card ${DOT_COLOR[tone]}`} title={`${tone === "bad" ? tx("problème à regarder") : tx("à surveiller")} : ${n}\n${items.map((i) => [i.text, ...(i.detail ?? []).slice(0, 3).map((d) => `   ${d}`)].join("\n")).join("\n")}`} />
    </span>
  );
}

/** The tooltip of a notice, in the tooltip layer's own layout: its sentence as the heading, the messages behind it as code lines (time dimmed), then a hint */
const MAX_TIP_LINES = 6;
const plain = (t: string) => t.replace(/[`*[\]]/g, "").slice(0, 120);
function watchTip(it: WatchItem, hint?: string): string {
  const all = it.detail ?? [], lines = all.slice(0, MAX_TIP_LINES).map((l) => {
    if (it.kind !== "kernel") return `\`${plain(l)}\``;
    const { when, msg } = kernelLine(l);
    return `${when ? `[[off:${plain(when)}]] ` : ""}\`${plain(msg)}\``;
  });
  const more = all.length > MAX_TIP_LINES ? [tx("… et {0} autres", all.length - MAX_TIP_LINES)] : [];
  return [it.text, ...lines, ...more, ...(hint ? [tipAction(hint)] : [])].join("\n");
}

/** A virtual machine (Proxmox / ESXi guest, flagged or seen by the health check): a small cube beside its name */
const isVm = (m: Machine, h?: HealthHost): boolean => !!(m.links?.guest || m.detected?.includes("vm") || h?.smart?.vm || h?.temp?.virt);
/** The name of a virtual machine is underlined with dashes, its cube in front */
const vmName = (m: Machine, h?: HealthHost): string => (isVm(m, h) ? "underline decoration-link/70 decoration-dashed underline-offset-4" : "");
function VmMark({ m, h }: Readonly<{ m: Machine; h?: HealthHost }>) {
  if (!isVm(m, h)) return null;
  const g = m.links?.guest;
  const tip = g ? `${tx("Machine virtuelle")}\n${g.type === "lxc" ? tx("conteneur LXC") : "VM"} ${g.vmid} ${tx("sur")} ${g.node}` : tx("Machine virtuelle");
  return <span className="inline-grid h-5 w-5 shrink-0 place-items-center rounded border border-link/50 bg-link/10 text-link" title={tip} tabIndex={0}><Box size={12} aria-hidden /></span>;
}

/** GPUs of a machine: those GpuViewR reads (load, temperature, memory, power, last 24 h, the AI models on each), else the names the Windows agent lists in its hardware, else lspci over SSH (iGPU included, none shown when nothing is found).
 *  Load, temperature and memory come from GpuViewR, else from nvidia-smi / rocm-smi (SSH or Linux agent). */
type GpuModel = NonNullable<LinkSource["models"]>[number];
type GpuCell = { name: string; util?: number | null; temp?: number | null; memUsed?: number | null; memTotal?: number | null; power?: number | null; day?: NonNullable<LinkSource["gpus"]>[number]["day"]; models: GpuModel[] };
function gpusOf(m: Machine, h?: HealthHost): GpuCell[] {
  const src = m.links?.sources.find((x) => x.source === "gpuviewr"), read = src?.gpus ?? [];
  if (read.length) return read.map((g, i) => ({ name: g.name ?? "GPU", util: g.util, temp: g.temp, memUsed: g.mem_used, memTotal: g.mem_total, power: g.power, day: g.day,
    models: (src?.models ?? []).filter((x) => x.gpu === i || (x.gpu == null && read.length === 1)) }));
  if (h?.gpu?.available) return h.gpu.gpus.map((g) => ({ name: g.name, util: g.util, temp: g.temp, memUsed: g.mem_used, memTotal: g.mem_total, power: g.power, models: [] }));   // nvidia-smi / rocm-smi
  const names = m.agent?.hardware?.gpu?.map((g) => g.name) ?? m.info?.gpus ?? [];   // the Windows agent's list, else lspci over SSH (Linux, Proxmox): names only
  return names.map((name) => ({ name, models: [] }));
}
const shortGpu = (n: string): string => n.replace(/^(NVIDIA|AMD|Intel\(R\))\s+/i, "").replace(/^(GeForce|Radeon)\s+/i, "").replace(/\s*\(TM\)|\s*\(R\)/gi, "").trim();
const gb = (mb: number): string => `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} ${tx("Go")}`;

/** The tooltip of a GPU, in the tooltip layer's layout (dark heading, then label / value rows by block): now, the last 24 h, the AI models running on it.
 *  Values get the state colour (temperature from 80 °C, load or memory from 90 %). */
function gpuTip(g: GpuCell): string {
  const tone = (v: number, warn: number, bad: number, text: string) => (v >= bad ? `[[bad:${text}]]` : v >= warn ? `[[warn:${text}]]` : text);
  const row = (k: string, v: string | false | null | undefined) => (v ? `${k}\t${v}` : "");
  const block = (title: string, rows: string[]) => (rows.some(Boolean) ? [`\n[[off:${title}]]`, ...rows.filter(Boolean)] : []);
  const d = g.day, memPct = g.memTotal ? (100 * (g.memUsed ?? 0)) / g.memTotal : null;
  const now = [
    row(tx("Charge"), g.util != null && tone(g.util, 90, 98, `${Math.round(g.util)} %`)),
    row(tx("Température"), g.temp != null && tone(g.temp, 80, 85, `${Math.round(g.temp)} °C`)),
    row(tx("Mémoire"), g.memTotal ? `${gb(g.memUsed ?? 0)} / ${gb(g.memTotal)} (${tone(memPct ?? 0, 90, 98, `${Math.round(memPct ?? 0)} %`)})` : false),
    row(tx("Puissance"), g.power != null && `${Math.round(g.power)} W`),
  ];
  const day = d ? [
    row(tx("Charge"), d.util_avg != null && tx("moyenne {0} %, max {1} %", Math.round(d.util_avg), Math.round(d.util_max ?? d.util_avg))),
    row(tx("Température"), d.temp_max != null && tone(d.temp_max, 80, 85, tx("max {0} °C", Math.round(d.temp_max)))),
    row(tx("Mémoire"), d.mem_max != null && tx("max {0}", gb(d.mem_max))),
    row(tx("Puissance"), d.pow_avg != null && tx("{0} W en moyenne", Math.round(d.pow_avg))),
  ] : [];
  const models = g.models.map((x) => `**${x.model ?? "?"}**\t${[x.runtime, x.port ? tx("port {0}", x.port) : "", x.state === "idle" ? tx("au repos") : x.state, x.mem_mb ? gb(x.mem_mb) : ""].filter(Boolean).join(" · ")}`);
  return [g.name, ...block(tx("Maintenant"), now), ...block(tx("24 dernières heures"), day), ...block(tx("Modèles IA"), models)].join("\n");
}

/** GPU column cell: the column takes the spare width of the table, so the name stays whole; load and temperature after it, then memory, power and the AI model on the second line (24 h in the tooltip) */
function GpuCellView({ list }: Readonly<{ list: GpuCell[] }>) {
  if (!list.length) return <Dim>-</Dim>;
  return (
    <span className="flex max-w-[18rem] flex-col gap-1">
      {list.map((g, i) => (
        <span key={`${g.name}-${i}`} className="flex flex-col text-xs leading-tight" title={gpuTip(g)} tabIndex={0}>
          <span className="flex items-baseline gap-2">
            <span className="truncate font-medium">{shortGpu(g.name)}</span>
            {g.util != null && <span className="shrink-0 text-muted"><Pct value={Math.round(g.util)} /></span>}
            {g.temp != null && <span className={`shrink-0 ${heatClass(g.temp)}`}><Pct value={Math.round(g.temp)} unit="°C" /></span>}
          </span>
          {g.util != null && <span className="my-0.5 block h-1.5 w-[7rem] overflow-hidden rounded-full bg-bg2"><GradientFill pct={g.util} /></span>}
          {(g.memTotal || g.power != null || g.models.length > 0) && (
            <span className="flex items-center gap-2 text-[11px] text-dim">
              {g.memTotal ? <span className="shrink-0 tabular-nums">{gb(g.memUsed ?? 0)} / {gb(g.memTotal)}</span> : null}
              {g.power != null && <span className="shrink-0 tabular-nums">{Math.round(g.power)} W</span>}
              {g.models.length > 0 && <span className="flex items-center gap-1 text-link"><Bot size={11} className="shrink-0" aria-hidden /><span className="truncate">{g.models.map((x) => x.model).join(", ")}</span></span>}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** Kernel errors set aside by the viewer, per machine: hidden until a more recent message appears (kept in this browser only) */
const KernelIgnore = createContext<{ ignored: Record<string, string>; set: (id: string, sig: string | null) => void }>({ ignored: {}, set: () => undefined });
const KERNEL_KEY = "ms.machines.kernelIgnored";
const kernelSig = (samples: string[] = []): string => samples[samples.length - 1] ?? "";

/** Asks the machines page to open a machine window at the section that explains a notice (null outside the page) */
const PickWatch = createContext<((ip: string, kind: WatchKind) => void) | null>(null);

function WatchList({ items, wrap = false, quiet = false, ip }: Readonly<{ items: WatchItem[]; wrap?: boolean; quiet?: boolean; ip?: string }>) {   // quiet : rien à dire = rien d'affiché (le badge de niveau le dit déjà)   // wrap : libellé « Rien à surveiller » écrit en toutes lettres (fiches)   // ip : a click on a badge opens that machine's window at the section of the notice
  const pick = useContext(PickWatch);
  if (!items.length && quiet) return null;
  if (!items.length) return <span className="inline-flex items-center gap-1 text-xs text-ok" title={tx("Rien à surveiller")}><Check size={14} aria-hidden />{wrap && tx("Rien à surveiller")}</span>;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label={tx("À surveiller")}>{/* tout est montré, jamais caché : les pastilles passent à la ligne */}
      {items.map((it) => {
        const Icon = WATCH_ICON[it.kind], cls = `grid h-6 w-6 shrink-0 place-items-center rounded-md border ${WATCH_STYLE[it.tone]}`;
        return (
          <li key={`${it.kind}:${it.text}`} className="flex">
            {ip && pick
              ? <button type="button" title={watchTip(it, tx("Clic sur la pastille : la fiche, à cet endroit"))} aria-label={it.text} onClick={() => pick(ip, it.kind)} className={`${cls} hover:brightness-125`}><Icon size={14} aria-hidden /></button>
              : <span role="img" title={watchTip(it)} aria-label={it.text} className={cls}><Icon size={14} aria-hidden /></span>}
          </li>
        );
      })}
    </ul>
  );
}
/** Scrolls the machine window to what explains a notice (the exact row when there is one, else its section) and makes it flash */
function showWatch(root: HTMLElement | null, kind: WatchKind) {
  const el = root?.querySelector<HTMLElement>(`[data-watch="${kind}"]`) ?? root?.querySelector<HTMLElement>(`[data-sec="${WATCH_SECTION[kind]}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("ring-2", "ring-warn", "animate-pulse");
  setTimeout(() => el.classList.remove("ring-2", "ring-warn", "animate-pulse"), 2600);
}
const WATCH_SMALL_KEY = "ms.machine.watch.small";

function WatchSummary({ items, onShow }: { items: WatchItem[]; onShow?: (kind: WatchKind) => void }) {
  const [small, setSmall] = useState(() => { try { return localStorage.getItem(WATCH_SMALL_KEY) === "1"; } catch { return false; } });   // reduced to its title line, kept by this browser
  const pick = (v: boolean) => { setSmall(v); try { localStorage.setItem(WATCH_SMALL_KEY, v ? "1" : "0"); } catch { /* storage refused: the choice lasts this visit */ } };
  if (!items.length) return null;   // nothing to watch: no block
  const count = (t: WatchTone) => items.filter((i) => i.tone === t).length;
  return (
    <section aria-label={tx("À surveiller")} className={`rounded-xl border p-3 text-sm ${worst(items) >= 2 ? "border-warn/40 bg-warn/5" : "border-line bg-card"}`}>
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-dim">
        <Eye size={13} aria-hidden />{tx("À surveiller")}
        <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">
          {(["bad", "warn", "info"] as WatchTone[]).filter(count).map((t) => <Badge key={t} tone={t === "info" ? "info" : t}>{count(t)}</Badge>)}
          <button type="button" onClick={() => pick(!small)} aria-expanded={!small} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-bg2 hover:text-txt">
            {small ? <><ChevronDown size={13} aria-hidden />{tx("Afficher")}</> : <><ChevronUp size={13} aria-hidden />{tx("Réduire")}</>}
          </button>
        </span>
      </h3>
      {!small && <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((it, i) => {
          const Icon = WATCH_ICON[it.kind];
          return (
            <li key={i} className={`flex gap-2 ${it.detail?.length ? "items-start" : "items-center"}`}>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${WATCH_STYLE[it.tone]}`}><Icon size={13} aria-hidden /></span>
              <span className="min-w-0 flex-1 text-muted">{it.text}
                {it.detail?.length ? <KernelLines lines={it.detail.slice(0, 4)} /> : null}
              </span>
              {onShow && <button type="button" onClick={() => onShow(it.kind)} title={tx("Voir où dans cette fenêtre")} aria-label={tx("Voir où dans cette fenêtre")} className="shrink-0 rounded p-1 text-dim hover:text-txt"><Crosshair size={13} aria-hidden /></button>}
            </li>
          );
        })}
      </ul>}
    </section>
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

/** Where the OS of the machine was read: SSH, the MyServices agent or the network search */
function osOrigins(m: Machine, here: string, scanned: boolean): Origin[] {
  if (m.info?.os && m.info.via !== "agent") return [{ label: "SSH", href: here }];
  if (m.info?.os || m.agent) return [{ label: tx("agent MyServices"), href: `#settings/agents/${m.ip}` }];
  return scanned ? [{ label: tx("recherche réseau"), href: "#settings/network" }] : [];
}

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
    os: osOrigins(m, here, scanned),
    services: [...(m.npm ? [{ label: "NPM", href: connectors }] : []), ...linked(["docker", "process", "adguard"]),
               ...(m.api ?? []).map((a) => ({ label: a.label, ok: a.ok || !!a.stale, tip: `${a.name} : ${a.message ?? ""}`, href: connectors }))],
    health,
  };
}

function From({ list }: { list: Origin[] }) {
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs font-normal text-dim">
      {list.map((o, n) => {
        const tip = o.tip ?? (o.href ? tx("Ouvrir les réglages de cette source") : undefined), look = o.ok === false ? "text-bad" : "";
        const label = o.href ? <a href={o.href} title={tip} className={`hover:text-link hover:underline ${look}`}>{o.label}</a> : <span title={tip} className={look}>{o.label}</span>;
        return <span key={o.label}>{n > 0 && "· "}{label}</span>;
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

/** Where UniFi sees the address plugged: the switch and its port, or the access point for a Wi-Fi client */
function PlugLine({ u }: { u: NonNullable<AddressSheet["unifi"]> }) {
  if (u.wired) return <span><b>{u.switch_name ?? tx("switch")}</b>{u.switch_port != null && <> · {tx("port {0}", u.switch_port)}</>}<Dim> · {tx("filaire")}{u.switch_ip ? ` · ${u.switch_ip}` : ""}{u.switch_model ? ` · ${u.switch_model}` : ""}</Dim></span>;
  return <span><b>{u.ap_name ?? "Wi-Fi"}</b><Dim> · Wi-Fi{u.ap_model ? ` · ${u.ap_model}` : ""}</Dim></span>;
}

/** The scalar fields of a Freebox record, « key: value » (the shape is the box's own: nothing is assumed beyond that) */
const factsOf = (o: Record<string, unknown>): string => Object.entries(o).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) && v !== "").slice(0, 5).map(([k, v]) => `${k}: ${String(v)}`).join(" · ");

/** A port redirection of the Freebox: « tcp 2222 → 22 », else its fields */
function forwardText(f: Record<string, unknown>): string {
  const wan = f.wan_port_start ?? f.wan_port, lan = f.lan_port, proto = f.ip_proto ?? f.protocol;
  return wan != null && lan != null ? `${proto ? `${String(proto)} ` : ""}${String(wan)} → ${String(lan)}${f.comment ? ` · ${String(f.comment)}` : ""}` : factsOf(f);
}

/** « VM 101 sur pve » / « nœud Proxmox pve » */
function Virt({ links, version }: { links?: MachineLinks | null; version?: string }) {
  const g = links?.guest, n = links?.hypervisor;
  if (g) return <>{g.type === "lxc" ? tx("conteneur LXC") : "VM"} {g.vmid} {tx("sur")} <b>{g.node}</b>{g.status && g.status !== "running" && <Dim> · {g.status}</Dim>}</>;
  if (n) return <>{n.source === "proxmox" || !n.source ? tx("nœud Proxmox") : tx("hôte VMware ESXi")} <b>{n.node}</b>{version && <Dim> · {tx("version")} {version}</Dim>}</>;
  return null;
}


/** Rubrique du détail, avec d'où viennent ses données à droite de la bande de titre */
function Section({ icon, title, tone, from, sec, children }: { sec?: string; icon: typeof Info; title: string; tone: "link" | "violet" | "ok" | "warn" | "bad"; from?: Origin[]; children: React.ReactNode }) {
  return <DetailSection sec={sec} icon={icon} title={title} tone={tone} right={from?.length ? <From list={from} /> : undefined}>{children}</DetailSection>;
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

/** Fields in console mode: a dark framed block, monospace, one line per entry (the same look as the kernel log); `cols` lays several columns out on a grid */
function ConsoleBox({ children, cols }: Readonly<{ children: React.ReactNode; cols?: string }>) {
  return <span className={`${cols ? "grid gap-x-3" : "flex flex-col"} gap-y-0.5 overflow-x-auto rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-[11px] leading-snug`} style={cols ? { gridTemplateColumns: cols } : undefined}>{children}</span>;
}

/** The kernel messages of a machine, as a framed log of its own across the whole section: the time in a dim column, the message wrapped, scrolling past a dozen lines */
function KernelLines({ lines, tall = false }: Readonly<{ lines: string[]; tall?: boolean }>) {
  return (
    <span className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-y-auto rounded-md border border-warn/40 bg-bg px-2.5 py-2 font-mono text-[11px] leading-snug ${tall ? "max-h-60" : "max-h-32"}`}>
      {lines.map((l, i) => {
        const { when, msg } = kernelLine(l);
        return <Fragment key={i}><span className="whitespace-nowrap text-dim">{when}</span><span className="break-words text-muted">{msg}</span></Fragment>;
      })}
    </span>
  );
}

/** « Kernel errors » block of the Health section: what it is, how many, the log, and a button to copy it (to paste into a report or a search) */
function KernelBlock({ id, lines }: Readonly<{ id: string; lines: string[] }>) {
  const [copied, setCopied] = useState(false);
  const { ignored, set } = useContext(KernelIgnore);
  const sig = kernelSig(lines);
  if (ignored[id] === sig) {
    return (
      <div data-watch="kernel" className="my-1 flex flex-wrap items-center gap-2 rounded-md border border-line/60 px-2.5 py-1.5 text-muted">
        <Bug size={14} aria-hidden /><span>{tx("Erreurs noyau ignorées (plus récentes que ce message : elles reviendront)")}</span>
        <button type="button" onClick={() => set(id, null)} className="ml-auto rounded-md border border-line px-1.5 py-0.5 text-[11px] hover:border-link hover:text-txt">{tx("Réactiver")}</button>
      </div>
    );
  }
  const copy = () => { navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); };
  return (
    <div data-watch="kernel" className="my-1 flex flex-col gap-1.5 rounded-md border border-warn/40 bg-warn/5 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Bug size={14} className="text-warn" aria-hidden />
        <b className="text-warn">{tx("Erreurs noyau")}</b><Badge tone="warn">{lines.length}</Badge>
        <Dim>{tx("sur 12 h, relevées par journalctl -k")}</Dim>
        <button type="button" onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-link hover:text-txt" title={tx("Copier ces messages")}>
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}{copied ? tx("Copié") : tx("Copier")}
        </button>
        <button type="button" onClick={() => set(id, sig)} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-link hover:text-txt" title={tx("Cacher ces erreurs, déjà réglées : elles reviennent si un message plus récent apparaît")}>
          <EyeOff size={12} aria-hidden />{tx("Ignorer")}
        </button>
      </div>
      <KernelLines lines={lines} tall />
      <Dim>{tx("Un message isolé n'est pas toujours grave ; plusieurs lignes de disque, mémoire ou réseau qui se répètent méritent un coup d'œil.")}</Dim>
    </div>
  );
}

/** Readings side by side, one small box each (name, then value), in name order: easier to tell apart than a line of values */
export function ProbeChips({ items }: Readonly<{ items: { name: string; full?: string; value: string; tone: string; dim?: boolean }[] }>) {
  const sorted = [...items].sort((a, b) => (a.full ?? a.name).localeCompare(b.full ?? b.name, undefined, { numeric: true }));
  return (
    <span className="flex flex-wrap gap-1.5">
      {sorted.map((x) => (
        <span key={x.full ?? x.name} title={x.full} className={`inline-flex items-baseline gap-1.5 rounded-md border border-line/60 bg-bg2/40 px-1.5 py-0.5 ${x.dim ? "opacity-50" : ""}`}>
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

const LOG_BIG_MB = 1000;   // a log file over 1 GB is worth a look (rotation missing?)
const sizeText = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} ${tx("Go")}` : `${mb} ${tx("Mo")}`;

/** A compact two-column table inside a line of a card: a name (never cut) and its value on the right, in the colour of its state */
function MiniTable({ rows }: Readonly<{ rows: { name: string; value: string; tone?: string; dim?: boolean }[] }>) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className={`border-t border-line/40 first:border-t-0 ${r.dim ? "text-dim" : ""}`}>
            <td className="py-0.5 pr-3 font-mono [overflow-wrap:anywhere]">{r.name}</td>
            <td className={`whitespace-nowrap py-0.5 text-right tabular-nums ${r.tone ?? ""}`}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BigLogsRow({ logs }: Readonly<{ logs: NonNullable<HealthHost["logs"]> }>) {
  const files = [...logs.files.map((f) => ({ name: f.path.replace("/var/log/", ""), mb: f.mb, warn: f.mb >= LOG_BIG_MB }))];
  if (logs.journal_mb) files.push({ name: "journal (systemd)", mb: logs.journal_mb, warn: logs.journal_mb >= 4 * LOG_BIG_MB });
  const rows = files.sort((a, b) => b.mb - a.mb).map((f) => ({ name: f.name, value: sizeText(f.mb), tone: f.warn ? "text-warn" : "" }));
  return <DetailRow k={tx("Gros journaux")} title={tx("Gros journaux")}><MiniTable rows={rows} /></DetailRow>;
}

const SHARE_TONE: Record<string, string> = { ok: "text-ok", hang: "text-bad", error: "text-warn", missing: "text-warn" };
type RaidArray = NonNullable<NonNullable<HostSystem["raid"]>["arrays"]>[number];
function raidState(a: RaidArray): string {
  if (a.rebuild) return `${a.rebuild.kind} ${a.rebuild.pct} %`;
  return a.degraded ? tx("dégradé") : tx("sain");
}
function raidTone(a: RaidArray): string {
  if (a.degraded && !a.rebuild) return "text-bad";
  return a.degraded || a.rebuild ? "text-warn" : "text-ok";
}
function zfsTone(health: string): string {
  if (health === "ONLINE") return "text-ok";
  return ZFS_BAD.includes(health) ? "text-bad" : "text-warn";
}

/** Services and storage of a Linux machine (PM2, RAID, ZFS, network shares, clock, timers, open sessions): a row each, only for what the machine has */
function SystemRows({ s }: Readonly<{ s: HostSystem }>) {
  const pm2 = s.pm2;
  const pm2Items = pm2?.available ? [
    ...(pm2.units ?? []).filter((u) => u.enabled).map((u) => ({ name: u.unit.replace(/\.service$/, ""), value: u.active ? tx("en marche") : tx("arrêté"), tone: u.active ? "text-ok" : "text-warn" })),
    ...(pm2.home && !(pm2.units ?? []).length ? [{ name: tx("compte"), value: pm2.running ? tx("en marche") : tx("arrêté"), tone: pm2.running ? "text-ok" : "text-dim" }] : []),
    ...(pm2.apps ?? []).map((a) => ({ name: a.name, value: a.up ? tx("en marche") : tx("arrêtée"), tone: a.up ? "text-ok" : "text-warn" })),
  ] : [];
  const raid = (s.raid?.arrays ?? []).map((a) => ({ name: [a.name, a.level].filter(Boolean).join(" "), value: [raidState(a), a.members].filter(Boolean).join(" · "), tone: raidTone(a) }));
  const zfs = (s.zfs?.pools ?? []).map((p) => ({ name: p.name, value: p.health, tone: zfsTone(p.health) }));
  const shares = (s.mounts?.shares ?? []).map((m) => ({ name: m.path, value: SHARE_STATE[m.state]?.() ?? m.state, tone: SHARE_TONE[m.state] ?? "" }));
  const sessions = (s.sessions?.sessions ?? []).map((x) => ({ name: `${x.user} ${x.tty}`, value: x.from || tx("local"), tone: "" }));
  return (
    <>
      {pm2Items.length > 0 && <DetailRow k="PM2" title={tx("PM2, lu sans la commande pm2 : il n'est jamais relancé par MyServices")} watch="pm2"><ProbeChips items={pm2Items} /></DetailRow>}
      {raid.length > 0 && <DetailRow k="RAID" title={tx("RAID logiciel (mdadm)")} watch="raid"><ProbeChips items={raid} /></DetailRow>}
      {zfs.length > 0 && <DetailRow k="ZFS" title={tx("Pools ZFS")} watch="zfs"><ProbeChips items={zfs} /></DetailRow>}
      {shares.length > 0 && <DetailRow k={tx("Partages réseau")} title={tx("Partages réseau montés (NFS, SMB, SSHFS) et ceux de /etc/fstab")} watch="mounts"><ProbeChips items={shares} /></DetailRow>}
      {s.ntp?.available && (
        <DetailRow k={tx("Heure")} title={tx("Synchronisation de l'heure")} watch="ntp">
          {s.ntp.synced ? <span className="text-ok">{tx("synchronisée")}</span> : <span className="text-warn">{s.ntp.service ? tx("non synchronisée") : tx("non synchronisée, aucun service de synchronisation actif")}</span>}
        </DetailRow>
      )}
      {s.timers?.available && (
        <DetailRow k={tx("Tâches planifiées")} title={tx("Timers systemd")} watch="timers">
          <span>{tx("{0} actives", s.timers.total ?? 0)}</span>
          {!!s.timers.failed?.length && <ProbeChips items={s.timers.failed.map((u) => ({ name: u.replace(/\.service$/, ""), value: tx("en échec"), tone: "text-warn" }))} />}
        </DetailRow>
      )}
      {sessions.length > 0 && <DetailRow k={tx("Sessions ouvertes")} title={tx("Sessions ouvertes")}><ProbeChips items={sessions} /></DetailRow>}
      {s.fail2ban?.available && (
        <DetailRow k="Fail2ban" title={tx("Prisons Fail2ban et adresses bannies en ce moment")}>
          {s.fail2ban.down && <span className="text-warn" title={tx("La règle sudo est en place, mais fail2ban-client ne répond pas : le service est arrêté ou son socket absent.")}>{tx("ne répond pas (service arrêté ?)")}</span>}
          {!s.fail2ban.down && (s.fail2ban.access ? <MiniTable rows={(s.fail2ban.jails ?? []).map((j) => ({ name: j.name, value: tx("{0} bannie(s)", j.banned), tone: j.banned ? "text-warn" : "", dim: !j.banned }))} />
            : <SudoHint rule={s.fail2ban.rule} file="myservices-fail2ban" note={tx("Inutile si LogviewR lit déjà le Fail2ban de cette machine.")} />)}
        </DetailRow>
      )}
    </>
  );
}

/** A read that needs root and has no sudo rule yet: « not read », and behind a link the exact rule to add on the machine (one command, read-only) */
function SudoHint({ rule, file, note }: Readonly<{ rule?: string; file: string; note?: string }>) {
  const [how, setHow] = useState(false);
  const cmd = `echo '${rule ?? ""}' | sudo tee /etc/sudoers.d/${file} >/dev/null && sudo chmod 440 /etc/sudoers.d/${file} && sudo visudo -cf /etc/sudoers.d/${file}`;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span><Dim>{tx("non lu : règle sudo absente")}</Dim> <button type="button" className="text-xs text-link hover:underline" aria-expanded={how} onClick={() => setHow(!how)}>{how ? tx("Masquer") : tx("Comment faire sur la machine ?")}</button></span>
      {how && <>
        <Dim>{tx("Sur la machine, avec sudo : autorise cette seule commande, en lecture, sans mot de passe. La santé la lit au passage suivant.")}{note ? ` ${note}` : ""}</Dim>
        <Copyable text={cmd} />
      </>}
    </span>
  );
}

/** The services to restart after an update (needrestart), or the sudo rule it needs */
function NeedRestart({ nr }: Readonly<{ nr: NonNullable<HostSystem["needrestart"]> }>) {
  if (!nr.access) return <SudoHint rule={nr.rule} file="myservices-needrestart" />;
  if (nr.services?.length) return <span className="text-warn" title={nr.services.join("\n")}>{tx("{0} service(s) : {1}", nr.services.length, nr.services.slice(0, 4).join(", "))}</span>;
  return <Dim>{tx("aucun service")}</Dim>;
}

/** Detail, « Updates »: automatic updates (unattended-upgrades) and snaps waiting, when the machine has them */
function SystemUpdates({ s }: Readonly<{ s?: HostSystem }>) {
  const u = s?.auto_upd, snap = s?.snap;
  return (
    <>
      {u?.available && (
        <Row k={tx("Automatiques")}>
          {!u.enabled ? <Dim>{tx("désactivées")}</Dim> : (
            <span className={u.errors?.length || (u.days ?? 0) > UU_STALE_DAYS ? "text-warn" : ""} title={u.errors?.join("\n") || undefined}>
              {u.days == null ? tx("activées, jamais passées") : tx("dernier passage il y a {0}", durShort(u.days * 86400))}{u.errors?.length ? ` · ${tx("{0} erreur(s)", u.errors.length)}` : ""}
            </span>
          )}
        </Row>
      )}
      {s?.needrestart?.available && (
        <Row k={tx("À redémarrer")}>
          <NeedRestart nr={s.needrestart} />
        </Row>
      )}
      {snap?.available && !!snap.pending && <Row k="Snap"><span className="text-warn" title={snap.names?.join("\n")}>{tx("{0} à mettre à jour", snap.pending)}</span></Row>}
    </>
  );
}

/** A measure as a bar: its label, the gauge, the percentage and what it means (free space, used memory) */
const bar = (label: string, pct: number | undefined, extra?: string) => pct == null ? null : (
  <DetailRow key={label} k={label} title={label}><Fill pct={pct} /><Pct value={Math.round(pct)} />{extra && <Dim>{extra}</Dim>}</DetailRow>
);

/** The measures of the machine, in its « System » card: processor, memory, disks, temperature and probes, fans, memory and guests of a box */
function ResourceRows({ h }: Readonly<{ h: HealthHost }>) {
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
          <ProbeChips items={h.temp.sensors.map((x) => ({ name: shortProbe(x.name), full: x.name, value: `${Math.round(x.celsius)} °C`, tone: heatClass(x.celsius) }))} />
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

/** The checks of the machine, in its « Health » card: big logs, services, storage and clock of the system, kernel errors */
function HealthRows({ h }: Readonly<{ h: HealthHost }>) {
  return (
    <>
      {!!h.logs?.available && (h.logs.files.length > 0 || !!h.logs.journal_mb) && <BigLogsRow logs={h.logs} />}
      {h.system && <SystemRows s={h.system} />}
      {h.kernel?.has_errors && <KernelBlock id={h.id} lines={h.kernel.samples ?? []} />}
    </>
  );
}

/** « System »: what runs on the machine (system, kernel, uptime, hardware, GPU) and its measures (processor, memory, disks, temperature) */
export function SystemSection({ h, from, children }: Readonly<{ h?: HealthHost; from: Origin[]; children?: React.ReactNode }>) {
  return (
    <Section sec="system" icon={Cpu} title={tx("Système")} tone="violet" from={from}>
      {children}
      {h && <ResourceRows h={h} />}
    </Section>
  );
}

const BK_TONE: Record<string, "ok" | "warn" | "bad"> = { ok: "ok", warn: "warn", crit: "bad", down: "bad" };
const BK_RANK: Record<string, number> = { na: 0, ok: 1, warn: 2, crit: 3, down: 4 };
const bkText = (level: string) => ({ ok: "text-dim", warn: "text-warn" } as Record<string, string>)[level] ?? "text-bad";

/** « Backups » section: what the machine backs up (the sets it produces), the backup folders that hold them, and where the copies go
 *  (replication), from the Backups page data. Untracked folders and cron lines stay on the Backups page. Nothing when there is none. */
/** Jobs of a Veeam server that back up this machine (a VM, or a computer with Veeam Agent). */
function VeeamBackedUp({ rows }: Readonly<{ rows: VeeamRow[] }>) {
  const byName = [...new Set(rows.filter((r) => r.obj.machine_by === "name").map((r) => r.obj.name))];
  return (
    <Row wide k={tx("Sauvegardée par Veeam")}>
      <ConsoleBox cols="auto minmax(0,1fr) auto auto auto">
        {rows.map(({ set, loc, obj }) => (
          <Fragment key={`${set.id}/${obj.name}`}>
            <span className="self-center" title={loc.detail || undefined}><Dot tone={BK_TONE[loc.level] ?? "warn"} /></span>
            <span className="min-w-0 [overflow-wrap:anywhere]" title={loc.detail || undefined}>
              <span className="text-txt">{tx("job « {0} »", loc.job ?? set.label)}</span>
              <span className="text-dim">{obj.host && ` · ${tx("sur {0}", obj.host)}`}{loc.repository && ` · ${tx("dépôt {0}", loc.repository)}`}</span>
            </span>
            <span className={`whitespace-nowrap text-right ${bkText(loc.level)}`}>{loc.age == null ? tx("jamais vue") : ageDays(loc.age)}</span>
            <span className="whitespace-nowrap text-right text-dim">{obj.size ? tx("VM {0}", bytes(obj.size)) : ""}</span>
            <span className="whitespace-nowrap text-right text-dim">{obj.points == null ? "" : tx("{0} point(s)", obj.points)}</span>
          </Fragment>
        ))}
      </ConsoleBox>
      {byName.length > 0 && <Dim>{tx("Rattachée par le nom (« {0} » dans Veeam)", byName.join(", "))} · <a href="#settings/backups" className="text-link hover:underline">{tx("changer dans l'assistant Veeam")}</a></Dim>}
    </Row>
  );
}

/** VMs backed up by Veeam that run on this machine (a hypervisor), linked to a machine or not. */
function VeeamHosted({ rows }: Readonly<{ rows: VeeamRow[] }>) {
  const unlinked = rows.some((r) => !r.obj.machine);
  return (
    <Row wide k={tx("VM sauvegardées ici")}>
      <ConsoleBox cols="auto minmax(0,1fr) auto auto auto">
        {rows.map(({ set, loc, obj }) => (
          <Fragment key={`${set.id}/${obj.name}`}>
            <span className="self-center"><Dot tone={obj.machine ? BK_TONE[loc.level] ?? "warn" : "warn"} /></span>
            <span className="min-w-0 [overflow-wrap:anywhere]" title={loc.detail || undefined}>
              <span className="text-txt">{obj.name}</span>
              {!obj.machine && <span className="text-warn"> · {tx("non rattachée")}</span>}
              <span className="text-dim"> · {tx("job « {0} »", loc.job ?? set.label)}</span>
            </span>
            <span className={`whitespace-nowrap text-right ${bkText(loc.level)}`}>{loc.age == null ? tx("jamais vue") : ageDays(loc.age)}</span>
            <span className="whitespace-nowrap text-right text-dim">{obj.size ? bytes(obj.size) : ""}</span>
            <span className="whitespace-nowrap text-right text-dim">{obj.points == null ? "" : tx("{0} point(s)", obj.points)}</span>
          </Fragment>
        ))}
      </ConsoleBox>
      {unlinked && <Dim>{tx("Une VM « non rattachée » n'a pas de machine du même nom : la choisir dans l'assistant Veeam.")}</Dim>}
    </Row>
  );
}

export function MachineBackupsSection({ m, backups }: Readonly<{ m: Machine; backups?: Backups | null }>) {
  const host = backups?.hosts?.find((h) => h.ip === m.ip);
  const veeam = veeamOf(backups, m.ip);
  const sets = host ? (backups?.sets ?? []).filter((s) => s.origin === host.id) : [];
  const dirs = host ? host.local.filter((d) => d.covered.length) : [];
  const copies = host?.copies ?? [];
  if (!sets.length && !dirs.length && !copies.length && !veeam.mine.length && !veeam.hosted.length) return null;
  const ok = sets.filter((s) => s.level === "ok").length;
  const level = host?.level ?? [...veeam.mine, ...veeam.hosted].reduce((w, r) => ((BK_RANK[r.loc.level] ?? 0) > (BK_RANK[w] ?? 0) ? r.loc.level : w), "na");
  return (
    <Section sec="backups" icon={Archive} title={tx("Sauvegardes")} tone={BK_TONE[level] ?? "warn"} from={[{ label: tx("Sauvegardes"), href: "#backups" }]}>
      {host && (sets.length > 0 || copies.length > 0 || host.last_local) && <Row k={tx("État")}>
        <span>{tx("{0} jeu(x) sur {1} à jour", ok, sets.length)}</span>
        {host.last_local && <Dim>· {tx("dernière sauvegarde il y a {0}", ageDays(host.last_local.age))}</Dim>}
        {copies.length > 0 && <Dim>· {tx("{0} lieu(x) de copie", copies.length)}</Dim>}
      </Row>}
      {veeam.mine.length > 0 && <VeeamBackedUp rows={veeam.mine} />}
      {veeam.hosted.length > 0 && <VeeamHosted rows={veeam.hosted} />}
      {sets.length > 0 && <Row wide k={tx("Jeux produits ici")}>
        <ConsoleBox cols="auto minmax(0,1fr) auto auto auto">
          {sets.map((s) => {
            const src = s.locations.find((l) => l.role === "source"), copies = s.locations.filter((l) => l.role !== "source");
            const locked = copies.filter((l) => l.encrypted).length, missing = s.expect_offsite !== false && !s.offsite;
            return (
              <Fragment key={s.id}>
                <span className="self-center" title={s.why?.join("\n") || undefined}><Dot tone={BK_TONE[s.level] ?? "warn"} /></span>
                <span className="min-w-0 [overflow-wrap:anywhere] text-txt" title={s.label}>{s.label.replace(/^[^:]*: /, "")}<span className="text-dim"> · {s.schedule}</span></span>
                <span className={`whitespace-nowrap text-right ${bkText(src?.level ?? s.level)}`}>{src?.age != null ? ageDays(src.age) : tx("jamais vue")}</span>
                <span className="whitespace-nowrap text-right text-dim">{s.size ? bytes(s.size) : ""}</span>
                <span className={`whitespace-nowrap text-right ${missing ? "text-warn" : "text-dim"}`} title={tx("Copies ailleurs (🔒 = chiffrées)")}>{missing ? tx("aucune copie") : tx("{0} copie(s)", copies.length)}{locked ? ` · ${locked} 🔒` : ""}</span>
              </Fragment>
            );
          })}
        </ConsoleBox>
      </Row>}
      {dirs.length > 0 && <Row wide k={tx("Dossiers")}>
        <ConsoleBox cols="minmax(0,1fr) auto auto">
          {dirs.map((d) => (
            <Fragment key={d.path}>
              <span className="min-w-0 [overflow-wrap:anywhere]" title={d.covered.join(", ")}><span className="font-mono text-txt">{d.path}</span><span className="text-dim"> · {d.covered.join(", ")}</span></span>
              <span className="whitespace-nowrap text-right text-dim">{d.age != null ? ageDays(d.age) : ""}</span>
              <span className="whitespace-nowrap text-right text-dim">{d.size ? bytes(d.size) : ""}</span>
            </Fragment>
          ))}
        </ConsoleBox>
      </Row>}
      {copies.length > 0 && <Row wide k={tx("Réplication")}>
        <ConsoleBox cols="auto minmax(0,1fr) auto auto">
          {copies.map((c) => (
            <Fragment key={c.host}>
              <span className="self-center"><Dot tone={BK_TONE[c.level] ?? "warn"} /></span>
              <span className="min-w-0 [overflow-wrap:anywhere]" title={c.vias.join("\n")}><span className="text-txt">→ {c.label}</span><span className="text-dim"> · {c.vias.join(", ")}</span>{c.encrypted && <span className="text-violet-400"> · 🔒 {tx("chiffré")}</span>}</span>
              <span className="whitespace-nowrap text-right text-dim">{tx("{0} jeu(x)", c.sets)}</span>
              <span className={`whitespace-nowrap text-right ${bkText(c.level)}`}>{c.age != null ? ageDays(c.age) : tx("jamais vue")}</span>
            </Fragment>
          ))}
        </ConsoleBox>
      </Row>}
      <Row k=""><a href="#backups" className="text-xs text-link hover:underline">{tx("Voir dans Sauvegardes")} ›</a></Row>
    </Section>
  );
}

/** « Share » section: a machine that holds backups of others (a box, a NAS: a followed shared folder, or a machine that receives rsync copies) shows what it hosts,
 *  its free space and, for each set, how old its copy is. Nothing for a machine that holds no copy. */
export function SharedBackupsSection({ m, backups, from }: Readonly<{ m: Machine; backups?: Backups | null; from: Origin[] }>) {
  const host = backups?.hosts?.find((h) => h.ip === m.ip);
  const hosted = host ? (backups?.sets ?? []).flatMap((s) => s.locations.filter((l) => l.host === host.id && s.origin !== host.id).map((l) => ({ s, l }))) : [];
  if (!host || (!host.storage && !hosted.length)) return null;
  const disk = [...host.disks].sort((a, b) => b.size - a.size)[0];
  const worst = hosted.reduce((n, { l }) => Math.max(n, ({ crit: 2, down: 2, warn: 1 } as Record<string, number>)[l.level] ?? 0), 0);
  return (
    <Section sec="share" icon={FolderOpen} title={tx("Partage")} tone={worst >= 2 ? "bad" : "link"} from={from}>
      <Row k={tx("Copies hébergées")}>{hosted.length ? tx("{0} jeu(x)", hosted.length) : <Dim>{tx("aucune")}</Dim>}</Row>
      {disk && <Row k={tx("Espace")}><Fill pct={disk.pct} /><Pct value={disk.pct} /><Dim>{bytes(disk.avail)} {tx("libres")} · {disk.mount}</Dim></Row>}
      {hosted.length > 0 && (
        <Row wide k={tx("Détail")}>
          <ConsoleBox cols="minmax(0,3fr) minmax(0,2fr) auto">
            {hosted.map(({ s, l }) => (
              <Fragment key={`${s.id}-${l.label}`}>
                <span className="min-w-0 [overflow-wrap:anywhere] text-txt" title={s.label}>{s.label.replace(/^[^:]*: /, "")}<span className="text-dim"> ← {s.label.split(":")[0].trim()}</span></span>
                <span className="min-w-0 text-dim">{l.via ?? ""}</span>
                <span className={`whitespace-nowrap text-right ${bkText(l.level)}`}>{l.age != null ? ageDays(l.age) : tx("jamais vue")}</span>
              </Fragment>
            ))}
          </ConsoleBox>
        </Row>
      )}
      {host.sets.length > 0 && <Row k={tx("Jeux produits ici")}>{host.sets.length}</Row>}
    </Section>
  );
}

/** Ligne dépliée à la demande : cinq rubriques (identité, système, accès, logiciels, santé), chacune avec l'origine de ses données */
function Detail({ m, h, mac, net, from, watch, npmIps, ha, unifi, unifiSys, unifiNet, freebox, onFilter, focus, backups, pve, sheet, hosts, extra }: Readonly<{ hosts?: Host[]; pve?: string; sheet?: AddressSheet; backups?: Backups | null; extra?: React.ReactNode; focus?: { kind: WatchKind; n: number } | null; onFilter?: (sel: Selected) => void; m: Machine; h?: HealthHost; mac?: string; net?: NetDevice; from: ReturnType<typeof originsOf>; watch: WatchItem[]; npmIps?: Record<string, string>; ha?: ServiceStatus; unifi?: UnifiDevice; unifiSys?: UnifiSystem; unifiNet?: UnifiNet; freebox?: FreeboxInfo }>) {
  const unifiOnly = !!unifi && !m.info && !m.agent;   // read only through UniFi: no SSH, no agent
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) setTimeout(() => showWatch(root.current, focus.kind), 120); }, [focus]);   // opened from a badge: show where its notice is explained
  const i = m.info, hw = hardwareRows(m.agent?.hardware);
  return (
    <div ref={root} className="flex flex-col gap-4">
      <WatchSummary items={watch} onShow={(kind) => showWatch(root.current, kind)} />
      <div className="columns-1 gap-4 xl:columns-2">
      <UpdatesSection h={h} windows={!!m.agent || h?.os === "windows"} from={from.health} freebox={freebox} unifi={unifi} unifiSys={unifiSys} ha={ha} />
      <HealthSection h={h} from={from.health} />
      <IdentitySection m={m} mac={mac} net={net} from={uniqueOrigins([...from.role, ...from.mac])} tool={freebox || unifi ? "MynetworK" : undefined} pve={pve} sheet={sheet} />
      <SystemSection h={h} from={uniqueOrigins([...from.os, ...from.health])}>
        <Row k={tx("Système")}>{i?.os || m.agent?.os || haSystemName(ha) || undefined}</Row>
        {ha?.system && <HaSystemRows sys={ha.system} />}
        {unifi && <UnifiRows d={unifi} sys={unifiSys} />}
        {freebox?.system && <FreeboxRows fb={freebox} />}
        <Row k={tx("Noyau")}>{i?.kernel || m.agent?.kernel || undefined}</Row>
        <Row k={tx("En marche")}>{uptimeOf(m, unifi, freebox, ha) ? dur(uptimeOf(m, unifi, freebox, ha)!) : undefined}</Row>
        {hw.map(([k, v]) => <Row key={k} k={k}>{v}</Row>)}
        <GpuRows m={m} hosts={hosts} onFilter={onFilter} />
      </SystemSection>

      {freebox && <FreeboxAccessSection fb={freebox} from={from.ssh} />}
      {!freebox && unifiOnly && <UnifiAccessSection d={unifi} sys={unifiSys} mac={mac} from={from.ssh} />}
      {!freebox && !unifiOnly && <AccessSection m={m} from={from.ssh} />}

      {freebox && (freebox.vms || freebox.vm_system) && <FreeboxVmSection fb={freebox} from={from.services} />}
      {!freebox && unifiOnly && <UnifiNetworkSection d={unifi} sys={unifiSys} net={unifiNet} from={from.services} />}
      {!(freebox && (freebox.vms || freebox.vm_system)) && !(!freebox && unifiOnly) && <SoftwareSection m={m} down={watch.find((w) => w.kind === "services")?.detail} hosts={hosts ?? []} npmIps={npmIps} ha={ha} from={from.services} onFilter={onFilter} />}

      {ha && <HaBackupsSection ha={ha} from={from.services} />}
      {ha && <HaInsideSection ha={ha} from={from.services} />}
      <MachineBackupsSection m={m} backups={backups} />
      <SharedBackupsSection m={m} backups={backups} from={from.services} />

      {extra}
      </div>
    </div>
  );
}

/** Sources named once, in their first order (the role, the MAC address and the system often come from the same tool) */
function uniqueOrigins(list: Origin[]): Origin[] {
  return list.filter((o, n) => list.findIndex((x) => x.label === o.label) === n);
}

/** The service an AI model runs in, as a link to the machine's services (a plain label when the page cannot open them) */
function ModelService({ m, model, hosts, onFilter }: Readonly<{ m: Machine; model: { port?: number | null; runtime?: string | null }; hosts?: Host[]; onFilter?: (sel: Selected) => void }>) {
  const found = hosts ? modelService(m.ip, model, hosts) : null;
  if (!found) return null;
  const label = <><Boxes size={12} className="mr-1 inline" aria-hidden />{hostName(found)}</>;
  return onFilter
    ? <button type="button" className="ml-2 text-link hover:underline" title={tx("Voir les services de cette machine")} onClick={() => onFilter({ machine: [m.ip] })}>{label}</button>
    : <span className="ml-2 text-link">{label}</span>;
}

/** GPUs read by GpuViewR (matched by the machine's name): model, temperature, load, memory, power */
function GpuRows({ m, hosts, onFilter }: Readonly<{ m: Machine; hosts?: Host[]; onFilter?: (sel: Selected) => void }>) {
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
          gpus.length > 1 && x.gpu != null ? `GPU ${x.gpu + 1}` : null].filter(Boolean).map((v) => ` · ${v}`).join("")}</Dim>
          <ModelService m={m} model={x} hosts={hosts} onFilter={onFilter} /></span>
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
function IdentitySection({ m, mac, net, from, tool, pve, sheet }: Readonly<{ m: Machine; mac?: string; net?: NetDevice; from: Origin[]; tool?: string; pve?: string; sheet?: AddressSheet }>) {
  const roles = rolesOf(m.role);
  // read by a network tool's API (the Freebox, a UniFi gateway): « online, no SSH » would be wrong, it is followed through that tool
  const viaTool = tool && mState(m) === "nossh";
  const [stTone, stLabel, stTip]: [Tone, string, string] = viaTool ? ["ok", tx("Par le connecteur {0}", tool), tx("Lue par le connecteur {0} (son API) : en ligne, sans SSH ni agent", tool)] : stateBadge(m);
  return (
      <Section icon={IdCard} title={tx("Fiche")} tone="link" from={from}>
        <Row k={tx("État")}><Badge tone={stTone} title={stTip}>{stLabel}</Badge></Row>
        <Row k={tx("Rôle")}>{roles.length ? <span className="flex flex-wrap gap-1">{roles.map((t) => <Badge key={t} tone="off">{t}</Badge>)}</span> : undefined}</Row>
        <Row k="MAC">{mac && <span className="font-mono">{mac}</span>}</Row>
        <Row k={tx("Ports ouverts")}>{net?.ports.length ? <span className="font-mono" title={tx("Vus par le scanner de MynetworK")}>{net.ports.join(", ")}{net.ports_at && <Dim> · {tx("scannés le {0}", dateTime(net.ports_at))}</Dim>}</span> : undefined}</Row>
        <Row k={tx("Sur le réseau")}>{isDate(net?.first_seen) ? <span title={tx("Vue par MynetworK")}>{tx("depuis le {0}", dateTime(net.first_seen))}{isDate(net.last_seen) && <Dim> · {tx("vue le {0}", dateTime(net.last_seen))}</Dim>}{net.ping_ms != null && <Dim> · {Math.round(net.ping_ms)} ms</Dim>}</span> : undefined}</Row>
        <Row k={tx("Autres noms")}>{otherNames(m).join(", ") || undefined}</Row>
        <Row k={tx("Branchement")}>{sheet?.unifi && (sheet.unifi.wired || sheet.unifi.wireless) ? <PlugLine u={sheet.unifi} /> : undefined}</Row>
        {sheet?.unifi?.wired && sheet.unifi.switch_port != null && <Row k=""><SwitchPanel ip={sheet.unifi.switch_ip} name={sheet.unifi.switch_name} port={sheet.unifi.switch_port} /></Row>}
        <Row k={tx("Nom dans UniFi")}>{sheet?.unifi?.name && sheet.unifi.name.toLowerCase() !== m.name.toLowerCase() ? sheet.unifi.name : undefined}</Row>
        <Row k={tx("Bail de la Freebox")}>{sheet?.freebox?.dhcp ? <span><span className="font-mono">{sheet.freebox.dhcp.ip}</span><Dim> · {sheet.freebox.dhcp.static ? tx("réservation fixe") : tx("adresse attribuée")}</Dim></span> : undefined}</Row>
        <Row k={tx("Redirections de ports")}>{sheet?.freebox?.forwards?.length ? <span className="flex flex-col gap-0.5 font-mono text-xs">{sheet.freebox.forwards.map((f, i) => <span key={i}>{forwardText(f)}</span>)}</span> : undefined}</Row>
        <Row k={tx("Virtualisation")}>{m.links?.guest || m.links?.hypervisor ? <Virt links={m.links} version={pve} /> : undefined}</Row>
        <Row k={tx("Vue par")}>{m.links?.sources.length ? <SeenBy links={m.links} /> : undefined}</Row>
        <Row k="TTL">{m.ttl ? <span title={tx("Durée de vie des paquets du ping : 64 Linux, 128 Windows")}>{m.ttl}</span> : undefined}</Row>
      </Section>
  );
}

/** Detail, « Access »: SSH (account, key, host security) or the Windows agent */
function AccessSection({ m, from }: Readonly<{ m: Machine; from: Origin[] }>) {
  const i = m.info, s = m.ssh;
  return (
      <Section sec="access" icon={KeyRound} title={tx("Accès")} tone="ok" from={from}>
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

/** The Docker line of a machine without a container list: docker unreachable, running count (SSH or agent), none, absent, or undefined (no line) */
function dockerValue(m: Machine): React.ReactNode {
  const i = m.info;
  if (m.containers === null) return <span className="text-warn">{tx("docker inaccessible (SSH ou groupe docker)")}</span>;
  if (i?.docker) return tx("{0} conteneur(s) en cours", i.docker);
  if (m.agent?.docker != null) return m.agent.docker ? tx("{0} conteneur(s) (lus par l'agent)", m.agent.docker) : <Dim>{tx("aucun conteneur")}</Dim>;
  return i?.docker_installed === false ? <Dim>{tx("absent")}</Dim> : undefined;
}

/** The services count of a machine, its NPM ones and those down, each a filter link when the page can filter */
function ServicesValue({ m, onFilter }: Readonly<{ m: Machine; onFilter?: (sel: Selected) => void }>) {
  return (
    <>
      {onFilter && m.services > 0 ? <button type="button" className="text-link hover:underline" title={tx("Voir ses services")} onClick={() => onFilter({ machine: [m.ip] })}>{m.services}</button> : m.services}
      {m.npm > 0 && <Dim> · {onFilter ? <button type="button" className="text-link hover:underline" title={tx("Voir ses services NPM")} onClick={() => onFilter({ machine: [m.ip], src: ["npm"] })}>{m.npm} NPM</button> : `${m.npm} NPM`}</Dim>}{m.down > 0 && <span className="text-bad"> · {m.down} {tx("en panne")}</span>}
    </>
  );
}

/** Nothing at all to show in « Software and services » */
const noSoftware = (m: Machine): boolean =>
  !m.services && !m.web?.length && !m.containers?.length && !m.info?.docker && !m.agent?.docker && !m.agent?.apps?.length && !m.api?.length;

/** Detail, « Software and services »: services, web servers (Docker, service or binary), path of each site, every container, linked APIs,
 *  Home Assistant add-ons and Windows apps */
function SoftwareSection({ m, down, hosts, npmIps, ha, from, onFilter }: Readonly<{ down?: string[]; onFilter?: (sel: Selected) => void; m: Machine; hosts: Host[]; npmIps?: Record<string, string>; ha?: ServiceStatus; from: Origin[] }>) {
  return (
      <Section sec="services" icon={Boxes} title={tx("Logiciels et services")} tone="warn" from={from}>
        <Row k={tx("Services")}><ServicesValue m={m} onFilter={onFilter} /></Row>
        {down?.map((d) => <Row key={d} k=""><span className="text-[11px] text-bad">• {d}</span></Row>)}
        <WebServersTable m={m} hosts={hosts} npmIps={npmIps} />
        <SitePaths m={m} hosts={hosts} />
        {m.containers?.length ? <ContainerList m={m} hosts={hosts} />
          : <Row k="Docker">{dockerValue(m)}</Row>}
        <Row k="API">{m.api?.length ? <span className="flex flex-wrap gap-1">{m.api.map((a) => <Badge key={`${a.type}/${a.name}`} tone={a.ok ? "ok" : a.stale ? "warn" : "bad"} title={`${a.name} : ${a.message ?? ""}`}>{a.label}{a.version ? ` ${a.version}` : ""}</Badge>)}</span> : undefined}</Row>
        {ha?.addons?.length ? <div className="py-1"><HaAddons s={ha} /></div> : null}
        <Row k={tx("Applis")}>{m.agent?.apps?.length ? <span className="flex flex-wrap gap-1">{m.agent.apps.map((a) => <Badge key={a.key} tone="info" title={tx("Vue par les services Windows du PC")}>{a.label}</Badge>)}</span> : undefined}</Row>
        {noSoftware(m) && <Dim>-</Dim>}
      </Section>
  );
}

/** Home Assistant, advanced mode: its backups, with where each one is copied (the shares), the last automatic one first */
export function HaBackupsSection({ ha, from }: Readonly<{ ha: ServiceStatus; from: Origin[] }>) {
  const bk = ha.mcp?.backups;
  if (!bk) return null;
  const now = Date.now() / 1000, items = [...bk.items].sort((a, b) => b.date - a.date);
  const lastAuto = items.find((x) => x.auto), places = [...new Set(items.slice(0, 8).flatMap((x) => x.locations))];
  const age = (t: number) => ageDays((now - t) / 86400);
  const alone = (x: (typeof items)[number]) => x.locations.every((l) => l === "local");
  return (
    <Section sec="ha-backups" icon={Archive} title={tx("Sauvegardes Home Assistant")} tone={lastAuto && now - lastAuto.date < 3 * 86400 ? "ok" : "warn"} from={from}>
      <Row k={tx("Dernière automatique")}>{lastAuto ? <span>{dateTime(lastAuto.date * 1000)} <Dim>· {age(lastAuto.date)} · {bytes(lastAuto.size)}{lastAuto.protected ? ` · 🔒 ${tx("chiffrée")}` : ""}</Dim></span> : <span className="text-warn">{tx("aucune")}</span>}</Row>
      <Row k={tx("Total")}>{bk.total} <Dim>· {bytes(items.reduce((n, x) => n + x.size, 0))}</Dim></Row>
      <Row k={tx("Copiée vers")}>{places.length ? (
        <ConsoleBox>
          {places.map((pl) => pl === "local"
            ? <span key={pl} className="text-warn" title={tx("Reste sur Home Assistant lui-même")}>{tx("sur HA seulement")}</span>
            : <span key={pl} className="text-muted" title={tx("Partage ou emplacement de sauvegarde déclaré dans Home Assistant")}><span className="text-dim">→ </span>{pl}</span>)}
        </ConsoleBox>
      ) : undefined}</Row>
      <Row k={tx("Récentes")}>
        <ul className="flex min-w-0 flex-col gap-1">
          {items.slice(0, 5).map((x) => (
            <li key={x.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 truncate" title={x.name}>{x.name}</span>
              <Dim>{x.auto ? tx("auto") : tx("manuelle")} · {dateTime(x.date * 1000)} · {bytes(x.size)}</Dim>
              {alone(x) ? <span className="text-warn" title={tx("Pas de copie hors de Home Assistant")}>{tx("sur HA seulement")}</span> : <Dim>{x.locations.join(", ")}</Dim>}
            </li>
          ))}
        </ul>
      </Row>
    </Section>
  );
}

/** Home Assistant, advanced mode: apps (add-ons) running or stopped, integrations loaded or failing, configuration check and repairs */
export function HaInsideSection({ ha, from }: Readonly<{ ha: ServiceStatus; from: Origin[] }>) {
  const mcp = ha.mcp;
  if (!mcp || (!mcp.apps && !mcp.integrations && !mcp.health)) return null;
  const { apps, integrations: ig, health } = mcp, bad = ig?.problems ?? [];
  const stopped = apps?.items.filter((a) => a.state !== "started") ?? [];
  const loaded = ig?.states.loaded ?? 0, notLoaded = ig?.states.not_loaded ?? 0;
  const ok = (!health || (health.config_ok !== false && !(health.repairs_count ?? 0))) && !bad.length;
  return (
    <Section sec="ha-inside" icon={Puzzle} title={tx("Home Assistant : applis et intégrations")} tone={ok ? "ok" : "warn"} from={from}>
      {apps && <Row k={tx("Applis")}>{apps.total} <Dim>· {tx("{0} en marche", apps.running)}{apps.stopped ? ` · ${tx("{0} arrêtée(s)", apps.stopped)}` : ""}</Dim></Row>}
      {stopped.length > 0 && <Row k={tx("Arrêtées")}><span className="min-w-0 break-words text-muted">{stopped.map((a) => a.name).join(", ")}</span></Row>}
      {ig && <Row k={tx("Intégrations")}>{ig.total} <Dim>· {tx("{0} chargées", loaded)}{notLoaded ? ` · ${tx("{0} non chargées", notLoaded)}` : ""}</Dim></Row>}
      {bad.length > 0 && <Row k={tx("En échec")}><span className="min-w-0 break-words text-warn">{bad.map((b) => `${b.domain}${b.title ? ` (${b.title})` : ""}`).join(", ")}</span></Row>}
      {health && <Row k={tx("Configuration")}>{health.config_ok === false ? <span className="text-bad">{tx("erreurs : {0}", (health.config_errors ?? []).join(" ; ") || "?")}</span> : <span className="text-ok">{tx("valide")}</span>}</Row>}
      {health && <Row k={tx("Réparations")}>{(health.repairs_count ?? 0) ? <span className="text-warn">{health.repairs_count}</span> : <span className="text-ok">{tx("aucune")}</span>}</Row>}
    </Section>
  );
}

/** Updates Home Assistant waits for, by kind: Home Assistant itself, its apps, and the rest (HACS integrations and cards, other entities) */
function HaUpdates({ ha }: Readonly<{ ha: ServiceStatus }>) {
  const ups = ha.updates ?? [], group = (g: string) => ups.filter((u) => (u.group ?? "other") === g);
  const line = (u: NonNullable<ServiceStatus["updates"]>[number]) => <li key={u.name}>{u.name} <Dim>{[u.installed, u.latest].filter(Boolean).join(" → ")}</Dim></li>;
  const kinds: [string, string][] = [["core", tx("Home Assistant")], ["addon", tx("Applis")], ["other", tx("HACS et autres")]];
  return <>{kinds.map(([g, label]) => group(g).length > 0 && <Row key={g} k={label}><ul className="flex min-w-0 flex-col gap-0.5">{group(g).map(line)}</ul></Row>)}</>;
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
export function UpdatesSection({ h, windows, from, freebox, unifi, unifiSys, ha }: Readonly<{ h?: HealthHost; windows: boolean; from: Origin[]; freebox?: FreeboxInfo; unifi?: UnifiDevice; unifiSys?: UnifiSystem; ha?: ServiceStatus }>) {
  if (!h && !ha) return null;
  const haN = ha?.updates?.length ?? 0, n = (h?.apt?.upgradable ?? 0) + haN;
  // nothing to update, no reboot, no firmware offered: no card (the page stays short)
  const firmware = !!freebox?.system?.update_available || !!unifi?.upgradable || !!(unifi && unifiSys?.update_available && isGateway(unifi, unifiSys));
  if (!n && !h?.reboot_required && !firmware) return null;
  return (
    <Section sec="updates" icon={ArrowUpCircle} title={tx("Mises à jour")} tone={n || h?.reboot_required ? "warn" : "ok"} from={from}>
      {freebox && <FreeboxFirmware fb={freebox} />}
      {!freebox && unifi && <UnifiFirmware d={unifi} sys={unifiSys} />}
      {!n && <Row k={tx("État")}><span className="text-ok">{tx("à jour")}</span></Row>}
      {ha && <HaUpdates ha={ha} />}
      {h?.reboot_required && <Row k={tx("Redémarrage")}><span className="text-warn">{tx("redémarrage requis")}</span></Row>}
      {h && <UpdatesFold h={h} windows={windows} />}
      <SystemUpdates s={h?.system} />
    </Section>
  );
}

/** Detail, « Health »: the level and why, then the checks (logs, system services and storage, kernel, failed systemd units); the measures are in « System » */
export function HealthSection({ h, from }: Readonly<{ h?: HealthHost; from: Origin[] }>) {
  const failed = h?.systemd?.failed.length || 0;
  // Why the level is not « ok »: the controls in alert, in words (the same sentences as the « À surveiller » column); updates and reboot have their own section
  const why = h ? healthItems(h).filter((i) => i.kind !== "updates" && i.kind !== "reboot") : [];
  return (
      <Section sec="health" icon={HeartPulse} title={tx("Santé")} tone="bad" from={from}>
        {h ? <>
          <Row k={tx("Niveau")}>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title={why.length ? [tx("Pourquoi") + " :", ...why.map((i) => "• " + i.text)].join("\n") : undefined}>
              <Level level={h.reachable === false ? "down" : h.level} />
              {why.length > 0 && <span className="text-xs text-muted">{why.map((i) => i.text).join(" · ")}</span>}
            </span>
          </Row>
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
function uptimeOf(m: Machine, unifi?: UnifiDevice, fb?: FreeboxInfo, ha?: ServiceStatus): number | undefined {
  const booted = ha?.host?.boot ? Date.parse(ha.host.boot) : NaN;   // Home Assistant gives its last boot time, not a duration
  return m.info?.uptime_s ?? m.agent?.uptime_s ?? unifi?.uptime ?? fb?.system?.uptime ?? (Number.isNaN(booted) ? undefined : Math.max(0, Math.floor((Date.now() - booted) / 1000)));
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

function HealthLevel({ m, h, followed, pills = false }: Readonly<{ m: Machine; h?: HealthHost; followed: boolean; pills?: boolean }>) {   // pills: the cause pills follow in the cell
  if (h) {
    const key = levelKey(h), [tone, label] = LEVEL[key] ?? ["off", key], items = key === "ok" ? [] : healthItems(h);
    if (key === "warn" && pills) return null;   // « à surveiller » is what the orange and blue pills already say; kept only when there is none
    // not OK: the tooltip says why (the same sentences as the « À surveiller » column)
    const title = items.length ? [label.charAt(0).toUpperCase() + label.slice(1), ...items.map((i) => `• ${i.text}`)].join("\n") : undefined;
    return <Badge tone={tone} title={title} outline={key === "warn"} plainText={key === "warn"}>{label}</Badge>;   // « à surveiller »: outline only
  }
  if (followed && !m.off) return <Badge tone="info" title={tx("Une source de santé existe (SSH, agent, Beszel ou Home Assistant) : la machine sera lue au prochain passage de la tâche Santé (Réglages → Tâches et horaires)")}>{tx("en attente du relevé")}</Badge>;
  if (m.off) return <Badge tone="off" title={tx("Éteinte volontairement, aucune alerte")}>{tx("éteinte")}</Badge>;
  if (m.ping === false) return <Badge tone="bad" title={tx("Ne répond pas au ping")}>{tx("hors ligne")}</Badge>;
  if (networkTool(m)) return <Badge tone="off" title={tx("Vue par {0} : en ligne, mais ses ressources (CPU, mémoire, disque) ne sont lues que par SSH, l'agent, Beszel ou Home Assistant", networkTool(m)!)}>{tx("Via {0}", networkTool(m)!)}</Badge>;
  return <Badge tone="off" title={tx("Pas de santé relevée : ni SSH, ni agent, ni Beszel, ni Home Assistant pour cette machine")}>{tx("non suivie")}</Badge>;
}

/** Services of a machine that are down (or, with "warn", that have a problem), those hidden from « To watch » left out (with how many) */
function troubleOf(m: Machine, hosts: Host[], hidden: HiddenMap, cls: "bad" | "warn" = "bad"): { list: string[]; hidden: number } {
  const mine = hosts.filter((r) => (r.host_ip || r.ip || r.target_ip) === m.ip && r.enabled && status(r)[0] === cls);
  const shown = mine.filter((r) => !isHidden(r, hidden));
  return { list: shown.map((r) => [r.domains?.[0] || r.service?.name || [r.ip, r.port].join(":"), status(r)[2]].join(" : ")), hidden: mine.length - shown.length };
}

/** The machine as « To watch » sees it: its services down minus those hidden there, each with its problem */
function withShownDown(m: Machine, hosts: Host[], hidden: HiddenMap): [Machine, string[]] {
  const down = troubleOf(m, hosts, hidden);
  return [down.hidden ? { ...m, down: Math.max(0, m.down - down.hidden) } : m, down.list];
}

const MAX_SVC_LINES = 8;
/** Services of a machine: the total, then +N in red (down) and +N in orange (a problem); which ones in the tooltip. onOpen: the whole count opens its services */
function ServiceCount({ m, snap, onOpen }: Readonly<{ m: Machine; snap: Snapshot; onOpen?: () => void }>) {
  const hiddenMap = useServicesHidden();
  const [shownM, down] = withShownDown(m, snap.data.hosts, hiddenMap), nDown = shownM.down;
  const { list: warn, hidden: warnHidden } = troubleOf(m, snap.data.hosts, hiddenMap, "warn");
  const nHidden = m.down - nDown + warnHidden;
  const rows = [...down.map((l) => `[[bad:${tx("panne")}]]\t${l}`), ...warn.map((l) => `[[warn:${tx("souci")}]]\t${l}`)];
  const more = rows.length > MAX_SVC_LINES ? [tx("… et {0} autres", rows.length - MAX_SVC_LINES)] : [];
  const head = [tx("{0} services", m.services), nDown ? tx("{0} en panne", nDown) : "", warn.length ? tx("{0} à souci", warn.length) : ""].filter(Boolean).join(" · ");
  const tip = [head, ...rows.slice(0, MAX_SVC_LINES), ...more, ...(nHidden ? [`[[off:${tx("{0} masqué(s) de « À surveiller »", nHidden)}]]`] : []), ...(onOpen ? [tipAction(tx("Clic : liste des services de {0}", m.name))] : [])].join("\n");
  const inner = <>
    <span className="tabular-nums group-hover:text-link">{m.services}</span>
    {nDown > 0 && <span className="text-xs font-semibold tabular-nums text-bad">+{nDown}</span>}
    {warn.length > 0 && <span className="text-xs font-semibold tabular-nums text-warn">+{warn.length}</span>}
  </>;
  if (!onOpen) return <span className="inline-flex items-baseline gap-1.5" title={tip}>{inner}</span>;
  return <button type="button" onClick={onOpen} title={tip} aria-label={tx("Voir les services de {0}", m.name)} className="group inline-flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-link/10">{inner}</button>;
}

/** Compact machine card: who, state, system, figures, servers and what to watch; « Details » unfolds the same detail as the table,
 *  the card then taking the whole row. A Home Assistant machine shows its add-on icons. */
function MachineCard({ m, h, snap, scan, os, watch, ha, unifi, off, state, shown, onToggle, onMachine, detail }: Readonly<{
  m: Machine; h?: HealthHost; snap: Snapshot; scan?: { os?: string; apps: string[]; ssh?: boolean }; os: OsKind | null; watch: WatchItem[]; ha?: ServiceStatus; unifi?: UnifiDevice;
  off: boolean; state: React.ReactNode; shown: boolean; onToggle: () => void; onMachine: (ip: string) => void; detail: React.ReactNode;
}>) {
  const up = uptimeOf(m, unifi, freeboxOf(m, snap.data.network), ha);
  const edge = LEVEL_EDGE[levelKey(h)] ?? "";
  return (
    <div className={`flex flex-col gap-2.5 overflow-hidden rounded-xl border border-l-[3px] border-line bg-card p-3 transition-colors hover:border-link/50 ${edge} ${shown ? "col-span-full" : ""} ${off ? "opacity-50" : ""}`}>
      <div className="-mx-3 -mt-3 flex items-center gap-2.5 border-b border-line/60 bg-bg px-3 py-2.5">
        <AlertDot items={watch}><MachineIcon m={{ ...m, model: modelOf(m, snap.data.network, unifi) }} scan={scan} reserve /></AlertDot>
        <button type="button" onClick={() => onMachine(m.ip)} className="min-w-0 flex-1 text-left" title={tipAction(tx("Clic : liste des services de {0}", m.name))}>
          <b className="flex items-center gap-1.5 truncate font-semibold hover:text-link"><VmMark m={m} h={h} /><span className={`truncate ${vmName(m, h)}`}>{m.name}</span></b>
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
      <ResStrip h={h} first={<Stat label={tx("Services")}><b><ServiceCount m={m} snap={snap} /></b></Stat>} />
      <div className="flex min-h-7 items-center justify-between gap-2">
        {ha?.addons?.length ? <AddonStrip s={ha} max={6} /> : <Servers m={m} snap={snap} max={4} />}{/* Home Assistant: its add-ons stand for the servers */}
        <WatchList ip={m.ip} items={watch} />
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
  const [ignored, setIgnored] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem(KERNEL_KEY) ?? "{}") as Record<string, string>; } catch { return {}; } });
  const setIgnore = useCallback((id: string, sig: string | null) => setIgnored((cur) => {
    const next = { ...cur }; if (sig === null) delete next[id]; else next[id] = sig;
    try { localStorage.setItem(KERNEL_KEY, JSON.stringify(next)); } catch { /* private browsing: not kept */ }
    return next;
  }), []);
  const anyGpu = useMemo(() => snap.data.machine_list.some((m) => !m.disabled && gpusOf(m, hb.get(m.ip)).length > 0), [snap.data.machine_list, hb]);   // the column exists only when some machine has a GPU to show
  const ignoreCtx = useMemo(() => ({ ignored, set: setIgnore }), [ignored, setIgnore]);
  const hiddenSvc = useServicesHidden();   // a service hidden from « To watch » no longer counts here either
  const watchOf = useCallback((m: Machine) => {
    const h = hb.get(m.ip), [shownM, downList] = withShownDown(m, snap.data.hosts, hiddenSvc);
    const items = watchItems(shownM, h, snap.data.connectors ?? [], !!freeboxOf(m, snap.data.network) || !!unifiOf(m), downList);
    return h && ignored[h.id] === kernelSig(h.kernel?.samples) ? items.filter((i) => i.kind !== "kernel") : items;   // set aside by the viewer, until a newer message
  }, [hb, snap.data.connectors, snap.data.network, snap.data.hosts, unifiOf, ignored, hiddenSvc]);
  const facets = useMemo((): Facet<Machine>[] => [
    { key: "state", label: tx("État"), get: mState, name: (v) => MSTATE[v as MState][1], order: ORDER, mark: (v) => <Dot tone={MSTATE[v as MState][0]} /> },
    { key: "health", label: tx("Santé"), get: (m) => { const h = hb.get(m.ip); return h ? (h.reachable === false ? "down" : h.level) : ""; },
      name: (v) => ({ ok: "OK", warn: tx("à surveiller"), crit: "critique", down: "injoignable" } as Record<string, string>)[v] || v, order: ["ok", "warn", "crit", "down"], mark: (v) => <Dot tone={LEVEL[v]?.[0] ?? "off"} /> },
    { key: "alert", label: tx("Alertes"), get: (m) => { const w = worst(watchOf(m)); return w ? TONE_OF_RANK[w] : ""; },
      name: (v) => ({ bad: tx("problème à regarder"), warn: tx("à surveiller"), info: tx("information") } as Record<string, string>)[v] || v, order: ["bad", "warn", "info"], mark: (v) => <Dot tone={v === "bad" ? "bad" : v === "warn" ? "warn" : "info"} /> },
    { key: "os", label: tx("Système"), get: (m) => osOf(m) ?? "", name: (v) => OS_LABEL[v as OsKind], order: OS_ORDER, mark: (v) => <OsGlyph kind={v as OsKind} size={13} /> },
    { key: "access", label: tx("Accès"), get: (m) => (m.ssh ? "ssh" : m.agent ? "agent" : "none"), name: (v) => ({ ssh: "SSH", agent: tx("Agent"), none: tx("aucun") } as Record<string, string>)[v], order: ["ssh", "agent", "none"],
      mark: (v) => <Dot tone={v === "none" ? "off" : "ok"} /> },
    { key: "role", label: tx("Rôle"), get: (m) => rolesOf(m.role) },
    { key: "user", label: tx("Compte SSH"), get: (m) => m.ssh?.user || "" },
  ], [hb, osOf, watchOf]);
  const text = useCallback((m: Machine) => [m.name, m.ip, m.role, stateBadge(m)[1], m.ssh?.alias, m.ssh?.user, m.info?.os].join(" "), []);
  // « Ne plus suivre » se règle uniquement dans Réglages → Machines (interrupteur « Machine suivie ») ; ici, les machines non suivies restent masquées d'office.
  const isOff = (m: Machine) => !!m.disabled;
  // Machines non suivies : masquées d'office, un bouton les ramène (grisées)
  const [showOff, setShowOff] = useState(false);
  const nOff = snap.data.machine_list.filter(isOff).length;
  const items = useMemo(() => (showOff ? snap.data.machine_list : snap.data.machine_list.filter((m) => !isOff(m))), [snap.data.machine_list, showOff, isOff]);
  const f = useFilter(items, facets, text, initial);
  // Home Assistant running on this machine (its address points here): its add-ons in the unfolded detail
  const haOf = (m: Machine) => (snap.data.services_status ?? []).find((c) => c.connector === "home-assistant" && c.url && new URL(c.url).hostname === m.ip);
  const keyOf = useCallback((m: Machine, k: string): string | number => {
    switch (k) {
      case "name": return m.name.toLowerCase();
      case "state": return ORDER.indexOf(mState(m));
      case "os": return m.info?.os || "~";
      case "svc": return -m.services;
      case "health": return healthRank(m, hb.get(m.ip), !!(m.ssh || m.agent || haOf(m) || m.links?.sources.some((x) => x.source === "beszel"))) * 1e10 + ipNum(m.ip);   // les plus graves d'abord, puis par adresse
      case "up": return -(uptimeOf(m, unifiOf(m), freeboxOf(m, snap.data.network), haOf(m)) ?? -1);   // the longest up first
      case "cpu": return -(hb.get(m.ip)?.res?.cpu_pct ?? -1);   // the busiest first; unread machines last
      case "mem": return -(hb.get(m.ip)?.res?.mem_pct ?? -1);
      case "disk": return -(topDisk(hb.get(m.ip))?.used_pct ?? -1);
      case "gpu": return -Math.max(-1, ...gpusOf(m, hb.get(m.ip)).map((g) => g.util ?? 0));   // the most used GPU of the machine
      case "watch": { const it = watchOf(m); return -(worst(it) * 100 + it.length); }   // le plus grave d'abord
      default: return ipNum(m.ip);
    }
  }, [hb, snap.data.network, snap.data.services_status, unifiOf, watchOf]);
  const sort = useSort(f.shown, keyOf, "ip");
  // Tableau sur une seule ligne par machine ; un clic sur le chevron (ou « Tout déplier ») montre le détail
  const [focus, setFocus] = useState<{ kind: WatchKind; n: number } | null>(null);   // the notice whose section the opened window shows
  const pickWatch = useCallback((ip: string, kind: WatchKind) => { setFocus((f) => ({ kind, n: (f?.n ?? 0) + 1 })); openPage(ip); }, []);
  // The page of one machine (#machines/<ip>, /access for its settings): the address is the state, so a link, a reload or « back » all work
  const [target, setTarget] = useState(() => machineFromHash(location.hash));
  useEffect(() => { const on = () => setTarget(machineFromHash(location.hash)); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  const pageM = target ? snap.data.machine_list.find((x) => x.ip === target.ip) : undefined;
  const admin = snap.me.role === "admin";
  const detailOf = (m: Machine, extra?: React.ReactNode) => {
    const h = hb.get(m.ip);
    return <Detail extra={extra} m={m} h={h} watch={watchOf(m)} mac={macOf(m)} net={seen.get(m.ip)} from={originsOf(m, snap, h, !!scanOs[m.ip]?.os, seen.has(m.ip))} npmIps={snap.data.npm_instances} hosts={snap.data.hosts} onFilter={onFilter} focus={focus} backups={snap.backups} ha={haOf(m)} unifi={unifiOf(m)} unifiSys={unifiOf(m) ? sysUnifi : undefined} unifiNet={unifiNetwork} freebox={freeboxOf(m, snap.data.network)} sheet={snap.data.sheets?.[m.ip]} pve={snap.data.virtualization?.find((c) => c.connector === "proxmox" && c.version && (c.ip === m.ip || c.name === m.links?.hypervisor?.instance))?.version ?? undefined} />;
  };
  const [view, pickView] = useStoredView("ms.machines.view", "table");  // Tableau ou Cartes, retenu

  // Inventaire de MynetworK (connecteur « network ») : MAC et fabricant sous l'IP, et les appareils vus mais pas suivis
  const seen = useMemo(() => new Map((snap.data.network ?? []).flatMap((c) => c.devices ?? []).map((d) => [d.ip, d])), [snap.data.network]);
  const macOf = (m: Machine) => { const d = seen.get(m.ip); const mac = d?.mac || m.links?.mac, vendor = d?.vendor || m.links?.vendor; return mac || vendor ? [mac, vendor].filter(Boolean).join(" · ") : undefined; };
  // Sources de lecture (SSH, agent, connecteurs), un badge court coloré par source ; la Freebox est lue par MynetworK (rapprochée par son nom)
  const st = (m: Machine, all: boolean) => {
    const fb = freeboxOf(m, snap.data.network) && snap.data.network?.find((c) => c.freebox?.system);
    return <SourceBadges all={all} m={m} extra={fb ? [{ type: fb.connector, name: fb.name, label: fb.label }] : []} />;
  };

  return (
    <PickWatch.Provider value={pickWatch}>
    <KernelIgnore.Provider value={ignoreCtx}>
    {pageM ? (
      <MachinePage snap={snap} m={pageM} scan={scanOs[pageM.ip]} model={modelOf(pageM, snap.data.network, unifiOf(pageM))} state={st(pageM, true)} detail={(extra) => detailOf(pageM, extra)}
        figures={machineFigures(hb.get(pageM.ip), uptimeOf(pageM, unifiOf(pageM), freeboxOf(pageM, snap.data.network), haOf(pageM)) ?? null, watchOf(pageM).find((w) => w.tone !== "info")?.text)}
        onMachine={onMachine} focusTab={target?.tab} onBack={() => { location.hash = "machines"; }} />
    ) : <div className="py-1">
      <FilterBar f={f} placeholder={tx("Nom, IP, rôle, système, compte SSH…")}
        options={[
          ...(nOff > 0 ? [{ id: "off", label: tx("Désactivées"), on: showOff, toggle: () => setShowOff(!showOff), mark: showOff ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />, count: nOff }] : []),
        ]}
        extra={<>
          {admin && <a href="#settings/machines/redetect" className={`${quiet} no-underline`} title={tx("Relit toutes les machines et propose les écarts (rôles, système, services hors Docker)")}><RefreshCw size={14} aria-hidden />{tx("Redétecter")}</a>}
          {admin && <a href="#settings/machines/new" className={`${primary} no-underline`}><Plus size={14} aria-hidden />{tx("Ajouter une machine")}</a>}{/* the page « Add and detect », its form or the redetection open */}
          <ViewToggle view={view} onPick={pickView} />
        </>} />
      {sort.sorted.length === 0 ? <Empty>{tx("Aucune machine pour ce filtre.")}</Empty> : (
        <>
          {view === "table" && <Table fit head={<>
            <th className="w-14 pl-4 pr-2" aria-label={tx("Icône")} /><Th k="name" sort={sort}>{tx("Machine")}</Th><Th k="ip" sort={sort}>IP</Th><Th k="state" sort={sort}>{tx("Sources")}</Th><Th k="os" sort={sort}>{tx("Système")}</Th>
            <Th k="svc" sort={sort}>{tx("Services")}</Th><Th k="watch" sort={sort}>{tx("Santé")}</Th>{snap.health && <><Th k="cpu" sort={sort} className="!px-1.5">{tx("CPU")}</Th><Th k="mem" sort={sort} className="!px-1.5">{tx("Mémoire")}</Th><Th k="disk" sort={sort} className="!px-1.5">{tx("Disque")}</Th></>}{anyGpu && <Th k="gpu" sort={sort} className="!px-1.5">GPU</Th>}
            <Th k="up" sort={sort} className="w-px !pl-2 !pr-1 !text-right" title={tx("Temps depuis le dernier démarrage de la machine")}>Uptime</Th>
            {admin && <th className="w-8 px-1" aria-label={tx("Réglages")} />}
          </>}>
            {sort.sorted.map((m) => {
              const h = hb.get(m.ip), pills = watchOf(m).filter((i) => i.kind !== "updates");
              return (
                <Fragment key={m.ip}>
                  <tr className={`cursor-pointer outline-none even:bg-bg/50 hover:!bg-bg2/60 focus-visible:!bg-bg2/60 [&>td]:!py-3.5 ${isOff(m) ? "opacity-50" : ""}`}
                    tabIndex={0} aria-haspopup="dialog" aria-label={tx("Détails de {0}", m.name)}
                    onClick={(e) => { if (!(e.target as Element).closest("button, a, input, select, label, summary, [role=button]")) openPage(m.ip); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) openPage(m.ip); }}>{/* toute la ligne ouvre le détail, sauf ses boutons et liens ; au clavier : Entrée sur la ligne */}
                    <td className="w-14 pl-4 pr-2 py-2 align-middle"><MachineIcon m={{ ...m, model: modelOf(m, snap.data.network, unifiOf(m)) }} scan={scanOs[m.ip]} reserve /></td>
                    <Td><span className="flex items-center gap-2"><VmMark m={m} h={h} /><b className={`font-semibold ${vmName(m, h)}`}>{m.name}</b><ProblemFlag h={h} /></span></Td>
                    <Td className="whitespace-nowrap font-mono text-xs tabular-nums text-dim">{m.ip}</Td>{/* the tools that see it (can be many): in the unfolded detail only */}
                    <Td>{st(m, false)}</Td>
                    <Td><div className="max-w-[11rem]"><SystemLine m={m} os={osOf(m)} ha={haOf(m)} unifi={unifiOf(m)} freebox={freeboxOf(m, snap.data.network)} /></div></Td>
                    <Td><ServiceCount m={m} snap={snap} onOpen={() => onMachine(m.ip)} /></Td>
                    <Td><span className="flex flex-wrap items-center gap-1.5 [&>span]:h-6">{/* same height (24 px) for the level badge and the cause badges; one column: the level, then what explains it (the updates have their flag near the name) */}
                      {snap.health && <HealthLevel m={m} h={h} pills={pills.length > 0} followed={!!(m.ssh || m.agent || haOf(m) || m.links?.sources.some((x) => x.source === "beszel"))} />}
                      <WatchList ip={m.ip} quiet={!!snap.health} items={pills} /></span></Td>
                    {snap.health && <><Td className="!px-1.5"><MeterCell h={h} what="cpu" /></Td><Td className="!px-1.5"><MeterCell h={h} what="mem" /></Td><Td className="!px-1.5"><MeterCell h={h} what="disk" /></Td></>}{anyGpu && <Td className="!px-1.5"><GpuCellView list={gpusOf(m, hb.get(m.ip))} /></Td>}
                    <Td className="w-px whitespace-nowrap !pl-2 !pr-1 text-right text-xs tabular-nums">{(() => { const up = uptimeOf(m, unifiOf(m), freeboxOf(m, snap.data.network), haOf(m)); return up ? <span className={up < 3600 ? "text-warn" : "text-muted"} title={`${dur(up)}${up < 3600 ? ` · ${tx("vient de redémarrer")}` : ""}`}>{durShort(up)}</span> : <Dim>-</Dim>; })()}</Td>
                    {admin && <td className="w-8 px-1 py-2 align-middle"><button type="button" onClick={() => openPage(m.ip, "settings")} aria-label={tx("Réglages de {0}", m.name)} title={tx("Réglages de cette machine")}
                      className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-bg2 hover:text-txt"><SlidersHorizontal size={14} aria-hidden /></button></td>}
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
                  state={st(m, false)} shown={false} onToggle={() => openPage(m.ip)} onMachine={onMachine}
                  detail={null} />
              );
            })}
          </Cards>
        </>
      )}
    </div>}
    </KernelIgnore.Provider>
    </PickWatch.Provider>
  );
}
