import { describe, expect, it } from "vitest";
import type { Item } from "../tabs/Availability";
import { availabilityOf, machineFromHash, machineSettingsRedirect } from "./machineHash";

describe("machine page address", () => {
  it("names a machine, with or without the Access part", () => {
    expect(machineFromHash("#machines/10.0.0.5")).toEqual({ ip: "10.0.0.5" });
    expect(machineFromHash("#machines/10.0.0.5/access")).toEqual({ ip: "10.0.0.5", tab: "access" });
    expect(machineFromHash("#machines/10.0.0.5/settings")).toEqual({ ip: "10.0.0.5", tab: "settings" });
    expect(machineFromHash("#machines/10.0.0.5/agent")).toEqual({ ip: "10.0.0.5", tab: "access" });
    expect(machineFromHash("#machines/10.0.0.5/watch/ssh_auth")).toEqual({ ip: "10.0.0.5", watch: "ssh_auth" });
    expect(machineFromHash('#machines/10.0.0.5/watch/x"]')).toEqual({ ip: "10.0.0.5" });
  });
  it("the list, another tab or a bad address: nothing", () => {
    expect(machineFromHash("#machines")).toBeNull();
    expect(machineFromHash("#services/10.0.0.5")).toBeNull();
    expect(machineFromHash("#machines/constructor")).toBeNull();
    expect(machineFromHash("")).toBeNull();
  });
  it("old settings links of a machine lead to its page", () => {
    expect(machineSettingsRedirect("#settings/machines/10.0.0.5")).toBe("machines/10.0.0.5");
    expect(machineSettingsRedirect("#settings/agents/10.0.0.5")).toBe("machines/10.0.0.5/agent");
    expect(machineSettingsRedirect("#settings/machines")).toBeNull();
    expect(machineSettingsRedirect("#settings/backups/3")).toBeNull();
  });
});

describe("availability of a machine", () => {
  const item = (o: Partial<Item>): Item => ({ key: "k", kind: "machine", label: null, machine: null, target: null, uptime: 100, samples: 1, down: 0, ms: null, last: null, cells: [], ...o });
  it("by address first, then by name; services are ignored", () => {
    const items = [item({ key: "a", kind: "service", target: "10.0.0.5" }), item({ key: "b", machine: "nas" }), item({ key: "c", target: "10.0.0.5" })];
    expect(availabilityOf(items, { ip: "10.0.0.5", name: "nas" })?.key).toBe("c");
    expect(availabilityOf(items, { ip: "10.0.0.9", name: "nas" })?.key).toBe("b");
    expect(availabilityOf(items, { ip: "10.0.0.9", name: "pc" })).toBeUndefined();
  });
});
