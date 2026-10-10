import { describe, expect, it } from "vitest";
import { fraction } from "./ScanBar";

describe("ScanBar", () => {
  it("avancement : étapes finies plus part des sondes", () => {
    expect(fraction({ step: 1, steps: 8, label: "", done: null, total: null })).toBeCloseTo(0.03);
    expect(fraction({ step: 5, steps: 8, label: "", done: 50, total: 100 })).toBeCloseTo(4.5 / 8);
    expect(fraction({ step: 8, steps: 8, label: "", done: 10, total: 5 })).toBe(1);
  });
});
