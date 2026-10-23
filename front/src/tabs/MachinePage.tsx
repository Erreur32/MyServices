// The page of one machine (#machines/<ip>): what the Machines tab showed in a window (identity, system, access, software, backups, health,
// updates, UniFi or Freebox), its availability over 30 days, and, for an administrator, its settings (identity, options, access) in the page:
// the window of Réglages → Machines is no longer needed for a machine that exists. Back to the list with « Machines ».
import { ArrowLeft, ArrowRight, Boxes, CalendarCheck, EthernetPort, Globe, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

const DAYS = 30;

/** One cell per day over 30 days (the same cells as Historique → Disponibilité), the rate and the last state */
function AvailabilityCard({ item }: Readonly<{ item: Item | null | undefined }>) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Disponibilité, {0} jours", DAYS)}>
      <h2 className="flex items-center gap-2 font-bold"><CalendarCheck size={16} aria-hidden />{tx("Disponibilité, {0} jours", DAYS)}</h2>
      {item === undefined && <p className="mt-2 text-sm text-dim">{tx("Chargement…")}</p>}
      {item === null && <p className="mt-2 text-sm text-muted">{tx("Pas encore de relevé de disponibilité pour cette machine : il se construit à chaque collecte.")}</p>}
      {item && (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className={`text-2xl font-bold tabular-nums ${pctTone(item.uptime)}`}>{pct(item.uptime)}</span>
            <span className="text-sm text-muted">{tx("{0} relevés, {1} en échec", item.samples, item.down)}{item.ms != null && ` · ${item.ms} ms`}</span>
            {item.last && <span className="ml-auto text-xs text-dim">{item.last.up ? tx("répond") : tx("ne répond pas")} · {dateTime(item.last.ts * 1000)}</span>}
          </div>
          <div className="mt-3 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${item.cells.length}, minmax(0, 1fr))` }} role="img" aria-label={tx("{0} jours, une case par jour", item.cells.length)}>
            {item.cells.map((c) => <span key={c.t} className={`h-5 rounded-sm ${cellColor(c.pct)}`} title={`${dateTime(c.t * 1000)} : ${c.pct == null ? tx("aucun relevé") : pct(c.pct)}`} />)}
          </div>
          <p className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-dim"><span>{tx("il y a {0} jours", DAYS)}</span><span>{tx("aujourd'hui")}</span></p>
        </>
      )}
    </section>
  );
}

/** The open ports of the machine, each matched to its service (its icon, kind and state) and to the NPM domains that expose it; an unknown port is told so,
 *  with what usually listens there. A port of a known service not seen open by the last scan is faded. */
function PortsCard({ snap, m, onMachine }: Readonly<{ snap: Snapshot; m: Machine; onMachine: (ip: string) => void }>) {
  const sheet = snap.data.sheets?.[m.ip], rows = portRows(m, snap.data.hosts, sheet);
  if (!rows.length) return null;
  const scanned = !!sheet?.scan, at = sheet?.scan?.ports_at;
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Ports ouverts")}>
      <div className="flex flex-wrap items-center gap-2">
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
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Machines virtuelles")}>
      <div className="flex flex-wrap items-center gap-2">
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

export function MachinePage({ snap, m, scan, model, state, detail, onMachine, focusTab, onBack }: Readonly<{
  snap: Snapshot; m: Machine; scan?: { os?: string; apps: string[]; ssh?: boolean }; model?: string; state: ReactNode; detail: ReactNode;
  onMachine: (ip: string) => void; focusTab?: "access"; onBack: () => void;
}>) {
  const admin = snap.me.role === "admin";
  const [avail, setAvail] = useState<Item | null | undefined>(undefined);
  useEffect(() => {
    read<Report>(`availability?days=${DAYS}`).then((r) => setAvail(availabilityOf(r.items, m) ?? null)).catch(() => setAvail(null));
  }, [m.ip, m.name, snap.data.generated]);   // eslint-disable-line react-hooks/exhaustive-deps -- m.ip and m.name are what the lookup needs
  const settings = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusTab) setTimeout(() => settings.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150); }, [focusTab]);   // #machines/<ip>/access : the settings, Access tab
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="group inline-flex items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-2.5 pr-4 text-sm font-semibold text-muted transition-colors hover:border-link hover:text-txt">
          <ArrowLeft size={16} aria-hidden className="transition-transform group-hover:-translate-x-0.5" />{tx("Machines")}
        </button>
        <MachineIcon m={{ ...m, model }} scan={scan} reserve />
        <h1 className="text-xl font-bold">{m.name}</h1>
        <span className="font-mono text-sm text-dim">{m.ip}</span>
        <span className="flex flex-wrap items-center gap-1">{state}</span>
        {m.services > 0 && <button type="button" onClick={() => onMachine(m.ip)} className={`${quiet} ml-auto`}>{tx("Voir ses services")}<ArrowRight size={14} aria-hidden /></button>}
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-bg2/40 shadow-sm">{detail}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AvailabilityCard item={avail} />
        <PortsCard snap={snap} m={m} onMachine={onMachine} />
        <GuestsCard snap={snap} m={m} />
      </div>
      {admin && (
        <section ref={settings} className="scroll-mt-24 rounded-2xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Réglages de cette machine")}>
          <h2 className="flex items-center gap-2 font-bold"><SlidersHorizontal size={16} aria-hidden />{tx("Réglages de cette machine")}</h2>
          <p className="mt-1 text-sm text-muted">{tx("Identité, options et accès (SSH, agent, connecteurs) : chaque réglage s'enregistre à la saisie, « Enregistrer » ne sert qu'au nom et aux champs libres.")}</p>
          <MachineModal ip={m.ip} snap={snap} focusTab={focusTab} />
        </section>
      )}
    </div>
  );
}
