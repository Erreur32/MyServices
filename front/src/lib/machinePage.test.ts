import { describe, expect, it } from "vitest";
import type { Host, Machine, VirtualizationConnector } from "../types";
import { guestsOf, isSystemPort, portRows, type PortRow } from "./machinePage";

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
    expect(rows[1]).toMatchObject({ port: 8096, name: "jellyfin", domains: ["tv.lan"], listening: true, guess: null });
    expect(rows[1].host?.id).toBe(1);
    expect(rows[0]).toMatchObject({ name: null, host: null, guess: "SSH" });   // unknown: what usually listens there
    expect(rows[2].guess).toBe("Portainer");
    expect(rows[2].domains).toEqual([]);
  });
  it("without a scan: the service ports only, not marked as listening", () => {
    const rows = portRows(m, [host({ host_ip: "10.0.0.20", port: 445, name: "smb" })]);
    expect(rows).toMatchObject([{ port: 445, name: "smb", domains: [], listening: false, guess: null, seen: [] }]);
  });
  it("adds what MynetworK and Wazuh saw: who saw it, the program, listening on the machine only", () => {
    const rows = portRows(m, [], { scan: { ports: [22] } }, {
      mynetwork: [22, 80],
      wazuh: [{ port: 22, process: "sshd" }, { port: 6379, process: "redis-server", local: true }, { port: 53, local: true }, { port: 53, process: "dnsmasq" }],
    });
    expect(rows.map((r) => [r.port, r.seen, r.process, r.local])).toEqual([
      [22, ["scan", "mynetwork", "wazuh"], "sshd", false],
      [53, ["wazuh"], "dnsmasq", false],          // on 127.0.0.1 and on the network: not local
      [80, ["mynetwork"], null, false],
      [6379, ["wazuh"], "redis-server", true],
    ]);
    expect(rows.every((r) => r.listening)).toBe(true);
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

describe("ports système", () => {
  const row = (r: Partial<PortRow>) => ({ name: null, domains: [], process: null, host: null, ...r }) as PortRow;
  const docker = { service: { kind: "docker" } } as PortRow["host"];

  it("un programme de la machine en est un, pas un port inconnu ni un conteneur ni un site", () => {
    expect(isSystemPort(row({ process: "master" }))).toBe(true);
    expect(isSystemPort(row({ name: "Samba", host: { service: { kind: "process" } } as PortRow["host"] }))).toBe(true);
    expect(isSystemPort(row({}))).toBe(false);
    expect(isSystemPort(row({ name: "Opengist", host: docker }))).toBe(false);
    expect(isSystemPort(row({ name: "Apache", domains: ["a.lan"] }))).toBe(false);
  });
});
