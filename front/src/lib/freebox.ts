// The Freebox as a machine: MynetworK gives no address for it, so it is matched to the followed machine whose name says « Freebox »
// (not the « Freebox Player », a separate device). Its line and temperatures make a health reading, its model and firmware the system.
import type { FreeboxInfo, HealthHost, Machine, NetworkConnector } from "../types";

export function freeboxOf(m: Machine, network: NetworkConnector[] = []): FreeboxInfo | undefined {
  const boxes = network.map((c) => c.freebox).filter((f): f is FreeboxInfo => !!f?.system);
  const byAddress = boxes.find((f) => f.system?.lan_ip === m.ip);   // MynetworK 0.10.69+ gives the box's LAN address: the sure match
  if (byAddress) return byAddress;
  if (!/freebox/i.test(m.name) || /player/i.test(m.name)) return undefined;
  return boxes[0];
}

/** Share given to the virtual machines (0 to 100): MynetworK's own percentage when it sends one, else computed from the used and total amounts */
export function vmShare(pct: number | null | undefined, used: number | null | undefined, total: number | null | undefined): number {
  if (typeof pct === "number") return pct;
  return total ? (100 * (used ?? 0)) / total : 0;
}

/** Health: down when the line is not up or the fibre has no light, busy from 85 °C (the Freebox card's own threshold) or a partition at 80 %, its firmware update as « updates » */
export function freeboxHealth(m: Machine, fb: FreeboxInfo): HealthHost {
  const sensors = (fb.system?.sensors ?? []).filter((x) => typeof x.value === "number");
  const temps = sensors.map((x) => x.value), cpus = sensors.filter((x) => /cpu/i.test(`${x.id ?? ""} ${x.name ?? ""}`)).map((x) => x.value);
  const fans = (fb.system?.fans ?? []).filter((x) => typeof x.value === "number").map((x) => ({ name: x.name ?? x.id ?? "", rpm: x.value }));
  const hot = temps.length ? Math.max(...temps) : undefined, cpuHot = cpus.length ? Math.max(...cpus) : hot, up = fb.connection?.state === "up";   // hot: any sensor (health), cpuHot: the processor only (the CPU column)
  const parts = (fb.storage?.partitions ?? []).filter((p) => p.used_pct != null);
  const full = Math.max(0, ...parts.map((p) => p.used_pct as number)), noLight = fb.ftth?.sfp_has_signal === false || fb.ftth?.link === false;
  let level = "ok";
  if (!up || noLight || full >= 90) level = "crit";
  else if ((hot ?? 0) >= 85 || full >= 80) level = "warn";
  const latest = fb.system?.latest_firmware;
  return {
    id: `freebox:${m.ip}`, name: `${m.name} · ${m.ip}`, level, reachable: true, sources: ["mynetwork"], res: { available: false },
    ...(parts.length ? { disks: parts.map((p) => ({ mount: p.label ?? "disque", used_pct: p.used_pct as number, ...(p.total_bytes ? { size_gb: p.total_bytes / 1e9 } : {}),
      ...(p.free_bytes != null ? { avail_gb: p.free_bytes / 1e9 } : {}), warning: (p.used_pct as number) >= 80, critical: (p.used_pct as number) >= 90 })) } : {}),
    ...(fb.vms?.length ? { vms: { running: fb.vms.filter((v) => v.status === "running").length, total: fb.vms.length } } : {}),
    ...(fb.vm_system?.total_memory_mb ? { vmem: { used_mb: fb.vm_system.used_memory_mb ?? 0, total_mb: fb.vm_system.total_memory_mb, pct: vmShare(fb.vm_system.memory_pct, fb.vm_system.used_memory_mb, fb.vm_system.total_memory_mb) } } : {}),
    ...(cpuHot != null ? { temp: { available: true, celsius: cpuHot, source: "Freebox", sensors: sensors.map((x) => ({ name: x.name ?? x.id ?? "", celsius: x.value })) } } : {}),
    ...(fans.length ? { fans } : {}),
    ...(fb.system?.update_available ? { apt: { upgradable: 1, sample: [latest ? `firmware → ${latest}` : "firmware"], firmware: true } } : {}),
  } as HealthHost;
}
