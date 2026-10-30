import { describe, expect, it } from "vitest";
import { boxRate, boxState, boxTiles, currentRates, hasSystem, lineName, lineShare, updateWord, wifiWord } from "./box";
import type { BoxReading } from "../types";

const EMPTY: BoxReading = { model: null, line: null, connected: null, down_bps: null, up_bps: null, line_down_bps: null, line_up_bps: null, public_ip: null, uptime_s: null,
  firmware: null, update_available: null, latest_firmware: null, devices: null, wifi: null, temperature: null };
const box = (o: Partial<BoxReading>): BoxReading => ({ ...EMPTY, ...o });

describe("box", () => {
  it("an empty reading shows nothing", () => {
    expect(boxTiles(EMPTY)).toEqual([]);
    expect(boxState(EMPTY)).toBeNull();
    expect(hasSystem(EMPTY)).toBe(false);
    expect(lineName(null)).toBeUndefined();
  });

  it("the state says the line when it is known", () => {
    expect(boxState(box({ connected: true, line: "dsl" }))).toEqual({ tone: "ok", label: "en ligne · DSL" });
    expect(boxState(box({ connected: false }))).toEqual({ tone: "bad", label: "coupée" });
  });

  it("every tile of a full box, in order", () => {
    const tiles = boxTiles(box({ connected: true, down_bps: 18_400_000, up_bps: 0, uptime_s: 90_000, devices: 0, wifi: false, temperature: 51.4 }));
    expect(tiles.map((t) => t.value)).toEqual(["18 Mb/s", "0 kb/s", "1 j 1 h", "0", "coupé", "51 °C"]);
  });

  it("a line that is down shows no current rate", () => {
    const down = box({ connected: false, down_bps: 1000, up_bps: 1000 });
    expect(currentRates(down)).toEqual([undefined, undefined]);
    expect(boxTiles(down)).toEqual([]);
  });

  it("rates and the share of the line", () => {
    expect(boxRate(null)).toBeUndefined();
    expect(boxRate(1_200_000)).toBe("1,2 Mb/s");
    expect(lineShare(20, 40)).toBe(50);
    expect(lineShare(80, 40)).toBe(100);
    expect(lineShare(null, 40)).toBeNull();
    expect(lineShare(20, null)).toBeNull();
    expect(lineShare(20, 0)).toBeNull();
  });

  it("system words", () => {
    expect(wifiWord(box({ wifi: true }))).toBe("actif");
    expect(wifiWord(EMPTY)).toBeUndefined();
    expect(updateWord(box({ update_available: true, latest_firmware: "1.3" }))).toBe("→ 1.3");
    expect(updateWord(box({ update_available: true }))).toBe("disponible");
    expect(updateWord(box({ update_available: false, latest_firmware: "1.3" }))).toBeUndefined();
    expect(hasSystem(box({ firmware: "1.2" }))).toBe(true);
  });
});
