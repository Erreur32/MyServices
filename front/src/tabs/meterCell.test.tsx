import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HealthHost, Machine } from "../types";
import { freeboxHealth } from "../lib/freebox";
import { MeterCell } from "./Machines";

const m = { ip: "10.0.0.254", name: "Freebox", ping: true, off: false, services: 0, npm: 0, down: 0 } as Machine;
const box = freeboxHealth(m, {
  connection: { state: "up" },
  system: { sensors: [{ id: "temp_cpu0", name: "CPU 0", value: 58 }, { id: "temp_cpu1", name: "CPU 1", value: 60 }, { id: "temp_hdd", name: "Disque", value: 62 }] },
  storage: { disks: [], partitions: [{ label: "NVME", fstype: "ext4", total_bytes: 1e12, used_bytes: 5.5e11, free_bytes: 4.5e11, used_pct: 55 }] },
  vm_system: { total_memory_mb: 2048, used_memory_mb: 1024, total_cpus: 2, used_cpus: 1, memory_pct: 50 },
});

describe("colonnes CPU, Mémoire et Disque du tableau pour la Freebox", () => {
  it("CPU : la température du processeur (pas celle du disque), en °C", () => {
    const html = renderToStaticMarkup(<MeterCell h={box} what="cpu" />);
    expect(html).toContain("60");
    expect(html).toContain("°C");
  });
  it("Mémoire : la part donnée aux VM, repérée « VM »", () => {
    const html = renderToStaticMarkup(<MeterCell h={box} what="mem" />);
    expect(html).toContain("50");
    expect(html).toContain("VM");
  });
  it("Disque : la partition la plus remplie", () => {
    expect(renderToStaticMarkup(<MeterCell h={box} what="disk" />)).toContain("55");
  });
  it("une machine sans charge ni repli garde le tiret", () => {
    expect(renderToStaticMarkup(<MeterCell h={{ id: "x", name: "x", reachable: true, level: "ok" } as HealthHost} what="cpu" />)).toContain("-");
  });
});
