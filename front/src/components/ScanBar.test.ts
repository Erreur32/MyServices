import { describe, expect, it } from "vitest";
import { fraction, netPercent } from "./ScanBar";

describe("ScanBar", () => {
  it("avancement : étapes finies plus part des sondes", () => {
    expect(fraction({ step: 1, steps: 8, label: "", done: null, total: null })).toBeCloseTo(0.03);
    expect(fraction({ step: 5, steps: 8, label: "", done: 50, total: 100 })).toBeCloseTo(4.5 / 8);
    expect(fraction({ step: 8, steps: 8, label: "", done: 10, total: 5 })).toBe(1);
  });

  it("recherche réseau : ping sur la 1re moitié, identification sur la 2e", () => {
    const n = { running: true, phase: "ping", done: 0, total: 253, up: 0, described: 0, found: 0 };
    expect(netPercent(n)).toBe(0);
    expect(netPercent({ ...n, done: 253 })).toBe(50);
    expect(netPercent({ ...n, phase: "identify", done: 253, up: 40, described: 0 })).toBe(50);
    expect(netPercent({ ...n, phase: "identify", done: 253, up: 40, described: 20 })).toBe(75);
    expect(netPercent({ ...n, phase: "identify", done: 253, up: 40, described: 40 })).toBe(100);
    expect(netPercent({ ...n, phase: "identify", up: 0, described: 0 })).toBe(50);
  });
});
