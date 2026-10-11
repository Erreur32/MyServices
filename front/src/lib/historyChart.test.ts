import { describe, expect, it } from "vitest";
import { buckets, dayBuckets, groupOf, heat, stepFor, ticks, yScale } from "./historyChart";

describe("graphiques de l'historique", () => {
  it("classe les types d'événements en familles", () => {
    expect(groupOf("panne")).toBe("services");
    expect(groupOf("health_crit")).toBe("sante");
    expect(groupOf("inconnu")).toBe("veille");
  });

  it("affine le pas sur les courtes périodes", () => {
    expect(stepFor(1)).toBeLessThan(stepFor(7));
    expect(stepFor(7)).toBeLessThan(stepFor(90));
  });

  it("range chaque événement dans son barreau, à l'heure près", () => {
    const from = Date.UTC(2026, 9, 11, 0, 0), hour = 3600e3;
    const b = buckets([{ ts: from / 1000 + 100, kind: "panne" }, { ts: from / 1000 + 3700, kind: "retabli" }, { ts: from / 1000 + 3800, kind: "panne" }, { ts: from / 1000 + 99999, kind: "panne" }], from, from + 3 * hour, hour);
    expect(b.map((x) => x.total)).toEqual([1, 2, 0]);  // le dernier est hors période
    expect(b[1].parts).toEqual({ retours: 1, services: 1 });
  });

  it("compte par jour de la semaine et par heure", () => {
    const ts = new Date(2026, 9, 12, 14, 30).getTime() / 1000;  // lundi 12 octobre 2026, 14 h
    const g = heat([{ ts, kind: "panne" }, { ts: ts + 60, kind: "panne" }]);
    expect(g[0][14]).toBe(2);
    expect(g.flat().reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("repli par jour quand les événements sont tronqués", () => {
    const now = new Date(2026, 9, 12, 12).getTime();
    const b = dayBuckets([{ day: "2026-10-12", kind: "panne", n: 3 }, { day: "2026-10-01", kind: "retabli", n: 9 }], 3, now);
    expect(b).toHaveLength(3);
    expect(b.at(-1)!.total).toBe(3);
  });

  it("axe vertical aux valeurs rondes", () => {
    expect(yScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(yScale(7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(yScale(23).top).toBeGreaterThanOrEqual(23);
    expect(yScale(120).ticks.every((t) => t % 10 === 0 || t % 25 === 0 || t % 20 === 0 || t % 50 === 0)).toBe(true);
    expect(yScale(3).ticks).toEqual([0, 1, 2, 3]);
  });

  it("repères de l'axe", () => {
    expect(ticks(0, 60, 6)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });
});
