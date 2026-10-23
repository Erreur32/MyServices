import { describe, expect, it } from "vitest";
import { fillTone, machineFigures, shortProbe, tempTone } from "./machineFigures";
import type { HealthHost } from "../types";

const host = (more: Partial<HealthHost> = {}): HealthHost => ({ id: "h", name: "srv · 10.0.0.5", reachable: true, level: "warn", ...more });

describe("fillTone", () => {
  it("is green, then orange from 75 %, red from 90 %", () => {
    expect([fillTone(10), fillTone(75), fillTone(90)]).toEqual(["ok", "warn", "bad"]);
  });
});

describe("tempTone", () => {
  it("is green, then orange from 85 °C, red from 95 °C", () => {
    expect([tempTone(60), tempTone(85), tempTone(95)]).toEqual(["ok", "warn", "bad"]);
  });
});

describe("machineFigures", () => {
  it("gives health, processor, memory, the fullest disk and the uptime", () => {
    const f = machineFigures(host({
      res: { available: true, cpu_pct: 11.4, mem_pct: 61, mem_used_mb: 39219, mem_total_mb: 64000 },
      disks: [{ mount: "/", used_pct: 15, avail_gb: 76 }, { mount: "/data", used_pct: 92, avail_gb: 10 }],
      temp: { available: true, celsius: 88.6 }, read_at: "2026-10-23T14:50:00+00:00",
    }), 3600 * 28, "processeur à 89 °C");
    expect(f.map((x) => x.key)).toEqual(["health", "cpu", "mem", "disk", "temp", "uptime"]);
    expect(f[0]).toMatchObject({ value: "À surveiller", sub: "processeur à 89 °C", tone: "warn", at: "2026-10-23T14:50:00+00:00" });
    expect(f[4]).toMatchObject({ value: "89 °C", tone: "warn" });
    expect(f[5].value).toBe("1 j 4 h");
    expect(f[5].sub).toMatch(/^depuis le /);
    expect(f[1]).toMatchObject({ value: "11 %", tone: "ok" });
    expect(f[2].sub).toBe("38,3 / 62,5 Go");
    expect(f[3]).toMatchObject({ value: "92 %", sub: "/data · 10 Go libres", tone: "bad" });
  });
  it("uses the instant processor of a Windows machine and leaves out what is not reported", () => {
    const f = machineFigures(host({ level: "na", load: { load_1: 0, ncpu: 4, available: true, cpu_pct: 80 }, temp: { available: false, celsius: 40 } }), null);
    expect(f.map((x) => [x.key, x.tone])).toEqual([["cpu", "warn"]]);
  });
  it("gives nothing for a machine without health", () => {
    expect(machineFigures(undefined, null)).toEqual([]);
  });
});

describe("shortProbe", () => {
  it("drops the chip prefix and the underscores", () => {
    expect(shortProbe("coretemp_core_12")).toBe("core 12");
    expect(shortProbe("coretemp_package_id_0")).toBe("package 0");
    expect(shortProbe("nct6798_peci_agent_0")).toBe("peci agent 0");
    expect(shortProbe("nvme_sensor_2_9")).toBe("nvme sensor 2 9");
  });
  it("cuts a name still too long, and keeps a plain one", () => {
    expect(shortProbe("acpitz_thermal_zone_number_12")).toBe("thermal zone nu…");
    expect(shortProbe("CPU")).toBe("CPU");
  });
});
