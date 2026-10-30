// « Internet box » page: a box reading in words. A field the connector left null gives no line, and a line that is down shows no current rate.
import { rateText } from "./bandwidth";
import { dur } from "./format";
import { tx } from "./i18n";
import type { BoxReading } from "../types";

export interface BoxFigure { label: string; value: string }

const LINES = (): Record<NonNullable<BoxReading["line"]>, string> => ({ fibre: tx("fibre"), dsl: "DSL", cable: tx("câble"), mobile: "4G/5G", satellite: tx("satellite") });

export const lineName = (line: BoxReading["line"]): string | undefined => (line ? LINES()[line] : undefined);

/** A rate of the box (bit/s) as text; undefined when it did not tell */
export const boxRate = (bits: number | null): string | undefined => (bits == null ? undefined : rateText(bits / 1000));

/** The state of the connection, with the type of line; null when the box does not tell */
export function boxState(b: BoxReading): { tone: "ok" | "bad"; label: string } | null {
  if (b.connected == null) return null;
  const name = lineName(b.line), state = b.connected ? tx("en ligne") : tx("coupée");
  return { tone: b.connected ? "ok" : "bad", label: name ? `${state} · ${name}` : state };
}

/** Current rates (down, up), hidden while the line is down: the counters of a line that is off say nothing */
export function currentRates(b: BoxReading): [string | undefined, string | undefined] {
  return b.connected === false ? [undefined, undefined] : [boxRate(b.down_bps), boxRate(b.up_bps)];
}

/** Share of the line in use, 0 to 100; null without both figures */
export function lineShare(rate: number | null, max: number | null): number | null {
  return rate == null || !max ? null : Math.min(100, (100 * rate) / max);
}

/** The tiles at the top of the page */
export function boxTiles(b: BoxReading): BoxFigure[] {
  const [down, up] = currentRates(b);
  const all: [string, string | undefined][] = [
    [tx("Descendant"), down], [tx("Montant"), up],
    [tx("Connectée depuis"), b.uptime_s == null ? undefined : dur(b.uptime_s)],
    [tx("Appareils"), b.devices == null ? undefined : String(b.devices)],
    [tx("Wi-Fi"), wifiWord(b)],
    [tx("Température"), temperatureWord(b)],
  ];
  return all.flatMap(([label, value]) => (value == null ? [] : [{ label, value }]));
}

export const temperatureWord = (b: BoxReading): string | undefined => (b.temperature == null ? undefined : `${Math.round(b.temperature)} °C`);

export function wifiWord(b: BoxReading): string | undefined {
  if (b.wifi == null) return undefined;
  return b.wifi ? tx("actif") : tx("coupé");
}

/** The firmware on offer: its version when the box names it */
export function updateWord(b: BoxReading): string | undefined {
  if (!b.update_available) return undefined;
  return b.latest_firmware ? `→ ${b.latest_firmware}` : tx("disponible");
}

/** Something to put in the « System » section */
export const hasSystem = (b: BoxReading): boolean =>
  b.firmware != null || !!b.update_available || b.devices != null || b.wifi != null || b.temperature != null;
