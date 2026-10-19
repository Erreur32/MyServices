// The page of one machine (#machines/<ip>, #machines/<ip>/access): what the address names, and the redirects of the old settings links.
import type { Item } from "../tabs/Availability";

export interface MachineTarget { ip: string; tab?: "access" }

const IP = /^\d{1,3}(\.\d{1,3}){3}$/;

/** `#machines/<ip>[/access]` -> the machine and the part to open; null for the list (`#machines`) or another tab */
export function machineFromHash(hash: string): MachineTarget | null {
  const [tab, ip, part] = hash.replace(/^#/, "").split("/");
  if (tab !== "machines" || !ip || !IP.test(ip)) return null;
  return part === "access" ? { ip, tab: "access" } : { ip };
}

/** Old settings links of one machine: `#settings/machines/<ip>` -> `machines/<ip>`, `#settings/agents/<ip>` -> `machines/<ip>/access`; else null */
export function machineSettingsRedirect(hash: string): string | null {
  const [tab, section, ip] = hash.replace(/^#/, "").split("/");
  if (tab !== "settings" || !ip || !IP.test(ip)) return null;
  if (section === "machines") return `machines/${ip}`;
  if (section === "agents") return `machines/${ip}/access`;
  return null;
}

/** The availability line of a machine in the report (its ping), found by its address, else by its name */
export function availabilityOf(items: Item[], m: { ip: string; name: string }): Item | undefined {
  const machines = items.filter((it) => it.kind === "machine");
  return machines.find((it) => it.target === m.ip) ?? machines.find((it) => it.machine === m.name || it.label === m.name);
}
