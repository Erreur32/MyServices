// The Freebox as a machine: MynetworK gives no address for it, so it is matched to the followed machine whose name says « Freebox »
// (not the « Freebox Player », a separate device). Its line and temperatures make a health reading, its model and firmware the system.
import type { FreeboxInfo, HealthHost, Machine, NetworkConnector } from "../types";

export function freeboxOf(m: Machine, network: NetworkConnector[] = []): FreeboxInfo | undefined {
  if (!/freebox/i.test(m.name) || /player/i.test(m.name)) return undefined;
  return network.map((c) => c.freebox).find((f) => !!f?.system) ?? undefined;
}

/** Health: down when the line is not up, busy from 85 °C (the Freebox card's own threshold), its firmware update as « updates » */
export function freeboxHealth(m: Machine, fb: FreeboxInfo): HealthHost {
  const temps = (fb.system?.sensors ?? []).map((x) => x.value).filter((v) => typeof v === "number");
  const hot = temps.length ? Math.max(...temps) : undefined, up = fb.connection?.state === "up";
  let level = "ok";
  if (!up) level = "crit";
  else if ((hot ?? 0) >= 85) level = "warn";
  const latest = fb.system?.latest_firmware;
  return {
    id: `freebox:${m.ip}`, name: `${m.name} · ${m.ip}`, level, reachable: true, sources: ["mynetwork"], res: { available: false },
    ...(hot != null ? { temp: { available: true, celsius: hot, source: "Freebox" } } : {}),
    ...(fb.system?.update_available ? { apt: { upgradable: 1, sample: [latest ? `firmware → ${latest}` : "firmware"] } } : {}),
  } as HealthHost;
}
