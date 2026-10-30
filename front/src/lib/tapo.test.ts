// The Tapo page sorts what the connector read and tells the overview its figures.
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { TapoDevice } from "../types";
import { hasTapo, tapoGroups, tapoState, tapoSummary, wifiBars } from "./tapo";

const dev = (o: Partial<TapoDevice>): TapoDevice => ({ id: o.name ?? "x", name: "x", model: "P110M", kind: "plug", online: true, ...o });
const snap = (devices: TapoDevice[], extra: object = {}) => ({ data: { services_status: [{ connector: "tapo", ok: true, stale: false, message: "", devices, problems: [], ...extra }] } }) as unknown as Snapshot;

describe("Tapo", () => {
  it("has no summary without a connector, and has a page as soon as one is set up", () => {
    const none = { data: { services_status: [] } } as unknown as Snapshot;
    expect([hasTapo(none), tapoSummary(none)]).toEqual([false, null]);
    expect(hasTapo(snap([]))).toBe(true);
  });

  it("adds the plugs that are on, and their energy in kWh", () => {
    const s = tapoSummary(snap([
      dev({ name: "a", power_w: 86, on: true, today_wh: 1840, month_wh: 41200 }), dev({ name: "b", power_w: 20, on: false, today_wh: 160, month_wh: 800 }),
      dev({ name: "c", kind: "camera", model: "C520WS" }), dev({ name: "d", kind: "camera", online: false }),
    ], { problems: ["d ne répond plus"] }))!;
    expect([s.watts, s.today_kwh, s.month_kwh]).toEqual([86, 2, 42]);
    expect([s.cameras, s.devices, s.offline, s.problems]).toEqual([{ up: 1, total: 2 }, 4, ["d"], ["d ne répond plus"]]);
  });

  it("leaves the figures empty when no plug has a meter", () => {
    const s = tapoSummary(snap([dev({ kind: "light", model: "L530" })]))!;
    expect([s.watts, s.today_kwh, s.month_kwh]).toEqual([null, null, null]);
  });

  it("sorts the devices, metered plugs first", () => {
    const g = tapoGroups(snap([dev({ name: "plain" }), dev({ name: "meter", power_w: 3 }), dev({ name: "hub", kind: "hub" }), dev({ name: "cam", kind: "camera" })]));
    expect([g.plugs.map((d) => d.name), g.cameras.length, g.others.map((d) => d.name)]).toEqual([["meter", "plain"], 1, ["hub"]]);
  });

  it("tells a refused account, an old reading, and the signal bars", () => {
    expect(tapoState(snap([], { ok: false, message: "refusé" }))).toEqual({ tone: "bad", message: "refusé" });
    expect(tapoState(snap([], { stale: true })).tone).toBe("warn");
    expect(tapoState(snap([])).tone).toBe("ok");
    expect([-50, -60, -70, -90, null].map(wifiBars)).toEqual([4, 3, 2, 1, 0]);
  });
});
