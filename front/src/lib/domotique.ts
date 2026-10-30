// « Domotique » page: what the Netatmo connector (else Home Assistant) read, put in the order of a house (figures, sensors room by room, shutters, cameras).
import type { Snapshot } from "../api";
import type { HouseCurves, NetatmoModule } from "../types";
import { LOCALE, tx } from "./i18n";

const SENSORS = ["NAMain", "NAModule1", "NAModule2", "NAModule3", "NAModule4", "NHC"];
const SHUTTERS = ["NBR", "NBO", "NBS", "Z3V", "Z3L"], CAMERAS = ["NACamera", "NOC", "NDB", "NCS", "NSD"];
export const LOW_BATTERY = 20;

/** Netatmo by its connector when there is one, else through Home Assistant (the same devices must not count twice), then the rest of the house */
function rows(snap: Snapshot) {
  const all = snap.data.services_status ?? [], direct = all.filter((c) => c.connector === "netatmo" && c.modules?.length);
  const netatmo = direct.length ? direct : all.filter((c) => c.netatmo?.modules.length).map((c) => ({ ...c, ...c.netatmo }));
  return [...netatmo, ...all.filter((c) => c.home).map((c) => ({ ...c, ...c.home }))];
}
export const hasDomotique = (snap: Snapshot): boolean => rows(snap).length > 0;

const num = (v: unknown, digits = 0) => (typeof v === "number" ? v.toLocaleString(LOCALE, { maximumFractionDigits: digits }) : "-");

/** The measures of a sensor, in reading order */
export function measures(m: NetatmoModule): { key: string; label: string; value: string }[] {
  const v = m.values;
  const all: [string, string, string][] = [
    ["temperature", tx("Température"), `${num(v.temperature, 1)}°`], ["humidity", tx("Humidité"), `${num(v.humidity)} %`], ["co2", "CO2", `${num(v.co2)} ppm`],
    ["noise", tx("Bruit"), `${num(v.noise)} dB`], ["pressure", tx("Pression"), `${num(v.pressure)} hPa`], ["rain", tx("Pluie"), `${num(v.rain, 1)} mm`],
    ["rain_24h", tx("Sur 24 h"), `${num(v.rain_24h, 1)} mm`], ["wind", tx("Vent"), `${num(v.wind)} km/h`], ["gust", tx("Rafales"), `${num(v.gust)} km/h`],
    ["air_quality", tx("Qualité de l'air"), `${num(v.air_quality)}/4`],
  ];
  return all.filter(([k]) => v[k] != null).map(([key, label, value]) => ({ key, label, value }));
}

const UNITS: Record<string, string> = { temperature: "°", humidity: " %", co2: " ppm", noise: " dB", pressure: " hPa", rain: " mm", wind: " km/h", gust: " km/h" };

/** The curves worth drawing: a line in a box of 100 × 24 and the lowest and highest values; fewer than two points draw nothing */
export function curveRows(m: NetatmoModule, series: HouseCurves): { key: string; label: string; path: string; range: string }[] {
  const labels = new Map(measures(m).map((x) => [x.key, x.label]));
  return Object.entries(series).filter(([, p]) => p.length > 1).map(([key, p]) => {
    const ts = p.map(([t]) => t), vs = p.map(([, v]) => v), t0 = Math.min(...ts), lo = Math.min(...vs), hi = Math.max(...vs);
    const x = (t: number) => ((t - t0) / (Math.max(...ts) - t0 || 1)) * 100, y = (v: number) => 24 - ((v - lo) / (hi - lo || 1)) * 24;
    return { key, label: labels.get(key) ?? key, path: p.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" "), range: span([lo, hi], UNITS[key] ?? "") };
  });
}

export type HouseTone = "ok" | "warn" | "bad";

export function moduleState(m: NetatmoModule): { tone: HouseTone; label: string } {
  if (!m.reachable) return { tone: "bad", label: tx("Hors ligne") };
  return m.low || (m.battery != null && m.battery <= LOW_BATTERY) ? { tone: "warn", label: tx("Pile faible") } : { tone: "ok", label: tx("En ligne") };
}

const span = (ns: number[], unit: string) => {
  if (!ns.length) return "-";
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return lo === hi ? `${num(lo, 1)}${unit}` : tx("{0} à {1}{2}", num(lo, 1), num(hi, 1), unit);
};

const numbers = (ms: NetatmoModule[], key: string) => ms.map((m) => m.values[key]).filter((n): n is number => typeof n === "number");

export function house(snap: Snapshot) {
  const list = rows(snap), modules = list.flatMap((c) => (c.modules ?? []).map((m) => ({ ...m, source: { connector: c.connector ?? "", name: c.instance ?? "" } })));
  const of = (types: string[]) => modules.filter((m) => types.includes(m.type ?? ""));
  const sensors = of(SENSORS), shutters = of(SHUTTERS), cameras = of(CAMERAS);
  const outdoor = sensors.filter((m) => m.type === "NAModule1"), indoor = sensors.filter((m) => m.type !== "NAModule1" && m.values.temperature != null);
  const co2 = indoor.filter((m) => typeof m.values.co2 === "number").sort((a, b) => Number(b.values.co2) - Number(a.values.co2))[0];
  const worst = co2 ? Number(co2.values.co2) : 0;
  const tiles: { label: string; value: string; sub?: string; tone?: HouseTone }[] = [
    { label: tx("Intérieur"), value: span(numbers(indoor, "temperature"), "°"), sub: tx("{0} pièce(s)", indoor.length) },
  ];
  if (outdoor.length) tiles.push({ label: tx("Extérieur"), value: span(numbers(outdoor, "temperature"), "°"), sub: outdoor[0].values.humidity != null ? tx("humidité {0} %", outdoor[0].values.humidity) : undefined });
  if (co2) tiles.push({ label: tx("CO2 le plus haut"), value: `${num(worst)} ppm`, sub: co2.name, tone: worst > 1400 ? "bad" : worst > 1000 ? "warn" : "ok" });
  const noise = numbers(sensors, "noise"), pressure = numbers(sensors, "pressure"), rain = numbers(sensors, "rain_24h");
  if (noise.length) tiles.push({ label: tx("Bruit"), value: `${num(Math.max(...noise))} dB` });
  if (pressure.length) tiles.push({ label: tx("Pression"), value: `${num(pressure[0])} hPa` });
  if (rain.length) tiles.push({ label: tx("Pluie sur 24 h"), value: `${num(rain[0], 1)} mm` });
  const problems = list.flatMap((c) => c.problems ?? []);
  return {
    tiles, problems, sensors, shutters, cameras, rooms: list.flatMap((c) => c.rooms ?? []), pictures: list.some((c) => c.connector === "netatmo"),
    others: modules.filter((m) => !sensors.includes(m) && !shutters.includes(m) && !cameras.includes(m)),
    title: problems.length ? tx("{0} à regarder dans ta maison.", problems.length === 1 ? tx("1 point") : tx("{0} points", problems.length)) : tx("Tout va bien dans ta maison."),
    text: worst > 1000 ? tx("L'air est à aérer : {0}.", co2?.name) : tx("{0} appareils suivis.", modules.length),
  };
}

/** A shutter's position in words (Netatmo: 0 closed, 100 open) */
export function shutterState(m: NetatmoModule): string {
  const p = m.values.current_position;
  if (typeof p !== "number") return tx("position inconnue");
  if (p >= 100) return tx("ouvert");
  return p <= 0 ? tx("fermé") : tx("ouvert à {0} %", p);
}
