// The house page sorts the devices by what they are and tells only what was read.
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { NetatmoModule } from "../types";
import { batteryTone, deviceRows, co2Pin, curveRows, hasDomotique, house, linePath, measures, moduleState, scaleOf, shutterState } from "./domotique";

const mod = (o: Partial<NetatmoModule>): NetatmoModule => ({ name: "x", reachable: true, battery: null, low: false, values: {}, ...o });
const snap = (modules: NetatmoModule[], problems: string[] = []) => ({ data: { services_status: [{ connector: "netatmo", modules, problems }] } }) as unknown as Snapshot;

describe("house page", () => {
  it("appears only with devices read", () => {
    expect(hasDomotique(snap([]))).toBe(false);
    expect(hasDomotique(snap([mod({ type: "NAMain" })]))).toBe(true);
  });

  it("sorts the devices and counts indoors apart from outdoors", () => {
    const h = house(snap([
      mod({ type: "NAMain", name: "Salon", values: { temperature: 22, co2: 1200 } }), mod({ type: "NAModule1", name: "Ext", values: { temperature: 9 } }),
      mod({ type: "NBR" }), mod({ type: "NOC" }), mod({ type: "NBG" }),
    ], ["Vent ne répond plus"]));
    expect([h.sensors.length, h.shutters.length, h.cameras.length, h.others.length]).toEqual([2, 1, 1, 1]);
    expect(h.tiles.find((t) => t.label === "Intérieur")?.value).toBe("22°");
    expect(h.tiles.find((t) => t.label === "CO2 le plus haut")?.tone).toBe("warn");
    expect(h.title).toBe("1 point à regarder dans ta maison.");
    expect(h.text).toContain("Salon");
  });

  it("reads what Home Assistant knows, unless the direct connector is there", () => {
    const viaHa = { connector: "home-assistant", instance: "ha", netatmo: { modules: [mod({ type: "NBR", name: "Volet" })], rooms: [], problems: ["Vent ne répond plus"] }, problems: ["HA seul"] };
    const ha = { data: { services_status: [viaHa] } } as unknown as Snapshot;
    expect(hasDomotique(ha)).toBe(true);
    expect(house(ha).shutters[0].source).toEqual({ connector: "home-assistant", name: "ha" });
    expect(house(ha).problems).toEqual(["Vent ne répond plus"]);
    expect(house(ha).pictures).toBe(false);
    const both = { data: { services_status: [viaHa, { connector: "netatmo", instance: "n", modules: [mod({ type: "NAMain" })] }] } } as unknown as Snapshot;
    expect(house(both).shutters).toEqual([]);
    expect(house(both).pictures).toBe(true);
  });

  it("adds the rest of the house to the direct connector", () => {
    const s = { data: { services_status: [
      { connector: "netatmo", instance: "n", modules: [mod({ type: "NAMain", name: "Salon" })] },
      { connector: "home-assistant", instance: "ha", netatmo: { modules: [mod({ type: "NAMain", name: "Salon" })], rooms: [], problems: [] },
        home: { modules: [mod({ type: "NHC", name: "Xiaomi" })], rooms: [{ name: "Clim", temperature: 21, setpoint: 22 }], problems: [] } },
    ] } } as unknown as Snapshot;
    expect(house(s).sensors.map((m) => m.name)).toEqual(["Salon", "Xiaomi"]);
    expect(house(s).rooms.map((r) => r.name)).toEqual(["Clim"]);
  });

  it("draws a curve only from two points, with its range", () => {
    const rows = curveRows(mod({ values: { temperature: 20 } }), { temperature: [[0, 18], [1800, 21]], co2: [[0, 500]] });
    expect(rows.map((r) => [r.key, r.label, r.path])).toEqual([["temperature", "Température", "M0.0 24.0 L100.0 0.0"]]);
    expect(rows[0].range).toBe("18 à 21°");
  });

  it("shows only the measures of a sensor, an unreachable one first says so", () => {
    expect(measures(mod({ values: { rain: 0 } })).map((v) => v.label)).toEqual(["Pluie"]);
    expect(moduleState(mod({ reachable: false, battery: 10 })).tone).toBe("bad");
    expect(moduleState(mod({ battery: 15 })).tone).toBe("warn");
  });

  it("words a shutter's position", () => {
    expect(shutterState(mod({ values: { current_position: 100 } }))).toBe("ouvert");
    expect(shutterState(mod({ values: { current_position: 0 } }))).toBe("fermé");
    expect(shutterState(mod({ values: { current_position: 40 } }))).toBe("ouvert à 40 %");
    expect(shutterState(mod({}))).toBe("position inconnue");
  });

  it("draws the series on one scale, widened to round values", () => {
    const a: [number, number][] = [[0, 18.3], [100, 21.2]], b: [number, number][] = [[0, 10], [100, 12]];
    const sc = scaleOf([a, b], 2);
    expect(sc).toEqual({ t0: 0, t1: 100, lo: 10, hi: 22 });
    expect(linePath(b, sc!, 100, 12)).toBe("M0.0 12.0 L100.0 10.0");
    expect(scaleOf([[[0, 1]]])).toBeNull();
    expect(scaleOf([[[0, 5], [1, 5]]])?.hi).toBe(6);
  });

  it("places a CO2 reading and a battery on their bars", () => {
    expect([co2Pin(300), co2Pin(950), co2Pin(2000)]).toEqual([0, 50, 100]);
    expect([batteryTone(10), batteryTone(45), batteryTone(90)]).toEqual(["low", "mid", "hi"]);
  });

  it("keeps the outdoor blinds apart from the roller shutters", () => {
    const h = house(snap([mod({ type: "NBR", name: "Volet salon" }), mod({ type: "NBO", name: "Stores EXT Combinés" }), mod({ type: "NBR", name: "Store banne" })]));
    expect([h.shutters.map((m) => m.name), h.blinds.map((m) => m.name), h.others.length]).toEqual([["Volet salon"], ["Stores EXT Combinés", "Store banne"], 0]);
  });

  it("lists every device of the house with its brand, kind and state", () => {
    const s2 = { data: { services_status: [
      { connector: "netatmo", modules: [mod({ type: "NAMain", name: "Salon", room: "Salon", battery: 15 }), mod({ type: "NOC", name: "Cam", reachable: false })] },
      { connector: "tapo", devices: [{ id: "1", name: "Prise", model: "P110", kind: "plug", online: true }] },
    ] } } as unknown as Snapshot;
    expect(deviceRows(s2).map((r) => [r.brand, r.name, r.kind, r.tone])).toEqual([["Netatmo", "Salon", "Capteur", "warn"], ["Netatmo", "Cam", "Caméra", "bad"], ["Tapo", "Prise", "Prise", "ok"]]);
  });
});
