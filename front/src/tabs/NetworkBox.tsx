// Network › Internet box: one sheet per box connector, built like the Freebox sheet (line, rates, system). Whatever the connector did not read has no line.
import { Cpu, Gauge, Router } from "lucide-react";
import { BandwidthTile } from "../components/BandwidthTile";
import { DetailRow, DetailSection } from "../components/DetailSection";
import { useNetworkHistory } from "../components/HistoryTile";
import { PeriodSwitch, usePeriod } from "../components/PeriodSwitch";
import { StatTile } from "../components/StatTile";
import { Badge, Dim, GradientFill } from "../components/ui";
import { appIcon } from "../lib/appIcons";
import { boxRate, boxState, boxTiles, currentRates, hasSystem, lineName, lineShare, temperatureWord, updateWord, wifiWord } from "../lib/box";
import { tx } from "../lib/i18n";
import type { Period, TilePoint } from "../lib/tileHistory";
import type { BoxReading, ServiceStatus } from "../types";

const BOX_DIRECTIONS = ["down", "up"] as const;

/** A direction: the rate in use, the line's rate after it, and the bar of what is used */
function RateRow({ k, text, rate, max }: Readonly<{ k: string; text?: string; rate: number | null; max: number | null }>) {
  const pct = lineShare(rate, max), top = boxRate(max);
  if (!text) return null;
  return (
    <DetailRow k={k}>
      <span className="font-mono">{text}{top && <Dim> / {top}</Dim>}</span>
      {pct != null && <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-bg2" title={tx("Part de la capacité de la ligne utilisée en ce moment")}><GradientFill pct={pct} /></span>}
    </DetailRow>
  );
}

function LineSection({ b }: Readonly<{ b: BoxReading }>) {
  const state = boxState(b), top = [boxRate(b.line_down_bps), boxRate(b.line_up_bps)].filter(Boolean).join(" / ");
  return (
    <DetailSection icon={Gauge} title={tx("Ligne")} tone="link">
      <DetailRow k={tx("État")}>{state ? <span className={state.tone === "ok" ? "text-ok" : "text-bad"}>{state.label}</span> : undefined}</DetailRow>
      <DetailRow k={tx("Type")}>{lineName(b.line)}</DetailRow>
      <DetailRow k={tx("Débit de la ligne")}>{top ? <span className="font-mono">{top}</span> : undefined}</DetailRow>
      <DetailRow k={tx("IP publique")}>{b.public_ip ? <span className="font-mono">{b.public_ip}</span> : undefined}</DetailRow>
    </DetailSection>
  );
}

function RatesSection({ b, curves }: Readonly<{ b: BoxReading; curves?: React.ReactNode }>) {
  const [down, up] = currentRates(b);
  if (!down && !up && !curves) return null;
  return (
    <DetailSection icon={Gauge} title={tx("Débits")} tone="link">
      <RateRow k={tx("Descendant")} text={down} rate={b.down_bps} max={b.line_down_bps} />
      <RateRow k={tx("Montant")} text={up} rate={b.up_bps} max={b.line_up_bps} />
      <DetailRow k={tx("Historique")}>{curves}</DetailRow>
    </DetailSection>
  );
}

function SystemSection({ b }: Readonly<{ b: BoxReading }>) {
  const update = updateWord(b);
  if (!hasSystem(b)) return null;
  return (
    <DetailSection icon={Cpu} title={tx("Système")} tone="link">
      <DetailRow k="Firmware">{b.firmware ? <span className="font-mono">{b.firmware}</span> : undefined}</DetailRow>
      <DetailRow k={tx("Mise à jour")}>{update ? <span className="font-mono text-warn">{update}</span> : undefined}</DetailRow>
      <DetailRow k={tx("Appareils")}>{b.devices ?? undefined}</DetailRow>
      <DetailRow k={tx("Wi-Fi")}>{wifiWord(b)}</DetailRow>
      <DetailRow k={tx("Température")}>{temperatureWord(b)}</DetailRow>
    </DetailSection>
  );
}

function BoxSheet({ c, b, curves }: Readonly<{ c: ServiceStatus; b: BoxReading; curves?: React.ReactNode }>) {
  const state = boxState(b), tiles = boxTiles(b), icon = appIcon([c.label]);
  return (
    <section className="flex flex-col gap-3" aria-label={b.model ?? c.label}>
      <div className="flex flex-wrap items-center gap-3">
        {icon ? <img src={icon} alt="" className="h-9 w-9" /> : <Router size={28} aria-hidden className="text-link" />}
        <div className="min-w-0 flex-1"><div className="font-semibold">{b.model ?? c.name}</div><Dim>{c.label}{c.stale ? ` · ${tx("Périmé")}` : ""}</Dim></div>
        {state && <Badge tone={state.tone}>{state.label}</Badge>}
      </div>
      {tiles.length > 0 && <div className="flex flex-wrap gap-2.5">{tiles.map((t) => <StatTile key={t.label} n={t.value} label={t.label} />)}</div>}
      <div className="grid items-start gap-x-3 lg:grid-cols-2">
        <LineSection b={b} />
        <RatesSection b={b} curves={curves} />
        <SystemSection b={b} />
      </div>
    </section>
  );
}

function Curves({ bw, hours, setHours }: Readonly<{ bw: Record<string, TilePoint[]>; hours: Period; setHours: (p: Period) => void }>) {
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="flex flex-col gap-2">
      <PeriodSwitch value={hours} onChange={setHours} />
      <div className="flex flex-wrap gap-2.5">
        {BOX_DIRECTIONS.map((d) => <BandwidthTile key={d} label={d === "down" ? tx("Download") : tx("Upload")} sources={[{ id: "box", name: tx("Box internet"), color: "rgb(var(--link))", points: bw[`box.${d}`] ?? null }]} hours={hours} now={now} />)}
      </div>
    </div>
  );
}

export function NetworkBox({ cards, stamp }: Readonly<{ cards: ServiceStatus[]; stamp: string }>) {
  const [hours, setHours] = usePeriod(), bw = useNetworkHistory(hours, stamp)?.bw;
  const drawn = bw && BOX_DIRECTIONS.some((d) => bw[`box.${d}`]?.length);
  return (
    <div className="flex flex-col gap-6">
      {cards.map((c, i) => c.box && <BoxSheet key={c.instance ?? c.name} c={c} b={c.box} curves={i === 0 && drawn ? <Curves bw={bw} hours={hours} setHours={setHours} /> : undefined} />)}
    </div>
  );
}
