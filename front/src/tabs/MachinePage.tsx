// The page of one machine (#machines/<ip>): what the Machines tab showed in a window (identity, system, access, software, backups, health,
// updates, UniFi or Freebox), its availability over 30 days, and, for an administrator, its settings (identity, options, access) in the page:
// the window of Réglages → Machines is no longer needed for a machine that exists. Back to the list with « Machines ».
import { ArrowLeft, ArrowRight, CalendarCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { read, type Snapshot } from "../api";
import { MachineIcon } from "../components/MachineIcon";
import { dateTime } from "../lib/format";
import { quiet } from "../lib/forms";
import { tx } from "../lib/i18n";
import { availabilityOf } from "../lib/machineHash";
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
      <AvailabilityCard item={avail} />
      {admin && (
        <section ref={settings} className="scroll-mt-24 rounded-2xl border border-line bg-card p-4 shadow-sm" aria-label={tx("Réglages de cette machine")}>
          <h2 className="flex items-center gap-2 font-bold"><SlidersHorizontal size={16} aria-hidden />{tx("Réglages de cette machine")}</h2>
          <p className="mt-1 text-sm text-muted">{tx("Identité, options et accès (SSH, agent, connecteurs) : chaque réglage s'enregistre à la saisie, « Enregistrer » ne sert qu'au nom et aux champs libres.")}</p>
          <MachineModal inline ip={m.ip} snap={snap} focusTab={focusTab} />
        </section>
      )}
    </div>
  );
}
