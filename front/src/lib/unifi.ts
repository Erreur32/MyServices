// A machine as UniFi sees it, through MynetworK: its device (by IP, or the gateway for the machine set as gateway, whose UniFi
// address is often the WAN one), and a health reading built from it (state, CPU, memory) for the machines read no other way.
import type { HealthHost, Machine, NetworkConnector, UnifiDevice, UnifiSystem } from "../types";

const GATEWAY_TYPES = new Set(["udm", "ugw", "uxg"]);
const num = (v: unknown): number | undefined => (v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

export function unifiDevices(network: NetworkConnector[] = []): UnifiDevice[] {
  return network.flatMap((c) => c.unifi?.devices ?? []);
}

/** The UniFi system summary, when MynetworK gives it (0.10.68+) */
export function unifiSystem(network: NetworkConnector[] = []): UnifiSystem | undefined {
  return network.map((c) => c.unifi?.system).find((s) => !!s) ?? undefined;
}

/** The gateway device enriched by the system summary (its firmware update, temperature, memory size) */
export function withSystem(d: UnifiDevice, sys?: UnifiSystem): UnifiDevice {
  const gw = sys?.gateway;
  if (!gw || !GATEWAY_TYPES.has(d.type ?? "")) return d;
  return { ...d, upgradable: gw.upgradable ?? d.upgradable, upgrade_to_firmware: gw.upgrade_to_firmware ?? d.upgrade_to_firmware,
    cpu_pct: gw.cpu_pct ?? d.cpu_pct, mem_pct: gw.mem_pct ?? d.mem_pct, temperature: gw.temperature, mem_total: gw.mem_total, mem_used: gw.mem_used,
    network_update: !!sys?.update_available };
}

/** The UniFi device of a machine: same IP, the gateway whose LAN address it is (system summary), or the only gateway for the
 *  machine set (or detected) as gateway */
export function unifiDeviceOf(m: Machine, devices: UnifiDevice[], sys?: UnifiSystem): UnifiDevice | undefined {
  const byIp = devices.find((d) => d.ip === m.ip);
  if (byIp) return byIp;
  const gateways = devices.filter((d) => GATEWAY_TYPES.has(d.type ?? ""));
  if (sys?.gateway?.lan_ip) return sys.gateway.lan_ip === m.ip && gateways.length === 1 ? gateways[0] : undefined;
  return (m.gateway || m.detected?.includes("gateway")) && gateways.length === 1 ? gateways[0] : undefined;
}

/** The updates a UniFi device waits for, as a health « updates » list: its firmware, and the UniFi Network application on a gateway */
function updatesOf(d: UnifiDevice): Pick<HealthHost, "apt"> | Record<string, never> {
  const list = [d.upgradable && (d.upgrade_to_firmware ? `firmware → ${d.upgrade_to_firmware}` : "firmware"), d.network_update && "UniFi Network"].filter((x): x is string => !!x);
  return list.length ? { apt: { upgradable: list.length, sample: list } } : {};
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
    res: { available: cpu != null || mem != null, cpu_pct: cpu, mem_pct: mem,
      ...(d.mem_total ? { mem_total_mb: d.mem_total / 1048576, mem_used_mb: (d.mem_used ?? 0) / 1048576 } : {}) },
    ...(d.temperature != null ? { temp: { available: true, celsius: d.temperature, source: "UniFi" } } : {}),
    ...updatesOf(d),
  } as HealthHost;
}
