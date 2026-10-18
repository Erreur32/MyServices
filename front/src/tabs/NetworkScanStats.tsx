// Réseau : statistiques du scan de MynetworK (compteurs, adresses hors ligne, pires latences) et volume de données par client.
// Les compteurs viennent de MynetworK quand il les donne (0.11.2+), sinon ils sont comptés d'après son inventaire ; le volume par client
// n'apparaît qu'avec sa route top-traffic (0.11.2+). Lecture seule, relue toutes les 30 s.
import { Activity, ArrowDown, ArrowUp, ChevronDown, ChevronUp, CircleHelp, CircleOff, Radar, Wifi } from "lucide-react";
import { useCallback, useState } from "react";
import { read } from "../api";
import { Dim } from "../components/ui";
import { bytes, dateTime, rate } from "../lib/format";
import { tx } from "../lib/i18n";
import { usePoll } from "../lib/polling";
import { useStoredFlag } from "../lib/storedFlag";

type Mode = "live" | "today" | "alltime";
interface Row { ip: string; name: string | null; ping_ms: number | null; last: string | null }
interface Traffic { name: string | null; ip: string | null; mac: string | null; vendor: string | null; rx: number | null; tx: number | null; total: number | null; unit: "rate" | "volume" }
interface StatsDoc {
  scan: { counters: { total: number; online: number; offline: number; unknown: number; last_scan?: string | number | null; source: string }; offline: Row[]; worst_latency: Row[] } | null;
  traffic: { mode: Mode; items: Traffic[] } | null;
  at: number; error: string;
}

const MODES: [Mode, string][] = [["live", tx("En direct")], ["today", tx("Aujourd'hui")], ["alltime", tx("Depuis toujours")]];

function Counter({ icon: Icon, value, label, tone }: Readonly<{ icon: typeof Radar; value: number | string; label: string; tone: string }>) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-bg2/40 px-4 py-2.5">
      <Icon size={18} className={tone} aria-hidden />
      <div><div className={`font-mono text-lg font-bold leading-tight ${tone}`}>{value}</div><div className="text-xs text-dim">{label}</div></div>
    </div>
  );
}

function List({ title, empty, children }: Readonly<{ title: string; empty: string; children: React.ReactNode[] }>) {
  return (
    <div className="min-w-0 rounded-xl border border-line">
      <h4 className="border-b border-line/60 bg-bg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">{title}</h4>
      {children.length ? <ul className="divide-y divide-line/60 text-sm [&>li:nth-child(even)]:bg-bg/50">{children}</ul> : <p className="px-3 py-2 text-sm text-dim">{empty}</p>}
    </div>
  );
}

export function NetworkScanStats() {
  const [mode, setMode] = useState<Mode>("live"), [doc, setDoc] = useState<StatsDoc | null>(null), [folded, setFolded] = useStoredFlag("myservices.network.scanStatsFolded", false);
  const load = useCallback(() => { if (!folded) read<StatsDoc>(`network/stats?traffic=${mode}`).then(setDoc).catch(() => undefined); }, [mode, folded]);   // nothing is read while folded
  usePoll(load, mode === "live" ? 10_000 : 30_000);   // the live volume follows the traffic; the rest hardly moves
  const scan = doc?.scan;
  if (!scan && !folded) return null;   // no MynetworK (or not readable): nothing to show ; folded: the header stays, nothing was read
  const c = scan?.counters;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-bg px-4 py-3">
        <h3 className="font-bold">{tx("Scan du réseau")}</h3>
        {c && <Dim>{c.source === "mynetwork" ? tx("compteurs de MynetworK") : tx("comptés d'après l'inventaire de MynetworK")}</Dim>}
        {c?.last_scan && <Dim>· {tx("dernier scan")} {dateTime(c.last_scan)}</Dim>}
        <button type="button" className="ml-auto text-dim hover:text-txt" aria-expanded={!folded} onClick={() => setFolded(!folded)} title={folded ? tx("Déplier") : tx("Replier")}>
          {folded ? <ChevronDown size={18} aria-hidden /> : <ChevronUp size={18} aria-hidden />}
        </button>
      </div>
      {!folded && c && scan && <><div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Counter icon={Radar} value={c.total} label={tx("adresses vues")} tone="text-muted" />
        <Counter icon={Wifi} value={c.online} label={tx("en ligne")} tone="text-ok" />
        <Counter icon={CircleOff} value={c.offline} label={tx("hors ligne")} tone={c.offline ? "text-warn" : "text-muted"} />
        <Counter icon={CircleHelp} value={c.unknown} label={tx("inconnues")} tone="text-muted" />
      </div>
      <div className="grid gap-3 px-4 pb-4 md:grid-cols-3">
        <List title={tx("Adresses hors ligne")} empty={tx("Aucune.")}>
          {scan.offline.map((r) => (
            <li key={r.ip} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0"><span className="font-mono text-xs">{r.ip}</span> <span className="truncate text-muted">{r.name ?? ""}</span></span>
              <span className="shrink-0 text-xs text-dim" title={tx("Dernier relevé de cette adresse")}>{r.last ? dateTime(r.last) : "-"}</span>
            </li>
          ))}
        </List>
        <List title={tx("Pires latences")} empty={tx("Aucune mesure.")}>
          {scan.worst_latency.map((r) => <li key={r.ip} className="flex items-baseline justify-between gap-2 px-3 py-1.5"><span className="min-w-0"><span className="font-mono text-xs">{r.ip}</span> <span className="truncate text-muted">{r.name ?? ""}</span></span><span className="flex shrink-0 items-baseline gap-2"><span className="text-xs text-dim" title={tx("Dernier relevé de cette adresse")}>{r.last ?? c?.last_scan ? dateTime((r.last ?? c?.last_scan)!) : ""}</span><b className="tabular-nums">{r.ping_ms == null ? "-" : `${r.ping_ms.toFixed(1)} ms`}</b></span></li>)}
        </List>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <Activity size={14} className="text-dim" aria-hidden />
            {MODES.map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${mode === m ? "border-link bg-link/15 text-txt" : "border-line bg-bg2 text-muted hover:border-link"}`}>{label}</button>
            ))}
          </div>
          <List title={tx("Volume de données par client")} empty={doc?.traffic ? tx("Aucun trafic.") : tx("Disponible avec MynetworK 0.11.2 ou plus.")}>
            {(doc?.traffic?.items ?? []).map((t) => {
              const fmt = t.unit === "rate" ? rate : bytes;   // live: a speed in bits per second ; today, all time: a volume in bytes
              return (
                <li key={`${t.mac ?? ""}${t.ip ?? ""}${t.name ?? ""}`} className="px-3 py-1.5">
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
            })}
          </List>
        </div>
      </div></>}
    </section>
  );
}
