import { describe, expect, it } from "vitest";
import { healConnectors, type Live } from "../api";
import type { Data } from "../types";

const GENERATED = "2026-10-18T10:00:00Z";
const t0 = Date.parse(GENERATED) / 1000;
const live = (at: number, ok = true): Live => ({ ts: at, sources: { "mynetwork/MynetworK": { at, ok } } });
const data = (rows: object[]) => ({ generated: GENERATED, connectors: rows, machine_list: [] }) as unknown as Data;
const failed = { type: "mynetwork", name: "MynetworK", ok: false, message: "injoignable (timed out)", stale: true };

describe("healConnectors", () => {
  it("shows as read a connector that a newer light reading read fine", () => {
    const got = healConnectors(data([failed]), live(t0 + 60)) as unknown as { connectors: object[] };
    expect(got.connectors).toEqual([{ ...failed, ok: true, stale: false, message: "" }]);
  });
  it("keeps the failure when the light reading is older than the collection, or failed too", () => {
    const d = data([failed]);
    expect(healConnectors(d, live(t0 - 60))).toBe(d);
    expect(healConnectors(d, live(t0 + 60, false))).toBe(d);
  });
  it("leaves a connector that was fine, and one the light reading does not know", () => {
    const d = data([{ ...failed, ok: true, stale: false }, { type: "dockhand", name: "x", ok: false, message: "down" }]);
    expect(healConnectors(d, live(t0 + 60))).toBe(d);
  });
});
