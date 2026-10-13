import { describe, expect, it } from "vitest";
import { detectedValue, type Context } from "./detectedValue";
import type { ConnectorInstance, Machine, Proposal } from "../types";

const machine = (ip: string, extra: Partial<Machine> = {}) => ({ ip, name: ip, ...extra }) as unknown as Machine;
const p = (connector: string, ip = "10.0.0.6") => ({ connector, ip, label: connector }) as Proposal;
const ctx = (over: Partial<Context> = {}): Context => ({ machines: [], instances: [], dockerOk: new Set(), ...over });

describe("detectedValue: what a detected service would bring, and whether it is already read", () => {
  it("Arcane on a machine whose containers are read over SSH and by Dockhand: covered", () => {
    const m = machine("10.0.0.6", { links: { mac: null, vendor: null, names: [], guest: null, hypervisor: null,
      sources: [{ source: "dockhand", label: "Dockhand", instance: "dh", by: "ip", ok: true }] } });
    const v = detectedValue(p("arcane"), ["containers"], ctx({ machines: [m], dockerOk: new Set(["10.0.0.6"]) }));
    expect(v).toEqual({ brings: ["Conteneurs"], coveredBy: ["SSH", "Dockhand"] });
  });
  it("Glances on a machine read by SSH: health already there", () => {
    const v = detectedValue(p("glances"), ["status"], ctx({ machines: [machine("10.0.0.6", { ssh: { alias: "a", port: 22 } })] }));
    expect(v).toEqual({ brings: ["Santé de la machine"], coveredBy: ["SSH"] });
  });
  it("Glances on a machine with no health source: new", () => {
    expect(detectedValue(p("glances"), ["status"], ctx({ machines: [machine("10.0.0.6")] })).coveredBy).toEqual([]);
  });
  it("its own data (status card): always new", () => {
    expect(detectedValue(p("speedtest-tracker"), ["status"], ctx()).coveredBy).toEqual([]);
  });
  it("Pulse when Proxmox VE is connected: covered", () => {
    const inst = [{ type: "proxmox", label: "Proxmox VE", name: "pve", config: {}, set: {}, enabled: true }] as unknown as ConnectorInstance[];
    expect(detectedValue(p("pulse"), ["virtualization"], ctx({ instances: inst })).coveredBy).toEqual(["Proxmox VE"]);
  });
});
