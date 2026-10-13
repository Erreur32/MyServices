// A machine as UniFi sees it, through MynetworK: its device (by IP, or the gateway for the machine set as gateway, whose UniFi
// address is often the WAN one), and a health reading built from it (state, CPU, memory) for the machines read no other way.
import type { HealthHost, Machine, NetworkConnector, UnifiDevice } from "../types";

const GATEWAY_TYPES = new Set(["udm", "ugw", "uxg"]);
const num = (v: unknown): number | undefined => (v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

export function unifiDevices(network: NetworkConnector[] = []): UnifiDevice[] {
  return network.flatMap((c) => c.unifi?.devices ?? []);
}

/** The UniFi device of a machine: same IP, or the only gateway for the machine set (or detected) as gateway */
export function unifiDeviceOf(m: Machine, devices: UnifiDevice[]): UnifiDevice | undefined {
  const byIp = devices.find((d) => d.ip === m.ip);
  if (byIp) return byIp;
  const gateways = devices.filter((d) => GATEWAY_TYPES.has(d.type ?? ""));
  return (m.gateway || m.detected?.includes("gateway")) && gateways.length === 1 ? gateways[0] : undefined;
}

/** Health from the device: OK when connected and neither CPU nor memory at 90 % or more; down when not connected */
export function unifiHealth(m: Machine, d: UnifiDevice): HealthHost {
  const cpu = num(d.cpu_pct), mem = num(d.mem_pct), on = d.state === "connected";
  const busy = (cpu ?? 0) >= 90 || (mem ?? 0) >= 90;
  let level = "ok";
  if (!on) level = "crit";
  else if (busy) level = "warn";
  return {
    id: `unifi:${m.ip}`, name: `${m.name} · ${m.ip}`, level, reachable: on, sources: ["mynetwork"],
    res: { available: cpu != null || mem != null, cpu_pct: cpu, mem_pct: mem },
    ...(d.upgradable ? { apt: { upgradable: 1, sample: [d.upgrade_to_firmware ? `firmware → ${d.upgrade_to_firmware}` : "firmware"] } } : {}),
  } as HealthHost;
}
