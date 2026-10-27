// History drawn in the figure tiles of the Machines page: a strip of states (reachability) and a stepped curve (health). Pure, so it is tested alone.

/** One point of /machines/history: [time (s), value, total] */
export type TilePoint = [number, number, number];

export const PERIODS = [24, 72, 168] as const;   // hours: a day, a weekend, a week
export type Period = (typeof PERIODS)[number];

const COLUMNS: Record<Period, number> = { 24: 48, 72: 72, 168: 84 };   // half an hour, an hour, two hours a column
const GAP_S = 3600;   // no point for an hour (machine off, MyServices stopped): the curve breaks instead of joining across

/** A column of the strip: its start, and how bad it was (0 all answered, 1 one missing, 2 two or more), null when nothing was read */
export interface Cell { t: number; level: 0 | 1 | 2 | null }

/** The strip of a period ending at `now`: one cell per slot, the worst reading of the slot (machines that did not answer = total - value) */
export function stripCells(points: TilePoint[], hours: Period, now: number): Cell[] {
  const cols = COLUMNS[hours], span = hours * 3600, start = now - span, step = span / cols;
  const worst: (number | null)[] = Array.from({ length: cols }, () => null);
  for (const [t, value, total] of points) {
    if (t < start || t > now) continue;
    const i = Math.min(cols - 1, Math.floor((t - start) / step));
    worst[i] = Math.max(worst[i] ?? 0, total - value);
  }
  return worst.map((w, i) => ({ t: start + i * step, level: w === null ? null : (Math.min(w, 2) as 0 | 1 | 2) }));
}

/** The points of the period, oldest first */
export const inPeriod = (points: TilePoint[], hours: Period, now: number): TilePoint[] => points.filter((p) => p[0] >= now - hours * 3600 && p[0] <= now);

export interface Curve { line: string; area: string; dips: string; last: [number, number] | null }
const NO_CURVE: Curve = { line: "", area: "", dips: "", last: null };

/** The stepped curve (a figure jumps by whole machines): the line, its filling, the stretches below the total, and the last point, in a box of w × h.
 *  The scale goes from 0 to the biggest total seen, so a machine lost shows as a drop. It starts at the first point when the history is younger
 *  than the period, so a few minutes are not squeezed into the last pixels. Empty with fewer than two points.
 *  `scale`: a level out of that value (a percentage), not a count of machines: fixed top, no stretch under the total.
 *  `from`: the start of the axis when several curves share it (each would otherwise start at its own first point).
 *  `hold`: the last value is carried on to `now` (the right edge), so curves read at different moments end side by side. */
export function curve(points: TilePoint[], hours: Period, now: number, w = 120, h = 34, scale?: number, from?: number, hold = false): Curve {
  const kept = inPeriod(points, hours, now);
  if (kept.length < 2) return NO_CURVE;
  const start = from ?? kept[0][0], span = Math.max(now - start, 1), top = scale ?? Math.max(1, ...kept.map((p) => p[2]));
  const x = (t: number) => ((t - start) / span) * w;
  const y = (v: number) => h - 2 - (Math.min(Math.max(v, 0), top) / top) * (h - 4);
  let line = "", area = "", dips = "";
  let runStart = 0;
  kept.forEach((p, i) => {
    const prev = kept[i - 1];
    const fresh = i === 0 || p[0] - prev[0] > GAP_S;
    if (fresh) {
      if (i > 0) area += closeRun(kept[i - 1][0], kept[runStart][0], x, h);
      runStart = i;
      line += `M${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`;
      area += `M${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`;
    } else {
      const step = `L${x(p[0]).toFixed(1)} ${y(prev[1]).toFixed(1)}L${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`;
      line += step;
      area += step;
    }
    if (scale === undefined && p[1] < p[2]) {
      const end = kept[i + 1] && kept[i + 1][0] - p[0] <= GAP_S ? kept[i + 1][0] : p[0];
      dips += `M${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}L${x(end).toFixed(1)} ${y(p[1]).toFixed(1)}`;
    }
  });
  const last = kept.at(-1)!;
  const endT = hold && now - last[0] <= GAP_S ? now : last[0];
  if (endT > last[0]) {
    const carry = `L${x(endT).toFixed(1)} ${y(last[1]).toFixed(1)}`;
    line += carry;
    area += carry;
  }
  area += closeRun(endT, kept[runStart][0], x, h);
  return { line, area, dips, last: [x(endT), y(last[1])] };
}

/** Closes the filling of a run down to the bottom of the box */
const closeRun = (endT: number, startT: number, x: (t: number) => number, h: number) => `L${x(endT).toFixed(1)} ${h}L${x(startT).toFixed(1)} ${h}Z`;

/** The change of the figure over the period (last minus first), null with fewer than two points */
export function delta(points: TilePoint[], hours: Period, now: number, figure: (p: TilePoint) => number): number | null {
  const kept = inPeriod(points, hours, now);
  return kept.length < 2 ? null : figure(kept.at(-1)!) - figure(kept[0]);
}

/** The reading nearest to a place of the chart (0 left edge, 1 right edge); null when none is within two hours of it.
 *  `fit`: the chart starts at the first reading (a curve) instead of at the start of the period (a strip). */
export function nearest(points: TilePoint[], hours: Period, now: number, frac: number, fit = false, from?: number): TilePoint | null {
  const kept = inPeriod(points, hours, now);
  if (!kept.length) return null;
  const start = fit ? (from ?? kept[0][0]) : now - hours * 3600;
  const at = start + Math.min(Math.max(frac, 0), 1) * (now - start);
  const best = kept.reduce((a, b) => (Math.abs(b[0] - at) < Math.abs(a[0] - at) ? b : a), kept[0]);
  return Math.abs(best[0] - at) <= 2 * 3600 ? best : null;
}

/** Counts per slot of several sources added up, lined up on their most recent slot (the last value of each list is the latest) */
export function sumSeries(lists: number[][]): number[] {
  const len = Math.max(0, ...lists.map((l) => l.length));
  return Array.from({ length: len }, (_, i) => lists.reduce((n, l) => n + (l[l.length - len + i] ?? 0), 0));
}
