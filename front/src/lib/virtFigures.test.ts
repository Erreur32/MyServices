import { describe, expect, it } from "vitest";
import type { BackupSet, VirtualizationConnector } from "../types";
import { virtFigures } from "./virtFigures";

const virt = [{ connector: "proxmox", name: "pve", nodes: [{ name: "a", online: true, cpu_pct: 20, mem_pct: 60 }, { name: "b", online: true, cpu_pct: 40, mem_pct: 80 }, { name: "c", online: false, cpu_pct: 99, mem_pct: 99 }],
  guests: [{ status: "running", template: false }, { status: "stopped", template: false }, { status: "running", template: true }],
  storage: [{ name: "local", node: "a", used_pct: 40 }, { name: "ssd", node: "b", used_pct: 81.4 }] }] as unknown as VirtualizationConnector[];
const set = (level: string, vzdump: string | undefined, archived = false) => ({ level, archived, locations: [{ vzdump }] }) as unknown as BackupSet;

describe("virtFigures", () => {
  it("counts like the server: hosts online, machines running (templates out), means of the hosts online, fullest volume, vzdump sets up to date", () => {
    expect(virtFigures(virt, [set("ok", "qemu/1"), set("warn", "lxc/2"), set("ok", "qemu/3", true), set("ok", undefined)]))
      .toEqual({ hosts: 3, hostsUp: 2, guests: 2, running: 1, cpu: 30, mem: 70, storage: 81, storageName: "ssd · b", backups: 2, backupsOk: 1 });
  });
  it("leaves what is not read as null", () => {
    expect(virtFigures([])).toMatchObject({ hosts: 0, cpu: null, storage: null, backups: 0 });
  });
});
