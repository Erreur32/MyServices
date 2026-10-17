import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { freeboxHealth, freeboxOf, vmShare } from "./freebox";

const m = (name: string): Machine => ({ ip: "10.0.0.254", name, ping: true, off: false, services: 0, npm: 0, down: 0 });
const fb = { connection: { state: "up", media: "ftth" }, system: { model: "Freebox v9", firmware: "4.13.1", latest_firmware: "4.14.0", update_available: true, sensors: [{ name: "CPU", value: 60 }] } };

describe("freebox", () => {
  it("is matched by name, never the Player", () => {
    const net = [{ connector: "mynetwork", name: "m", label: "MynetworK", ok: true, freebox: fb }] as never;
    expect(freeboxOf(m("Freebox"), net)).toBe(fb);
    expect(freeboxOf(m("Freebox Player POP"), net)).toBeUndefined();
    expect(freeboxOf(m("Box"), net)).toBeUndefined();
  });
  it("is matched by its LAN address when MynetworK gives it, whatever the machine is called", () => {
    const withIp = { ...fb, system: { ...fb.system, lan_ip: "10.0.0.254" } };
    const net = [{ connector: "mynetwork", name: "m", label: "MynetworK", ok: true, freebox: withIp }] as never;
    expect(freeboxOf(m("Box du salon"), net)).toBe(withIp);
    expect(freeboxOf({ ...m("Box du salon"), ip: "10.0.0.9" }, net)).toBeUndefined();
  });
  it("reads its storage as a disk, and a fibre without light as critical", () => {
    const withDisk = { ...fb, storage: { disks: [], partitions: [{ label: "NVME 32", fstype: "ext4", total_bytes: 1e12, used_bytes: 5.5e11, free_bytes: 4.5e11, used_pct: 55 }] } };
    expect(freeboxHealth(m("Freebox"), withDisk)).toMatchObject({ level: "ok", disks: [{ mount: "NVME 32", used_pct: 55, warning: false, critical: false }] });
    expect(freeboxHealth(m("Freebox"), { ...withDisk, storage: { disks: [], partitions: [{ ...withDisk.storage.partitions[0], used_pct: 92 }] } }).level).toBe("crit");
    expect(freeboxHealth(m("Freebox"), { ...fb, ftth: { sfp_present: true, sfp_has_signal: false, link: false, sfp_pwr_rx: null, sfp_pwr_tx: null } }).level).toBe("crit");
  });
  it("shows the processor temperature, not the hottest sensor, but the health still follows the hottest", () => {
    const sensors = [{ id: "temp_cpu0", name: "CPU 0", value: 58 }, { id: "temp_cpu1", name: "CPU 1", value: 60 }, { id: "temp_hdd", name: "Disque", value: 90 }];
    const h = freeboxHealth(m("Freebox"), { ...fb, system: { ...fb.system, sensors } });
    expect(h.temp?.celsius).toBe(60);
    expect(h.level).toBe("warn");
  });
  it("uses the percentage MynetworK sends for the memory given to the VMs, else computes it", () => {
    expect(vmShare(50, 0, 2048)).toBe(50);
    expect(vmShare(undefined, 512, 2048)).toBe(25);
    expect(vmShare(null, 0, 0)).toBe(0);
    const withVm = { ...fb, vm_system: { total_memory_mb: 2048, used_memory_mb: 1024, total_cpus: 2, used_cpus: 1 } };
    expect(freeboxHealth(m("Freebox"), withVm).vmem).toEqual({ used_mb: 1024, total_mb: 2048, pct: 50 });
  });
  it("reports its virtual machines: how many run out of how many", () => {
    const withVms = { ...fb, vms: [{ id: 0, name: "a", status: "running", vcpus: 2, memory_mb: 1024, os: null }, { id: 1, name: "b", status: "stopped", vcpus: 1, memory_mb: 512, os: null }] };
    expect(freeboxHealth(m("Freebox"), withVms).vms).toEqual({ running: 1, total: 2 });
    expect(freeboxHealth(m("Freebox"), fb).vms).toBeUndefined();
  });
  it("reads OK, busy when hot, down when the line is down, and its firmware update", () => {
    expect(freeboxHealth(m("Freebox"), fb)).toMatchObject({ level: "ok", temp: { celsius: 60 }, apt: { upgradable: 1, sample: ["firmware → 4.14.0"] } });
    expect(freeboxHealth(m("Freebox"), { ...fb, system: { ...fb.system, sensors: [{ name: "Disque", value: 90 }] } }).level).toBe("warn");
    expect(freeboxHealth(m("Freebox"), { ...fb, connection: { state: "down" } }).level).toBe("crit");
  });
});
