// « Domotique › Vue d'ensemble »: the house in one look, then one card per brand that opens its own page.
import { Home, TriangleAlert } from "lucide-react";
import type { Snapshot } from "../api";
import { ConnectorsLink, PageHead } from "../components/PageHead";
import { FoldPanel } from "../components/FoldPanel";
import { StatTile } from "../components/StatTile";
import { TableCard } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { deviceRows, house, openCount, type HouseTone } from "../lib/domotique";
import { tapoSummary } from "../lib/tapo";
import { tx } from "../lib/i18n";

const TONE: Record<HouseTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };
const DOT: Record<HouseTone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };
const PANEL = "overflow-hidden rounded-2xl border border-line bg-card/70 shadow-sm";

type Figure = { label: string; value: string };

/** One brand: a coloured header, its main figures big (value over label), and a link to its page */
function BrandCard({ href, name, color, figures, note }: Readonly<{ href: string; name: string; color: string; figures: Figure[]; note?: string }>) {
  return (
    <a href={href} className={`${PANEL} block no-underline transition-colors hover:border-txt/30`} style={{ borderColor: `${color}55` }}>
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5" style={{ background: `${color}1a` }}><h3 className="flex items-center gap-2 text-sm font-bold text-txt">{appIcon([name]) && <img src={appIcon([name]) ?? ""} alt="" className="size-5" />}{name}</h3><span className="text-xs font-semibold" style={{ color }}>{tx("Ouvrir la page")}</span></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 sm:grid-cols-4">
        {figures.map((f) => <div key={f.label} className="min-w-0"><dd className="truncate font-mono text-2xl font-extrabold leading-none tabular-nums text-txt">{f.value}</dd><dt className="mt-1 truncate text-xs text-muted">{f.label}</dt></div>)}
      </dl>
      {note && <p className="border-t border-line/60 px-4 py-2 text-xs text-muted">{note}</p>}
    </a>
  );
}

export function DomotiqueOverview({ snap }: Readonly<{ snap: Snapshot }>) {
  const h = house(snap), tapo = tapoSummary(snap), rows = deviceRows(snap);
  return (
    <div className="flex flex-col gap-5 py-4">
      <PageHead icon={Home} title={tx("Domotique")} tags={null} actions={snap.me.role === "admin" ? <ConnectorsLink /> : undefined} />
      <section>
        <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">{h.title}</h2>
        <p className="mt-1.5 text-[15px] text-muted">{h.text}</p>
      </section>
      <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label={tx("Chiffres clés")}>
        {h.tiles.map((t) => <StatTile key={t.label} n={t.value} label={t.label} sub={t.sub} tone={t.tone} />)}
      </nav>
      {h.problems.length > 0 && (
        <FoldPanel id="domotique.todo" icon={TriangleAlert} title={tx("À traiter")} count={h.problems.length} tone="warn" startFolded>
          <ul>{h.problems.map((p) => <li key={p} className="py-1 text-sm font-semibold">{p}</li>)}</ul>
        </FoldPanel>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        <BrandCard href="#domotique/netatmo" name="Netatmo" color="#ff8d15" figures={[
          { label: tx("Capteurs"), value: String(h.sensors.length) },
          ...(h.shutters.length ? [{ label: tx("Volets ouverts"), value: `${openCount(h.shutters)}/${h.shutters.length}` }] : []),
          ...(h.blinds.length ? [{ label: tx("Stores ouverts"), value: `${openCount(h.blinds)}/${h.blinds.length}` }] : []),
          ...(h.cameras.length ? [{ label: tx("Caméras"), value: String(h.cameras.length) }] : []),
          ...(h.rooms.length ? [{ label: tx("Pièces chauffées"), value: String(h.rooms.length) }] : []),
        ]} />
        {tapo && (
          <BrandCard href="#domotique/tapo" name="Tapo" color="#4acbd6" figures={[
            { label: tx("Appareils"), value: String(tapo.devices) },
            ...(tapo.watts != null ? [{ label: tx("Consommation maintenant"), value: `${Math.round(tapo.watts)} W` }] : []),
            ...(tapo.today_kwh != null ? [{ label: tx("Aujourd'hui"), value: `${tapo.today_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh` }] : []),
            ...(tapo.cameras.total ? [{ label: tx("Caméras en ligne"), value: `${tapo.cameras.up}/${tapo.cameras.total}` }] : []),
          ]} note={tapo.offline.length ? tx("Hors ligne : {0}", tapo.offline.join(", ")) : undefined} />
        )}
      </div>
      <TableCard zebra foldable folded title={tx("Tous les appareils")} tone="info" count={rows.length}
        cols={[{ label: tx("Appareil") }, { label: tx("Marque") }, { label: tx("Type") }, { label: tx("Pièce") }, { label: tx("État") }, { label: tx("Pile"), className: "text-right" }]}
        rows={rows.map((r) => [
          <b key="n" className="font-semibold">{r.name}</b>,
          <span key="b" className="inline-flex items-center gap-1.5">{appIcon([r.brand]) && <img src={appIcon([r.brand]) ?? ""} alt="" className="size-4" />}{r.brand}</span>,
          r.kind, r.room || "-",
          <span key="s" className={`inline-flex items-center gap-1.5 font-semibold ${TONE[r.tone]}`}><span className={`size-2 rounded-full ${DOT[r.tone]}`} />{r.state}</span>,
          <span key="p" className="block text-right font-mono tabular-nums">{r.battery != null ? `${Math.round(r.battery)} %` : "-"}</span>,
        ])} />
    </div>
  );
}