import { describe, expect, it } from "vitest";
import { domain, minMax, spanStart, sparkPath, SPAN_S, type MetricPoint } from "./sparkline";

const NOW = 1_800_000_000;
const pts: MetricPoint[] = [
  [NOW - SPAN_S - 60, 99, 99, 99, 99],          // older than 24 h: left out
  [NOW - 2400, 0, 50, 10, 40],
  [NOW - 1200, 100, null, 10, 50],
  [NOW, 50, 50, 10, 45],
];

describe("sparkPath", () => {
  it("starts at the first point when the history is younger than 24 h", () => {
    expect(spanStart(pts, "cpu", NOW)).toBe(NOW - 2400);
    expect(spanStart([[NOW - SPAN_S + 60, 1, null, null, null], [NOW - 30 * 3600, 1, null, null, null]], "cpu", NOW)).toBe(NOW - SPAN_S + 60);
    expect(spanStart([], "cpu", NOW)).toBe(NOW - SPAN_S);
  });
  it("draws the history, 0-100 for a filling", () => {
    expect(sparkPath(pts, "cpu", NOW)).toBe("M0.0 24.0 L50.0 0.0 L100.0 12.0");
  });
  it("skips a figure not reported, needs two points", () => {
    expect(sparkPath(pts, "mem", NOW)).toBe("M0.0 12.0 M100.0 12.0");   // 40 min without it: two pieces
    expect(sparkPath(pts.slice(0, 2), "cpu", NOW)).toBe("");
    expect(sparkPath([], "temp", NOW)).toBe("");
  });
  it("breaks the line after a long gap", () => {
    const gap: MetricPoint[] = [[NOW - 7200, 10, null, null, null], [NOW - 7000, 10, null, null, null], [NOW, 10, null, null, null]];
    expect(sparkPath(gap, "cpu", NOW).split("M")).toHaveLength(3);
  });
  it("keeps the values of a temperature in its box", () => {
    expect(sparkPath(pts, "temp", NOW)).toBe("M0.0 24.0 L50.0 0.0 L100.0 12.0");
  });
});

describe("domain and minMax", () => {
  it("gives a steady temperature 10 °C of room", () => {
    expect(domain("temp", [50, 52])).toEqual([46, 56]);
    expect(domain("temp", [30, 70])).toEqual([30, 70]);
    expect(domain("disk", [3])).toEqual([0, 100]);
  });
  it("lowest and highest over 24 h", () => {
    expect(minMax(pts, "cpu", NOW)).toEqual([0, 100]);
    expect(minMax(pts, "mem", NOW + SPAN_S + 1)).toBeNull();
  });
});
