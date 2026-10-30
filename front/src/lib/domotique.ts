// « Domotique » page: what the Netatmo connector (else Home Assistant) read, put in the order of a house (figures, sensors room by room, shutters, cameras).
import type { Snapshot } from "../api";
import type { HouseCurves, NetatmoModule } from "../types";
import { LOCALE, tx } from "./i18n";
import { tapoDevices } from "./tapo";

const SENSORS = ["NAMain", "NAModule1", "NAModule2", "NAModule3", "NAModule4", "NHC"];
const SHUTTERS = ["NBR", "NBO", "NBS", "Z3V", "Z3L"], CAMERAS = ["NACamera", "NOC", "NDB", "NCS", "NSD"];
export const LOW_BATTERY = 20;
/** An outdoor blind or awning (a « store ») is told from a roller shutter by its name: Netatmo gives both the same kind of device */
const BLIND = /store|ext[eé]rieur|\bext\b|brise|banne|pergola/i;

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

function co2Tone(ppm: number): HouseTone {
  if (ppm > 1400) return "bad";
  return ppm > 1000 ? "warn" : "ok";
}

const pointsText = (n: number) => (n === 1 ? tx("1 point") : tx("{0} points", n));

export function house(snap: Snapshot) {
  const list = rows(snap), modules = list.flatMap((c) => (c.modules ?? []).map((m) => ({ ...m, source: { connector: c.connector ?? "", name: c.instance ?? "" } })));
  const of = (types: string[]) => modules.filter((m) => types.includes(m.type ?? ""));
  const sensors = of(SENSORS), covers = of(SHUTTERS), cameras = of(CAMERAS);
  const blinds = covers.filter((m) => BLIND.test(m.name)), shutters = covers.filter((m) => !blinds.includes(m));
  const outdoor = sensors.filter((m) => m.type === "NAModule1"), indoor = sensors.filter((m) => m.type !== "NAModule1" && m.values.temperature != null);
  const co2 = indoor.filter((m) => typeof m.values.co2 === "number").sort((a, b) => Number(b.values.co2) - Number(a.values.co2))[0];
  const worst = co2 ? Number(co2.values.co2) : 0;
  const tiles: { label: string; value: string; sub?: string; tone?: HouseTone }[] = [
    { label: tx("Intérieur"), value: span(numbers(indoor, "temperature"), "°"), sub: tx("{0} pièce(s)", indoor.length) },
  ];
  if (outdoor.length) tiles.push({ label: tx("Extérieur"), value: span(numbers(outdoor, "temperature"), "°"), sub: outdoor[0].values.humidity != null ? tx("humidité {0} %", outdoor[0].values.humidity) : undefined });
  if (co2) tiles.push({ label: tx("CO2 le plus haut"), value: `${num(worst)} ppm`, sub: co2.name, tone: co2Tone(worst) });
  const noise = numbers(sensors, "noise"), pressure = numbers(sensors, "pressure"), rain = numbers(sensors, "rain_24h");
  if (noise.length) tiles.push({ label: tx("Bruit"), value: `${num(Math.max(...noise))} dB` });
  if (pressure.length) tiles.push({ label: tx("Pression"), value: `${num(pressure[0])} hPa` });
  if (rain.length) tiles.push({ label: tx("Pluie sur 24 h"), value: `${num(rain[0], 1)} mm` });
  const problems = list.flatMap((c) => c.problems ?? []);
  return {
    tiles, problems, sensors, shutters, blinds, cameras, rooms: list.flatMap((c) => c.rooms ?? []), pictures: list.some((c) => c.connector === "netatmo"),
    others: modules.filter((m) => !sensors.includes(m) && !covers.includes(m) && !cameras.includes(m)),
    title: problems.length ? tx("{0} à regarder dans ta maison.", pointsText(problems.length)) : tx("Tout va bien dans ta maison."),
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

export type Point = [number, number];
export interface Scale { t0: number; t1: number; lo: number; hi: number }

/** One scale for several series (the same time span and the same values range, widened to a multiple of `round`), null below two points */
export function scaleOf(all: Point[][], round = 0): Scale | null {
  const pts = all.flat();
  if (pts.length < 2) return null;
  const ts = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (round) { lo = Math.floor(lo / round) * round; hi = Math.ceil(hi / round) * round; }
  return { t0: Math.min(...ts), t1: Math.max(...ts), lo, hi: hi === lo ? lo + 1 : hi };
}

/** A line in a box of w × h, `pad` kept free above and below */
export function linePath(p: Point[], s: Scale, w: number, h: number, pad = 0): string {
  const x = (t: number) => ((t - s.t0) / (s.t1 - s.t0 || 1)) * w, y = (v: number) => h - pad - ((v - s.lo) / (s.hi - s.lo)) * (h - pad * 2);
  return p.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
}

/** Where a CO2 reading falls on the bar (400 to 1500 ppm: green to 800, orange to 1000... red above) and a battery level's colour */
export const co2Pin = (ppm: number): number => Math.min(100, Math.max(0, ((ppm - 400) / 1100) * 100));
export const batteryTone = (pct: number): "low" | "mid" | "hi" => (pct < 30 ? "low" : pct < 60 ? "mid" : "hi");

/** How many covers (shutters or blinds) are open at least a little */
export const openCount = (ms: NetatmoModule[]): number => ms.filter((m) => typeof m.values.current_position === "number" && m.values.current_position > 0).length;

export interface DeviceRow { key: string; name: string; brand: "Netatmo" | "Tapo"; kind: string; room: string; tone: HouseTone; state: string; battery: number | null }

const TAPO_KINDS = (): Record<string, string> => ({ plug: tx("Prise"), light: tx("Ampoule"), hub: tx("Hub"), camera: tx("Caméra"), sensor: tx("Capteur"), other: tx("Autre") });

/** Every device of the house on one list, by brand: what it is, where, whether it answers, its battery */
export function deviceRows(snap: Snapshot): DeviceRow[] {
  const h = house(snap), kinds: [NetatmoModule[], string][] = [[h.sensors, tx("Capteur")], [h.shutters, tx("Volet roulant")], [h.blinds, tx("Store extérieur")], [h.cameras, tx("Caméra")], [h.others, tx("Autre")]];
  const netatmo = kinds.flatMap(([list, kind]) => list.map((m): DeviceRow => ({ key: `n:${m.id ?? m.name}`, name: m.name, brand: "Netatmo", kind, room: m.room ?? "", tone: moduleState(m).tone, state: moduleState(m).label, battery: m.battery })));
  const names = TAPO_KINDS();
  const tapo = tapoDevices(snap).map((d): DeviceRow => ({ key: `t:${d.id}`, name: d.name, brand: "Tapo", kind: names[d.kind] ?? d.kind, room: "", tone: d.online ? (d.battery_low ? "warn" : "ok") : "bad",
    state: d.online ? (d.battery_low ? tx("Pile faible") : tx("En ligne")) : tx("Hors ligne"), battery: null }));
  return [...netatmo, ...tapo];
}
