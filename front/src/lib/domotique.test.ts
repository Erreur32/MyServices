// The house page sorts the devices by what they are and tells only what was read.
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { NetatmoModule } from "../types";
import { curveRows, hasDomotique, house, measures, moduleState, shutterState } from "./domotique";

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
});
