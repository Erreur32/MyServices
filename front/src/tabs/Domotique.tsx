// « Domotique › Netatmo »: the state of the house, its figures, what to deal with, every sensor room by room, then the shutters and the cameras.
import { House } from "lucide-react";
import type { Snapshot } from "../api";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { StatTile } from "../components/StatTile";
import { Empty } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { hasDomotique, house, measures, moduleState, shutterState, type HouseTone } from "../lib/domotique";
import { dateTime } from "../lib/format";
import { tx } from "../lib/i18n";
import type { NetatmoModule } from "../types";

const TEXT: Record<HouseTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };
// Netatmo's orange, from its logo
const PANEL = "overflow-hidden rounded-2xl border border-[#ff8d15]/30 bg-card/70 shadow-sm";
const HEAD = "flex items-baseline justify-between gap-3 border-b border-[#ff8d15]/30 bg-[#ff8d15]/10 px-4 py-2.5";

function foot(m: NetatmoModule): string {
  if (!m.reachable && m.last_seen) return tx("Dernier signal : {0}", dateTime(m.last_seen * 1000));
  return m.battery != null ? tx("Pile {0} %", Math.round(m.battery)) : "";
}

function Sensor({ m }: Readonly<{ m: NetatmoModule }>) {
  const state = moduleState(m), values = measures(m), under = [m.room, foot(m)].filter(Boolean).join(" · ");
  return (
    <article className="flex flex-col gap-1.5 rounded-xl border border-[#ff8d15]/30 bg-card px-3 py-2 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-bold">{m.name}</h3>
        <span className={`whitespace-nowrap text-xs font-bold ${TEXT[state.tone]}`}>{state.label}</span>
      </div>
      {under && <p className="-mt-1 truncate text-xs text-muted">{under}</p>}
      {values.length > 0 && (
        <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
          {values.map((v) => <div key={v.label} className="flex items-baseline gap-1"><dt className="text-[11px] text-muted">{v.label}</dt><dd className="text-sm font-semibold tabular-nums">{v.value}</dd></div>)}
        </dl>
      )}
    </article>
  );
}

function List({ title, aside, rows }: Readonly<{ title: string; aside?: React.ReactNode; rows: { key: string; name: string; note: string }[] }>) {
  return (
    <section className={PANEL} aria-label={title}>
      <div className={HEAD}><h2 className="text-sm font-bold">{title}</h2>{aside}</div>
      <ul className="px-4 py-2">{rows.map((r) => <li key={r.key} className="flex justify-between gap-3 py-1 text-sm"><span className="min-w-0 truncate">{r.name}</span><span className="shrink-0 text-muted">{r.note}</span></li>)}</ul>
    </section>
  );
}

/** Each shutter with how far it is open: a full bar is an open shutter */
function Shutters({ list }: Readonly<{ list: NetatmoModule[] }>) {
  return (
    <section className={PANEL} aria-label={tx("Volets roulants")}>
      <div className={HEAD}><h2 className="text-sm font-bold">{tx("Volets roulants")}</h2></div>
      <ul className="flex flex-col gap-2.5 px-4 py-3">
        {list.map((m) => {
          const pos = m.values.current_position;
          return (
            <li key={m.id ?? m.name} className="text-sm">
              <div className="flex justify-between gap-3"><span className="min-w-0 truncate">{m.name}</span><span className="shrink-0 text-muted">{place(m, shutterState(m))}</span></div>
              {typeof pos === "number" && (
                <div role="progressbar" aria-label={m.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pos} className="mt-1 h-2 overflow-hidden rounded-full bg-[#ff8d15]/15">
                  <div className="h-full rounded-full bg-[#ff8d15]" style={{ width: `${Math.min(100, Math.max(0, pos))}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const place = (m: NetatmoModule, note: string) => [m.room, note].filter(Boolean).join(" · ");

export function Domotique({ snap }: Readonly<{ snap: Snapshot }>) {
  if (!hasDomotique(snap)) return <div className="py-4"><Empty>{tx("Aucun appareil lu : relie le connecteur Netatmo dans Connecteurs.")}</Empty></div>;
  const h = house(snap);
  return (
    <div className="flex flex-col gap-5 py-4">
      <PageHead icon={House} logo={appIcon(["netatmo"])} title="Netatmo" tags={null} actions={snap.me.role === "admin" ? <ConnectorsLink /> : undefined} />
      <section>
        <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">{h.title}</h2>
        <p className="mt-1.5 text-[15px] text-muted">{h.text}</p>
      </section>
      <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label={tx("Chiffres clés")}>
        {h.tiles.map((t) => <StatTile key={t.label} n={t.value} label={t.label} sub={t.sub} tone={t.tone} />)}
      </nav>
      {h.problems.length > 0 && (
        <section className={PANEL} aria-label={tx("À traiter")}>
          <div className={HEAD}><h2 className="text-sm font-bold">{tx("À traiter")}</h2></div>
          <ul className="px-4 py-2">{h.problems.map((p) => <li key={p} className="py-1 text-sm font-semibold">{p}</li>)}</ul>
        </section>
      )}
      <section aria-label={tx("Pièce par pièce")}>
        <h2 className="mb-2.5 text-base font-bold">{tx("Pièce par pièce")}</h2>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{h.sensors.map((m) => <Sensor key={m.id ?? m.name} m={m} />)}</div>
      </section>
      <div className="grid items-start gap-3 md:grid-cols-2">
        {h.rooms.length > 0 && <List title={tx("Chauffage")} rows={h.rooms.map((r) => ({ key: r.name, name: r.name, note: `${r.temperature ?? "-"}° / ${r.setpoint ?? "-"}°` }))} />}
        {h.shutters.length > 0 && <Shutters list={h.shutters} />}
        {h.cameras.length > 0 && <List title={tx("Caméras")} aside={<a href="#stream/cameras" className="text-xs font-semibold">{tx("Voir les images")}</a>} rows={h.cameras.map((m) => ({ key: m.id ?? m.name, name: m.name, note: place(m, m.values.monitoring === "on" ? tx("surveillance active") : tx("surveillance coupée")) }))} />}
        {h.others.length > 0 && <List title={tx("Autres appareils")} rows={h.others.map((m) => ({ key: m.id ?? m.name, name: m.name, note: place(m, moduleState(m).label) }))} />}
      </div>
    </div>
  );
}
