import { describe, expect, it } from "vitest";
import { last24h, plainLabel } from "./last24h";

const NOW = Date.parse("2026-10-10T12:00:00+02:00");
const at = (h: number) => new Date(NOW - h * 3600e3).toISOString();

describe("last 24 hours", () => {
  it("nothing happened", () => {
    expect(last24h([], {}, {}, NOW)).toMatchObject({ total: 0, rows: [] });
  });
  it("one row per kind, worst first, names once, old events ignored", () => {
    const events = [
      { ts: at(1), kind: "panne", label: "plex.lan" }, { ts: at(2), kind: "panne", label: "plex.lan" }, { ts: at(3), kind: "panne", label: "sonarr.lan" },
      { ts: at(5), kind: "retabli", label: "plex.lan" }, { ts: at(30), kind: "panne", label: "vieux.lan" },
    ];
    const got = last24h(events, { panne: "🔴 Panne", retabli: "🟢 Rétabli" }, { panne: 3, retabli: 0 }, NOW);
    expect(got.total).toBe(4);
    expect(got.rows.map((r) => [r.label, r.count, r.who])).toEqual([["Panne", 3, ["plex.lan", "sonarr.lan"]], ["Rétabli", 1, ["plex.lan"]]]);
    expect(got.hours).toHaveLength(24);
    expect(got.hours.reduce((n, h) => n + h.n, 0)).toBe(4);
    expect(got.hours[22].n).toBe(1);   // one hour ago: the last bars are the most recent hours
  });
  it("drops the emoji of a label", () => {
    expect(plainLabel("🔴 Panne")).toBe("Panne");
    expect(plainLabel("Sans emoji")).toBe("Sans emoji");
  });
});
