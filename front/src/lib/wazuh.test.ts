import { describe, expect, it } from "vitest";
import { scoreTone, vulnTone, wazuhOf } from "./wazuh";
import type { ServiceStatus } from "../types";

const st = (more: Partial<ServiceStatus>): ServiceStatus => ({ connector: "wazuh", name: "w", label: "Wazuh", ok: true, stale: false, message: "", ...more });

describe("wazuhOf", () => {
  it("finds the machine in the first Wazuh instance that knows it", () => {
    const list = [st({ connector: "glances", machines: { "10.0.0.5": { agent: "x" } } }), st({ instance: "wz", machines: { "10.0.0.5": { agent: "srv", status: "active" } } })];
    expect(wazuhOf(list, "10.0.0.5")).toEqual({ instance: "wz", stale: false, m: { agent: "srv", status: "active" } });
    expect(wazuhOf(list, "10.0.0.9")).toBeNull();
    expect(wazuhOf(undefined, "10.0.0.5")).toBeNull();
  });
});

describe("tones", () => {
  it("scores and vulnerabilities", () => {
    expect([scoreTone(85), scoreTone(62), scoreTone(30)]).toEqual(["ok", "warn", "bad"]);
    expect(vulnTone({ critical: 1, high: 0, medium: 0, low: 0, worst: [] })).toBe("bad");
    expect(vulnTone({ critical: 0, high: 2, medium: 0, low: 0, worst: [] })).toBe("warn");
    expect(vulnTone({ critical: 0, high: 0, medium: 5, low: 1, worst: [] })).toBe("ok");
  });
});
