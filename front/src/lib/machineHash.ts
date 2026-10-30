// The pages of one machine (#machines/<ip> its information, #machines/<ip>/settings its settings, /access on the Access tab): what the address names, and the redirects of the old settings links.
import type { Item } from "../tabs/Availability";

export interface MachineTarget { ip: string; tab?: "settings" | "access"; watch?: string }   // watch: the notice whose frame the page opens on

const IP = /^\d{1,3}(\.\d{1,3}){3}$/;

/** `#machines/<ip>[/settings|/access|/watch/<notice>]` -> the machine and the page to open; null for the list (`#machines`) or another tab */
export function machineFromHash(hash: string): MachineTarget | null {
  const [tab, ip, part, notice] = hash.replace(/^#/, "").split("/");
  if (tab !== "machines" || !ip || !IP.test(ip)) return null;
  if (part === "watch" && /^[a-z0-9_]+$/.test(notice ?? "")) return { ip, watch: notice };   // the notice ends up in a CSS selector
  return part === "access" || part === "settings" ? { ip, tab: part } : { ip };
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
