import { describe, expect, it } from "vitest";
import type { Host, Machine, VirtualizationConnector } from "../types";
import { guestsOf, portRows } from "./machinePage";

const m: Machine = { ip: "10.0.0.20", name: "tower", ping: true, off: false, services: 3, npm: 1, down: 0 };
const host = (h: Partial<Host>): Host => ({ id: 1, type: "local", enabled: true, domains: [], ...h });

describe("ports of a machine", () => {
  it("scan ports and service ports merged, sorted, each with its service and the domains that expose it", () => {
    const hosts = [
      host({ id: 1, type: "local", host_ip: "10.0.0.20", port: 8096, name: "jellyfin", service: { kind: "docker", name: "jellyfin" } }),
      host({ id: 2, type: "proxy", target_ip: "10.0.0.20", port: 8096, domains: ["tv.lan"] }),
      host({ id: 3, type: "proxy", target_ip: "10.0.0.20", port: 8096, domains: ["old.lan"], paused: "yes" }),
      host({ id: 4, type: "local", host_ip: "10.0.0.99", port: 80, name: "elsewhere" }),
    ];
    const rows = portRows(m, hosts, { scan: { ports: [22, 8096, 9000] } });
    expect(rows.map((r) => r.port)).toEqual([22, 8096, 9000]);
    expect(rows[1]).toEqual({ port: 8096, name: "jellyfin", domains: ["tv.lan"], listening: true });
    expect(rows[0].name).toBeNull();
    expect(rows[2].domains).toEqual([]);
  });
  it("without a scan: the service ports only, not marked as listening", () => {
    const rows = portRows(m, [host({ host_ip: "10.0.0.20", port: 445, name: "smb" })]);
    expect(rows).toEqual([{ port: 445, name: "smb", domains: [], listening: false }]);
  });
});

describe("guests of a host", () => {
  const pve: VirtualizationConnector = {
    connector: "proxmox", name: "pve", label: "Proxmox", ok: true, ip: "10.0.0.20",
    nodes: [{ name: "tower", online: true }, { name: "other", online: true }],
    guests: [
      { vmid: 100, name: "jarvis", type: "qemu", node: "tower", status: "running", template: false },
      { vmid: 104, name: "win", type: "qemu", node: "tower", status: "stopped", template: false },
      { vmid: 900, name: "tpl", type: "qemu", node: "tower", status: "stopped", template: true },
      { vmid: 200, name: "far", type: "lxc", node: "other", status: "running", template: false },
    ],
  } as VirtualizationConnector;
  it("by address or node name, templates and other nodes left out, running first, linked machine found", () => {
    const linked: Machine = { ...m, ip: "10.0.0.21", name: "jarvis", links: { guest: { vmid: 100, node: "tower", instance: "pve" } } as Machine["links"] };
    const rows = guestsOf(m, [pve], [linked]);
    expect(rows.map((r) => r.guest.vmid)).toEqual([100, 104]);
    expect(rows[0].machineIp).toBe("10.0.0.21");
    expect(rows[1].machineIp).toBeUndefined();
  });
  it("a machine that is no hypervisor: nothing", () => {
    expect(guestsOf({ ...m, ip: "10.0.0.5", name: "nas" }, [pve])).toEqual([]);
  });
});
