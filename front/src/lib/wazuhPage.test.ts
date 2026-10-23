import { describe, expect, it } from "vitest";
import { averageScore, machineOfAgent, scoreOf, wazuhRows } from "./wazuhPage";
import type { Machine, ServiceStatus } from "../types";

const mach = (ip: string, name: string): Machine => ({ ip, name, ping: true, off: false, services: 0, npm: 0, down: 0 });
const machines = [mach("10.0.0.5", "srv"), mach("10.0.0.20", "Home Assistant")];
const v = (critical: number, high: number) => ({ critical, high, medium: 1, low: 0, worst: [] });
const wz: ServiceStatus = { connector: "wazuh", name: "w", label: "Wazuh", ok: true, stale: false, message: "", machines: {
  "10.0.0.5": { agent: "srv", status: "active", vulns: v(2, 10), sca: [{ name: "CIS", score: 60, pass: 1, fail: 1 }, { name: "Other", score: 40, pass: 1, fail: 1 }] },
  "172.30.0.3": { agent: "HomeAssistant", status: "active", vulns: v(5, 1), sca: [{ name: "CIS", score: 80, pass: 1, fail: 0 }] },
  "10.0.0.9": { agent: "pc", status: "disconnected", vulns: v(9, 9) },
} };

describe("wazuhRows", () => {
  it("matches machines by IP then name, worst first, disconnected last", () => {
    const rows = wazuhRows([{ ...wz, connector: "glances" }, wz], machines);
    expect(rows.map((r) => [r.m.agent, r.machine?.ip ?? null, r.score, r.vulns])).toEqual([
      ["HomeAssistant", "10.0.0.20", 80, 7], ["srv", "10.0.0.5", 40, 13], ["pc", null, null, 19]]);
    expect(averageScore(rows)).toBe(60);
    expect(averageScore([])).toBeNull();
  });
  it("machineOfAgent and scoreOf", () => {
    expect(machineOfAgent("10.0.0.7", "", machines)).toBeNull();
    expect(scoreOf({ agent: "x" })).toBeNull();
  });
});
