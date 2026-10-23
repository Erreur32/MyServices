// Réseau : statistiques du scan de MynetworK (compteurs, adresses hors ligne, pires latences) et volume de données par client.
// Les compteurs viennent de MynetworK quand il les donne (0.11.2+), sinon ils sont comptés d'après son inventaire ; le volume par client
// n'apparaît qu'avec sa route top-traffic (0.11.2+). Lecture seule, relue toutes les 30 s.
import { StatTile } from "../components/StatTile";
import { Activity, ArrowDown, ArrowUp, CircleOff, Radar, Timer } from "lucide-react";
import { useCallback, useState } from "react";
import { read } from "../api";
import { Overlay } from "../components/Overlay";
import { Badge, Dim } from "../components/ui";
import { bytes, dateTime, hm, rate } from "../lib/format";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";

type Mode = "live" | "today" | "alltime";
interface Row { ip: string; name: string | null; ping_ms: number | null; last: string | null }
interface Traffic { name: string | null; ip: string | null; mac: string | null; vendor: string | null; rx: number | null; tx: number | null; total: number | null; unit: "rate" | "volume" }
interface StatsDoc {
  scan: { counters: { total: number; online: number; offline: number; unknown: number; last_scan?: string | number | null; source: string }; offline: Row[]; worst_latency: Row[] } | null;
  traffic: { mode: Mode; items: Traffic[] } | null;
  at: number; error: string;
}

const MODES: [Mode, string][] = [["live", tx("En direct")], ["today", tx("Aujourd'hui")], ["alltime", tx("Depuis toujours")]];

const pingText = (ms: number | null | undefined): string => {
  if (ms == null) return "-";
  return `${ms >= 10 ? Math.round(ms) : ms.toFixed(1)} ms`;
};

/** The time of an address' last reading, else the time we read MynetworK's inventory */
const readTime = (when: number | string | null | undefined, doc: { at: number } | null): string => {
  if (when) return dateTime(when);
  return doc ? `${tx("lu à")} ${hm(doc.at * 1000)}` : "-";
};

/** An inner frame: icon and title strip (with room for a control on the right), column heads, then striped rows */
function Panel({ icon: Icon, title, head, control, footer, empty, children }: Readonly<{ icon: typeof Radar; title: string; head?: React.ReactNode; control?: React.ReactNode; footer?: React.ReactNode; empty: string; children: React.ReactNode[] }>) {
  return (
    <div className="flex h-[24rem] min-w-0 flex-col overflow-hidden rounded-xl border-2 border-line bg-bg2/30">{/* same height for the three: a long list scrolls inside, it never stretches its neighbours */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-2">
        <Icon size={15} className="text-link" aria-hidden />
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h4>
        {control && <div className="ml-auto">{control}</div>}
      </div>
      {head && <div className="grid items-center gap-2 border-b border-line/60 bg-bg/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-dim">{head}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children.length ? <ul className="text-sm [&>li:nth-child(even)]:bg-bg/50">{children}</ul> : <p className="px-3 py-3 text-sm text-dim">{empty}</p>}
      </div>
      {footer && <div className="border-t border-line/60 bg-bg/60 px-3 py-1.5 text-xs">{footer}</div>}
    </div>
  );
}

/** One client of the volume list: name and total, then address and the two directions (rates in bits, volumes in bytes) */
function TrafficRow({ t }: Readonly<{ t: Traffic }>) {
  const fmt = t.unit === "rate" ? rate : bytes;   // live: a speed in bits per second ; today, all time: a volume in bytes
  return (
    <li className="px-3 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate" title={t.vendor ?? undefined}>{t.name ?? t.ip ?? "-"}</span>
        <b className="shrink-0 tabular-nums">{t.total == null ? "-" : fmt(t.total)}</b>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-dim">
        <span className="truncate font-mono">{t.ip ?? ""}</span>
        <span className="flex shrink-0 items-center gap-3 tabular-nums">
          <span className="flex items-center gap-1" title={tx("Reçu (téléchargement)")}><ArrowDown size={12} className="text-link" aria-hidden />{t.rx == null ? "-" : fmt(t.rx)}</span>
          <span className="flex items-center gap-1" title={tx("Envoyé")}><ArrowUp size={12} className="text-ok" aria-hidden />{t.tx == null ? "-" : fmt(t.tx)}</span>
        </span>
      </div>
    </li>
  );
}

function ModeButtons({ mode, setMode }: Readonly<{ mode: Mode; setMode: (m: Mode) => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {MODES.map(([m, label]) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${mode === m ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link"}`}>{label}</button>
      ))}
    </div>
  );
}

export function NetworkScanStats() {
  const [mode, setMode] = useState<Mode>("live"), [doc, setDoc] = useState<StatsDoc | null>(null), [all, setAll] = useState(false);
  const load = useCallback(() => { read<StatsDoc>(`network/stats?traffic=${mode}`).then(setDoc).catch(() => undefined); }, [mode]);
  usePoll(load, mode === "live" ? 20_000 : 30_000);   // the live volume follows the traffic; the rest hardly moves
  const scan = doc?.scan;
  if (!scan) return null;   // no MynetworK (or not readable): nothing to show
  const c = scan?.counters;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h3 className="font-bold">{tx("Scan du réseau")}</h3>
        {c && <Dim>{c.source === "mynetwork" ? tx("compteurs de MynetworK") : tx("comptés d'après l'inventaire de MynetworK")}</Dim>}
        {c?.last_scan && <Dim>· {tx("dernier scan")} {dateTime(c.last_scan)}</Dim>}
      </div>
      {c && <><div className="flex gap-2.5 overflow-x-auto p-4">
        <StatTile n={c.total} label={tx("adresses vues")} />
        <StatTile n={c.online} label={tx("en ligne")} tone="ok" />
        <StatTile n={c.offline} label={tx("hors ligne")} tone={c.offline ? "warn" : undefined} />
        <StatTile n={c.unknown} label={tx("inconnues")} />
      </div>
      <div className="grid gap-3 px-4 pb-4 lg:grid-cols-3">
        <Panel icon={CircleOff} title={tx("Adresses hors ligne")} empty={tx("Aucune.")}
          head={<div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-2"><span>{tx("Adresse")}</span><span>{tx("Nom")}</span><span className="text-right">{tx("Dernier relevé")}</span></div>}>
          {scan.offline.map((r) => (
            <li key={r.ip} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] items-baseline gap-2 px-3 py-1.5">
              <span className="font-mono text-xs">{r.ip}</span>
              <span className="truncate text-muted">{r.name ?? "-"}</span>
              <span className="text-right text-xs tabular-nums text-dim" title={tx("Dernier relevé de cette adresse")}>{r.last ? dateTime(r.last) : "-"}</span>
            </li>
          ))}
        </Panel>
        <Panel icon={Timer} title={tx("Pires latences")} empty={tx("Aucune mesure.")}
          head={<div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_auto] gap-2"><span>{tx("Adresse")}</span><span>{tx("Nom")}</span><span className="text-right">{tx("Relevé")}</span><span className="w-16 text-right">{tx("Latence")}</span></div>}>
          {scan.worst_latency.map((r) => {
            const when = r.last ?? c.last_scan;   // MynetworK 0.11.1 gives no time per address: the time we read its inventory stands in
            return (
              <li key={r.ip} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_auto] items-baseline gap-2 px-3 py-1.5">
                <span className="font-mono text-xs">{r.ip}</span>
                <span className="truncate text-muted">{r.name ?? "-"}</span>
                <span className="text-right text-xs tabular-nums text-dim" title={when ? tx("Dernier relevé de cette adresse") : tx("Heure de notre lecture de l'inventaire de MynetworK (il ne donne pas celle de la mesure)")}>
                  {readTime(when, doc)}
                </span>
                <b className={`w-16 text-right tabular-nums ${r.ping_ms != null && r.ping_ms >= 100 ? "text-warn" : ""}`}>{pingText(r.ping_ms)}</b>
              </li>
            );
          })}
        </Panel>
        <Panel icon={Activity} title={tx("Volume par client")} empty={doc?.traffic ? tx("Aucun trafic.") : tx("Disponible avec MynetworK 0.11.2 ou plus.")}
          control={<ModeButtons mode={mode} setMode={setMode} />}
          footer={(doc?.traffic?.items.length ?? 0) > 0 && <button type="button" className="text-link hover:underline" onClick={() => setAll(true)}>{tx("Tout voir")} ({doc!.traffic!.items.length})</button>}>
          {(doc?.traffic?.items ?? []).map((t) => <TrafficRow key={`${t.mac ?? ""}${t.ip ?? ""}${t.name ?? ""}`} t={t} />)}
        </Panel>
      </div></>}
      {all && doc?.traffic && (
        <Overlay medium onClose={() => setAll(false)} title={<><Activity size={18} aria-hidden />{tx("Volume de données par client")} <Badge tone="off">{doc.traffic.items.length}</Badge></>}>
          <div className="mt-3 flex flex-col gap-3">
            <ModeButtons mode={mode} setMode={setMode} />
            <ul className="overflow-hidden rounded-xl border border-line text-sm [&>li:nth-child(even)]:bg-bg/50">
              {doc.traffic.items.map((t) => <TrafficRow key={`${t.mac ?? ""}${t.ip ?? ""}${t.name ?? ""}`} t={t} />)}
            </ul>
          </div>
        </Overlay>
      )}
    </section>
  );
}
