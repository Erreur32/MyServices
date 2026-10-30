import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { groupByHost } from "./machineGroups";

const m = (name: string, links: Partial<NonNullable<Machine["links"]>> = {}) => ({ name, ip: name, links: { mac: null, vendor: null, names: [], sources: [], guest: null, hypervisor: null, ...links } }) as unknown as Machine;

describe("groupByHost", () => {
  it("puts a node first then its VMs, and the others last", () => {
    const g = groupByHost([
      m("vm1", { guest: { instance: "pve", node: "n1" } }), m("nas"), m("n1", { hypervisor: { instance: "pve", node: "n1" } }), m("vm2", { guest: { instance: "pve", node: "n1" } }),
      m("vm3", { guest: { instance: "pve", node: "n2" } }),
    ]);
    expect(g.map((x) => [x.title, x.list.map((y) => y.name)])).toEqual([["n1", ["n1", "vm1", "vm2"]], ["n2", ["vm3"]], ["", ["nas"]]]);
    expect(g[0].host?.name).toBe("n1");
    expect(g[1].host).toBeUndefined();
  });
  it("gives no group when nothing is virtual", () => {
    expect(groupByHost([m("a"), m("b")]).map((x) => x.title)).toEqual([""]);
  });
});
