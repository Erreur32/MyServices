// The page of one machine (#machines/<ip>): what the Machines tab showed in a window (identity, system, access, software, backups, health,
// updates, UniFi or Freebox), its availability over 30 days, and, for an administrator, its settings (identity, options, access) in the page:
// the window of Réglages → Machines is no longer needed for a machine that exists. Back to the list with « Machines ».
import { ArrowLeft, ArrowRight, Boxes, EthernetPort, Globe, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { read, type Snapshot } from "../api";
import { MachineIcon } from "../components/MachineIcon";
import { dateTime } from "../lib/format";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { availabilityOf } from "../lib/machineHash";
import { guestsOf, portRows, type PortRow } from "../lib/machinePage";
import { serviceIcon } from "../lib/appIcons";
import { KIND_NAME, status, type StatusClass } from "../lib/status";
import { Dot } from "../components/marks";
import type { Machine } from "../types";
import { cellColor, pct, pctTone, type Item, type Report } from "./Availability";
import { MachineModal } from "./MachinesSettings";
import { COLOR, StatTile } from "../components/StatTile";
import type { MachineFigure } from "../lib/machineFigures";
import { METRIC_COLUMN, minMax, sparkPath, type MetricKey, type MetricPoint } from "../lib/sparkline";

const DAYS = 30;

/** The last 24 hours of one figure under its value, in the colour of its state; the lowest and highest in the tooltip */
function Sparkline({ points, k, tone, unit }: Readonly<{ points: MetricPoint[]; k: MetricKey; tone: MachineFigure["tone"]; unit: string }>) {
  const now = Date.now() / 1000, d = sparkPath(points, k, now), range = minMax(points, k, now);
  if (!d || !range) return null;
  const title = tx("24 h : de {0} à {1}", `${Math.round(range[0])}${unit}`, `${Math.round(range[1])}${unit}`);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={`mt-auto h-6 w-full pt-1 ${tone ? COLOR[tone] : "text-muted"}`} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Availability over 30 days as one more tile of the figures, wider: the share answered, the samples, and a cell per day */
function AvailabilityTile({ item }: Readonly<{ item: Item | null | undefined }>) {
  return (
    <div className="flex min-w-[15rem] flex-[2.5] flex-col rounded-xl border border-line bg-card px-2 py-1.5" aria-label={tx("Disponibilité, {0} jours", DAYS)}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
        {tx("Disponibilité, {0} jours", DAYS)}
        {item?.last && <span className="ml-auto text-dim">{item.last.up ? tx("répond") : tx("ne répond pas")} · {dateTime(item.last.ts * 1000)}</span>}
      </div>
      {item === undefined && <span className="text-[11px] text-dim">{tx("Chargement…")}</span>}
      {item === null && <span className="text-[11px] text-muted">{tx("Pas encore de relevé de disponibilité pour cette machine : il se construit à chaque collecte.")}</span>}
      {item && (
        <>
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-base font-bold leading-tight ${pctTone(item.uptime)}`}>{pct(item.uptime)}</span>
            <span className="truncate text-[11px] text-dim">{tx("{0} relevés, {1} en échec", item.samples, item.down)}{item.ms != null && ` · ${item.ms} ms`}</span>
          </div>
          <div className="mt-auto grid gap-0.5 pt-1" style={{ gridTemplateColumns: `repeat(${item.cells.length}, minmax(0, 1fr))` }} role="img" aria-label={tx("{0} jours, une case par jour", item.cells.length)}>
            {item.cells.map((c) => <span key={c.t} className={`h-5 rounded-sm ${cellColor(c.pct)}`} title={`${dateTime(c.t * 1000)} : ${c.pct == null ? tx("aucun relevé") : pct(c.pct)}`} />)}
          </div>
          <p className="mt-0.5 flex justify-between text-[10px] uppercase tracking-wide text-dim"><span>{tx("il y a {0} jours", DAYS)}</span><span>{tx("aujourd'hui")}</span></p>
        </>
      )}
    </div>
  );
}

/** The open ports of the machine, each matched to its service (its icon, kind and state) and to the NPM domains that expose it; an unknown port is told so,
 *  with what usually listens there. A port of a known service not seen open by the last scan is faded. */
function PortsCard({ snap, m, onMachine }: Readonly<{ snap: Snapshot; m: Machine; onMachine: (ip: string) => void }>) {
  const sheet = snap.data.sheets?.[m.ip], rows = portRows(m, snap.data.hosts, sheet);
  if (!rows.length) return null;
  const scanned = !!sheet?.scan, at = sheet?.scan?.ports_at;
  return (
    <section className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Ports ouverts")}>
      <div className="-mx-4 -mt-4 mb-2 flex flex-wrap items-center gap-2 border-b border-line/60 bg-bg px-4 py-2">
        <h2 className="flex items-center gap-2 font-bold"><EthernetPort size={16} aria-hidden />{tx("Ports ouverts")} <span className="text-sm font-normal text-dim">{rows.length}{at && ` · ${tx("scannés le {0}", dateTime(at))}`}</span></h2>
        <button type="button" onClick={() => onMachine(m.ip)} className={`${quiet} ml-auto`}>{tx("Ses services")}<ArrowRight size={14} aria-hidden /></button>
      </div>
      <table className="mt-2 w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="w-4 py-1 pr-2" aria-label={tx("État")} /><th className="py-1 pr-3 font-semibold">{tx("Service")}</th><th className="py-1 pr-3 font-semibold">{tx("Port")}</th><th className="py-1 font-semibold">{tx("Exposé")}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const unseen = scanned && !r.listening && !!r.host, st = r.host ? status(r.host) : null;
            const cls: StatusClass = st?.[0] ?? "warn", label = st?.[1] ?? tx("port inconnu");
            return (
              <tr key={r.port} className={`border-t border-line/60 even:bg-bg/50 ${unseen ? "opacity-55" : ""}`}>
                <td className="py-1.5 pr-2" title={unseen ? tx("pas vu ouvert au dernier scan") : label}><Dot tone={unseen ? "off" : cls} /></td>
                <td className="py-1.5 pr-3"><PortService r={r} /></td>
                <td className="py-1.5 pr-3 font-mono text-xs tabular-nums text-muted">:{r.port}</td>
                <td className="py-1.5"><PortExposure r={r} unseen={unseen} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Where a port is reached from: the NPM domains that expose it (each opens the site), else the LAN; not seen by the last scan: said so */
function PortExposure({ r, unseen }: Readonly<{ r: PortRow; unseen: boolean }>) {
  if (unseen) return <span className="text-xs text-dim">{tx("pas vu ouvert au dernier scan")}</span>;
  if (!r.domains.length) return <span className="rounded-md border border-line px-1.5 py-0.5 text-xs text-dim" title={tx("Joignable seulement depuis le réseau local")}>LAN</span>;
  return (
    <span className="flex flex-wrap gap-1">{r.domains.map((d) => (
      <a key={d} href={`https://${d}`} target="_blank" rel="noreferrer" title={tx("Exposé sur Internet par NPM")} className="inline-flex items-center gap-1 rounded-md border border-link/40 bg-link/10 px-1.5 py-0.5 text-xs text-link no-underline hover:border-link"><Globe size={11} aria-hidden />{d}</a>
    ))}</span>
  );
}

/** The service of a port: its icon (or a generic mark), its name and its kind; unknown: a « ? » and what usually listens there */
function PortService({ r }: Readonly<{ r: PortRow }>) {
  const box = "grid h-5 w-5 shrink-0 place-items-center rounded border";
  if (!r.host || !r.name) return (
    <span className="inline-flex items-center gap-2">
      <span className={`${box} border-warn/50 text-[11px] font-bold text-warn`} aria-hidden>?</span>
      <span className="text-warn">{tx("inconnu")}</span>
      {r.guess && <span className="text-xs text-dim" title={tx("Supposition d'après le numéro de port, rien n'a été vérifié")}>{tx("souvent : {0}", r.guess)}</span>}
    </span>
  );
  const icon = serviceIcon(r.host), kind = r.host.service?.kind;
  return (
    <span className="inline-flex items-center gap-2">
      {icon ? <img src={icon} alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" /> : <span className={`${box} border-line bg-bg2 text-dim`} aria-hidden><EthernetPort size={11} /></span>}
      <b className="font-semibold">{r.name}</b>
      {kind && KIND_NAME[kind] && kind !== "inconnu" && <span className="rounded border border-line px-1 text-[10.5px] text-dim">{KIND_NAME[kind]}</span>}
    </span>
  );
}

const GUEST_KIND: Record<string, string> = { qemu: "VM", vm: "VM", lxc: "LXC" };

/** The guests (VMs, containers) of a machine that is a hypervisor host; a guest followed as a machine here opens its page */
function GuestsCard({ snap, m }: Readonly<{ snap: Snapshot; m: Machine }>) {
  const rows = guestsOf(m, snap.data.virtualization, snap.data.machine_list);
  if (!rows.length) return null;
  const running = rows.filter((r) => r.guest.status === "running").length;
  return (
    <section className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Machines virtuelles")}>
      <div className="-mx-4 -mt-4 mb-2 flex flex-wrap items-center gap-2 border-b border-line/60 bg-bg px-4 py-2">
        <h2 className="flex items-center gap-2 font-bold"><Boxes size={16} aria-hidden />{tx("Machines virtuelles")} <span className="text-sm font-normal text-dim">{tx("{0} en marche sur {1}", running, rows.length)}</span></h2>
        <a href="#virtualization" className={`${quiet} ml-auto no-underline`}>{tx("Virtualisation")}<ArrowRight size={14} aria-hidden /></a>
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-line/60 text-sm">
        {rows.map(({ guest: g, machineIp }) => (
          <li key={`${g.node}/${g.vmid}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
            <Dot tone={g.status === "running" ? "ok" : "off"} />
            <span className="rounded-md border border-line bg-bg2 px-1.5 py-0.5 text-[11px] text-muted">{GUEST_KIND[g.type] ?? g.type} {g.vmid}</span>
            {machineIp ? <a href={`#machines/${machineIp}`} className="font-semibold text-txt hover:text-link">{g.name ?? g.vmid}</a> : <b className="font-semibold">{g.name ?? g.vmid}</b>}
            <span className="ml-auto text-xs tabular-nums text-muted">
              {g.status === "running" ? <>{g.cpu_pct != null && `CPU ${Math.round(g.cpu_pct)} %`}{g.mem_pct != null && ` · ${tx("mém.")} ${Math.round(g.mem_pct)} %`}</> : (g.status ?? tx("arrêtée"))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The page of one machine: its information (#machines/<ip>), or its settings alone (#machines/<ip>/settings; /access opens them on the Access tab) */
export function MachinePage({ snap, m, scan, model, state, detail, figures, onMachine, focusTab, onBack }: Readonly<{
  snap: Snapshot; m: Machine; scan?: { os?: string; apps: string[]; ssh?: boolean }; model?: string; state: ReactNode;
  detail: (extra: ReactNode) => ReactNode; figures: MachineFigure[];   // detail: the wall of cards, `extra` the cards of this page added at its end
  onMachine: (ip: string) => void; focusTab?: "settings" | "access"; onBack: () => void;
}>) {
  const admin = snap.me.role === "admin";
  const head = (back: ReactNode, right: ReactNode) => (
    <div className="flex flex-wrap items-center gap-3">
      {back}
      <MachineIcon m={{ ...m, model }} scan={scan} reserve />
      <h1 className="text-xl font-bold">{m.name}</h1>
      <span className="font-mono text-sm text-dim">{m.ip}</span>
      <span className="flex flex-wrap items-center gap-1">{state}</span>
      <span className="ml-auto flex flex-wrap gap-2">{right}</span>
    </div>
  );
  if (focusTab && admin) return <MachineSettingsPage m={m} snap={snap} head={head} access={focusTab === "access"} />;
  return <MachineInfoPage m={m} snap={snap} detail={detail} figures={figures} admin={admin} onMachine={onMachine} onBack={onBack} head={head} />;
}

type Head = (back: ReactNode, right: ReactNode) => ReactNode;

const backButton = (label: string, onClick: () => void) => (
  <button type="button" onClick={onClick} className="group inline-flex items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-2.5 pr-4 text-sm font-semibold text-muted transition-colors hover:border-link hover:text-txt">
    <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{label}
  </button>
);

/** What MyServices knows of the machine: state, health, software, backups, availability, ports, guests; its settings are one click away */
function MachineInfoPage({ m, snap, detail, figures, admin, onMachine, onBack, head }: Readonly<{
  m: Machine; snap: Snapshot; detail: (extra: ReactNode) => ReactNode; figures: MachineFigure[]; admin: boolean; onMachine: (ip: string) => void; onBack: () => void; head: Head;
}>) {
  const [avail, setAvail] = useState<Item | null | undefined>(undefined);
  useEffect(() => {
    read<Report>(`availability?days=${DAYS}`).then((r) => setAvail(availabilityOf(r.items, m) ?? null)).catch(() => setAvail(null));
  }, [m.ip, m.name, snap.data.generated]);   // eslint-disable-line react-hooks/exhaustive-deps -- m.ip and m.name are what the lookup needs
  const readAt = figures.find((f) => f.key === "health")?.at;
  const [points, setPoints] = useState<MetricPoint[]>([]);
  useEffect(() => {
    read<{ points: MetricPoint[] }>(`machines/${m.ip}/metrics`).then((r) => setPoints(r.points ?? [])).catch(() => setPoints([]));
  }, [m.ip, readAt]);   // read again after each reading of this machine
  const right = <>
    {m.services > 0 && <button type="button" onClick={() => onMachine(m.ip)} className={quiet}>{tx("Voir ses services")}<ArrowRight size={14} aria-hidden /></button>}
    {admin && <a href={`#machines/${m.ip}/settings`} className={`${quiet} no-underline`}><SlidersHorizontal size={14} aria-hidden />{tx("Réglages")} ›</a>}
  </>;
  return (
    <div className="flex flex-col gap-4 py-4">
      {head(backButton(tx("Machines"), onBack), right)}
      <div className="flex flex-wrap items-stretch gap-2">
        {figures.map((f) => (
          <StatTile key={f.key} small n={f.value} label={f.label} sub={f.sub} tone={f.tone}>
            {f.key in METRIC_COLUMN && <Sparkline points={points} k={f.key as MetricKey} tone={f.tone} unit={f.key === "temp" ? " °C" : " %"} />}
            {f.at && <div className="mt-auto truncate pt-1 text-[11px] text-dim">{tx("relevé le {0}", dateTime(f.at))}</div>}
          </StatTile>
        ))}
        <AvailabilityTile item={avail} />
      </div>
      {detail(<>
        <PortsCard snap={snap} m={m} onMachine={onMachine} />
        <GuestsCard snap={snap} m={m} />
      </>)}
    </div>
  );
}

/** The settings of the machine alone: identity, options and access (SSH, agent, connectors), opened on the Access tab for /access */
function MachineSettingsPage({ m, snap, head, access }: Readonly<{ m: Machine; snap: Snapshot; head: Head; access: boolean }>) {
  return (
    <div className="flex flex-col gap-4 py-4">
      {head(backButton(m.name, () => { location.hash = `machines/${m.ip}`; }), null)}
      <section className="rounded-2xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Réglages de cette machine")}>
        <h2 className="flex items-center gap-2 font-bold"><SlidersHorizontal size={16} aria-hidden />{tx("Réglages de cette machine")}</h2>
        <p className="mt-1 text-sm text-muted">{tx("Identité, options et accès (SSH, agent, connecteurs) : chaque réglage s'enregistre à la saisie, « Enregistrer » ne sert qu'au nom et aux champs libres.")}</p>
        <MachineModal ip={m.ip} snap={snap} focusTab={access ? "access" : undefined} />
      </section>
    </div>
  );
}
