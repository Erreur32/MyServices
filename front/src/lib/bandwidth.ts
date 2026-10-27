// The rate of the Internet link as the Network tiles show it: points are [time, kbit/s, capacity of the link in kbit/s] per source and direction.
import type { TilePoint } from "./tileHistory";

/** A rate in kbit/s as « 640 kb/s », « 22 Mb/s », « 1,8 Gb/s » */
export function rateText(kbit: number): string {
  if (kbit >= 1_000_000) return `${(kbit / 1_000_000).toFixed(1).replace(".", ",")} Gb/s`;
  if (kbit >= 1000) return `${(kbit / 1000).toFixed(kbit >= 10_000 ? 0 : 1).replace(".", ",")} Mb/s`;
  return `${Math.round(kbit)} kb/s`;
}

/** The last point of a series, null without any */
export const lastOf = (points: TilePoint[] | null): TilePoint | null => (points?.length ? points[points.length - 1] : null);

/** The highest rate of the points kept for the period: the top of the scale shared by the curves shown (at least 1 so a flat line stays flat) */
export const topOf = (lists: (TilePoint[] | null)[]): number => Math.max(1, ...lists.flatMap((l) => (l ?? []).map((p) => p[1])));
