import { describe, expect, it } from "vitest";
import type { NetHost, Unlinked } from "../types";
import { mergeDevices } from "./devices";

const host = (ip: string, o: Partial<NetHost> = {}): NetHost => ({ ip, name: "", ports: [], hints: [], apps: [], ...o });
const tool = (o: Partial<Unlinked>): Unlinked => ({ source: "mynetwork", label: "MynetworK", instance: "", ...o });

describe("devices not followed", () => {
  it("one row per device, with everyone who saw it", () => {
    const rows = mergeDevices([host("10.0.0.1", { name: "nas", ssh_port: 22 })], [tool({ ip: "10.0.0.1", online: true }), tool({ ip: "10.0.0.2", name: "plug", online: true })], [], []);
    expect(rows.map((d) => [d.ip, d.seen.length, d.group])).toEqual([["10.0.0.1", 2, "look"], ["10.0.0.2", 1, "plain"]]);
  });
  it("a device with only a web page is worth a look, one with nothing open is not", () => {
    const rows = mergeDevices([host("10.0.0.1", { hints: ["web :80"] }), host("10.0.0.2")], [], [], []);
    expect(rows.map((d) => d.group)).toEqual(["look", "plain"]);
  });
  it("a tool's state wins over the last search, and fills a missing name", () => {
    const [d] = mergeDevices([host("10.0.0.1")], [tool({ ip: "10.0.0.1", name: "old", online: false })], [], []);
    expect([d.name, d.group]).toEqual(["old", "off"]);
  });
  it("leaves out the machines followed, keeps a device without address", () => {
    const rows = mergeDevices([host("10.0.0.1")], [tool({ ip: "10.0.0.1" }), tool({ source: "proxmox", label: "Proxmox VE", name: "vm", vmid: 101, node: "pve", online: false })], ["10.0.0.1"], []);
    expect(rows.map((d) => [d.ip, d.detail, d.group])).toEqual([[undefined, "VM 101 · pve", "off"]]);
  });
  it("a hidden device stays listed as hidden, seen or not by the last search", () => {
    const rows = mergeDevices([host("10.0.0.1", { ssh_port: 22 })], [], [], [{ ip: "10.0.0.1", name: "" }, { ip: "10.0.0.9", name: "gone" }]);
    expect(rows.map((d) => [d.ip, d.group])).toEqual([["10.0.0.1", "hidden"], ["10.0.0.9", "hidden"]]);
  });
});
