import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { unifiDeviceOf, unifiHealth, withSystem } from "./unifi";

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
  it("uses the system summary: the gateway by its LAN address, its temperature and the UniFi Network update", () => {
    const sys = { version: "9.4.19", update_available: true, gateway: { lan_ip: "10.0.0.1", upgradable: false, temperature: 61, mem_total: 4294967296, mem_used: 1073741824 } };
    expect(unifiDeviceOf(m({}), [gw], sys)).toBe(gw);                       // no gateway flag needed: its LAN address matches
    expect(unifiDeviceOf(m({ ip: "10.0.0.9", gateway: true }), [gw], sys)).toBeUndefined();
    const h = unifiHealth(m({}), withSystem(gw, sys));
    expect(h.temp).toMatchObject({ available: true, celsius: 61 });
    expect(h.res?.mem_total_mb).toBe(4096);
    expect(h.apt).toEqual({ upgradable: 1, sample: ["UniFi Network"] });
  });
});
