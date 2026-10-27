import { describe, expect, it } from "vitest";
import { curve, delta, inPeriod, nearest, stripCells, sumSeries, type TilePoint } from "./tileHistory";

const NOW = 1_000_000;
const H = 3600;
const pt = (hoursAgo: number, value: number, total = 11): TilePoint => [NOW - hoursAgo * H, value, total];

describe("lib/tileHistory", () => {
  it("stripCells : une case par tranche, la pire lecture de la tranche, vide sans lecture", () => {
    const cells = stripCells([pt(23.9, 11), pt(10, 10), pt(10.1, 9), pt(0.1, 11)], 24, NOW);
    expect(cells).toHaveLength(48);
    expect(cells[0].level).toBe(0);
    expect(cells.filter((c) => c.level === 1)).toHaveLength(1);   // one machine missing
    expect(cells.filter((c) => c.level === 2)).toHaveLength(1);   // two missing: the worst of its slot
    expect(cells[47].level).toBe(0);
    expect(cells[20].level).toBeNull();
    expect(stripCells([], 168, NOW)).toHaveLength(84);
    expect(stripCells([pt(30, 0)], 24, NOW).every((c) => c.level === null)).toBe(true);   // older than the period
  });
  it("inPeriod, delta, nearest", () => {
    const pts = [pt(30, 11), pt(20, 11), pt(5, 9), pt(1, 10)];
    expect(inPeriod(pts, 24, NOW)).toHaveLength(3);
    expect(delta(pts, 24, NOW, (p) => p[1])).toBe(-1);   // 11 -> 10
    expect(delta(pts, 72, NOW, (p) => p[1])).toBe(-1);
    expect(delta([pt(1, 10)], 24, NOW, (p) => p[1])).toBeNull();
    expect(nearest(pts, 24, NOW, 1)).toEqual(pt(1, 10));
    expect(nearest(pts, 24, NOW, 0.79)?.[1]).toBe(9);   // about 5 hours before the end
    expect(nearest([pt(23, 11)], 24, NOW, 1)).toBeNull();   // nothing within two hours of that place
    expect(nearest([], 24, NOW, 0.5)).toBeNull();
    expect(nearest([pt(2, 10), pt(1, 9)], 24, NOW, 0, true)).toEqual(pt(2, 10));   // a curve starts at its first reading when the history is young
    expect(nearest([pt(2, 10), pt(1, 9)], 24, NOW, 0)).toBeNull();   // a strip starts at the start of the period: nothing there
  });
  it("curve : en escalier, creux sous le total, rupture après une heure sans lecture", () => {
    expect(curve([pt(1, 9)], 24, NOW).line).toBe("");
    const c = curve([pt(6, 11), pt(5, 9), pt(4, 11)], 24, NOW);
    expect(c.line.startsWith("M")).toBe(true);
    expect(c.line.match(/L/g)).toHaveLength(4);   // two steps of two segments
    expect(c.dips.match(/M/g)).toHaveLength(1);   // only the reading below the total
    expect(c.area.endsWith("Z")).toBe(true);
    expect(c.last).not.toBeNull();
    const broken = curve([pt(10, 11), pt(5, 11)], 24, NOW);   // five hours without a reading
    expect(broken.line.match(/M/g)).toHaveLength(2);
    const young = curve([pt(0.3, 9), pt(0.1, 9)], 24, NOW);   // 20 minutes of history: drawn over the whole width, not in the last pixels
    expect(young.line.startsWith("M0.0")).toBe(true);
    expect(Math.round(young.last?.[0] ?? 0)).toBe(80);   // its last reading is 6 of the 18 minutes known, the right edge being now
  });
  it("sumSeries : des listes de longueurs différentes s'additionnent sur leur dernière case", () => {
    expect(sumSeries([[1, 2, 3], [10, 20]])).toEqual([1, 12, 23]);
    expect(sumSeries([])).toEqual([]);
  });
});
