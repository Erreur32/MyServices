// The small curve of a figure tile (machine page): the last 24 hours of one figure, as an SVG path. Pure, so it is tested alone.

/** One point of /machines/<ip>/metrics: [ts (s), cpu, mem, disk, temp], a figure the machine did not report is null */
export type MetricPoint = [number, number | null, number | null, number | null, number | null];
export const METRIC_COLUMN = { cpu: 1, mem: 2, disk: 3, temp: 4 } as const;
export type MetricKey = keyof typeof METRIC_COLUMN;

export const SPAN_S = 24 * 3600;
const GAP_S = 30 * 60;   // no point for half an hour (machine off, MyServices stopped): the line breaks instead of joining across

/** The range drawn: 0-100 for a filling, the values with some room for a temperature (at least 10 °C, so a steady one stays flat) */
export function domain(key: MetricKey, values: number[]): [number, number] {
  if (key !== "temp") return [0, 100];
  const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max(0, 10 - (hi - lo)) / 2;
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}

/** The path of one figure over the 24 hours before `now`, in a box of w × h; "" with fewer than two points to draw */
export function sparkPath(points: MetricPoint[], key: MetricKey, now: number, w = 100, h = 24): string {
  const col = METRIC_COLUMN[key], start = now - SPAN_S;
  const kept = points.filter((p) => p[0] >= start && p[col] != null) as [number, ...number[]][];
  if (kept.length < 2) return "";
  const [lo, hi] = domain(key, kept.map((p) => p[col]));
  const x = (t: number) => ((t - start) / SPAN_S) * w, y = (v: number) => h - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1)) * h;
  return kept.map((p, i) => `${i === 0 || p[0] - kept[i - 1][0] > GAP_S ? "M" : "L"}${x(p[0]).toFixed(1)} ${y(p[col]).toFixed(1)}`).join(" ");
}

/** Lowest and highest value of a figure over the 24 hours, for the tooltip; null without any point */
export function minMax(points: MetricPoint[], key: MetricKey, now: number): [number, number] | null {
  const col = METRIC_COLUMN[key];
  const v = points.filter((p) => p[0] >= now - SPAN_S && p[col] != null).map((p) => p[col] as number);
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
}
