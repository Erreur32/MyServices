import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { unifiDeviceOf, unifiHealth } from "./unifi";

const m = (x: Partial<Machine>): Machine => ({ ip: "10.0.0.1", name: "UCG Fiber", ping: true, off: false, services: 0, npm: 0, down: 0, ...x });
const gw = { name: "Cloud Gateway Fiber", model: "UDMA6A8", type: "udm", ip: "10.0.0.2", state: "connected", version: "5.1.33", cpu_pct: "12.5", mem_pct: "40" };

describe("unifi", () => {
  it("finds a device by IP, or the only gateway for the machine set as gateway", () => {
    expect(unifiDeviceOf(m({ ip: "10.0.0.2" }), [gw])).toBe(gw);
    expect(unifiDeviceOf(m({ detected: ["gateway"] }), [gw])).toBe(gw);
    expect(unifiDeviceOf(m({}), [gw])).toBeUndefined();
    expect(unifiDeviceOf(m({ gateway: true }), [gw, { ...gw, ip: "x" }])).toBeUndefined();   // two gateways: no guess
  });
  it("reads OK, busy or down, and an update when MynetworK passes it on", () => {
    expect(unifiHealth(m({}), gw)).toMatchObject({ level: "ok", reachable: true, res: { available: true, cpu_pct: 12.5, mem_pct: 40 } });
    expect(unifiHealth(m({}), { ...gw, cpu_pct: "95" }).level).toBe("warn");
    expect(unifiHealth(m({}), { ...gw, state: "disconnected" }).level).toBe("crit");
    expect(unifiHealth(m({}), { ...gw, upgradable: true, upgrade_to_firmware: "5.2" }).apt).toEqual({ upgradable: 1, sample: ["firmware → 5.2"] });
  });
});
