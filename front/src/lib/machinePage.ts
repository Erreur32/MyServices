// The machine page: the open ports of a machine matched to its known services and to the NPM entries that expose them, and the guests
// (VMs, containers) of a machine that is a hypervisor host. Pure functions over the snapshot, tested apart.
import type { AddressSheet, Host, Machine, VirtualizationConnector } from "../types";

export interface PortRow {
  port: number;
  name: string | null;        // service known on this port (its name, app label or image), null = unknown
  domains: string[];          // NPM domains pointing to this port (exposed through the proxy)
  listening: boolean;         // seen open by the last scan
}

const hostIp = (r: Host) => r.host_ip || r.ip || r.target_ip || "";
const serviceName = (r: Host) => r.app?.label || r.service?.name || r.name || r.service?.image || null;

/** The ports of a machine: those seen open by the scan and those of its known services, each with its service and the domains that expose it */
export function portRows(m: Machine, hosts: Host[], sheet?: AddressSheet): PortRow[] {
  const mine = hosts.filter((r) => hostIp(r) === m.ip);
  const scanned = new Set(sheet?.scan?.ports ?? []);
  const ports = new Set<number>([...scanned, ...mine.map((r) => r.port).filter((p): p is number => typeof p === "number")]);
  return [...ports].sort((a, b) => a - b).map((port) => {
    const onPort = mine.filter((r) => r.port === port);
    const local = onPort.find((r) => r.type === "local") ?? onPort.find((r) => r.type !== "proxy");
    const domains = onPort.filter((r) => r.type === "proxy" && r.enabled && !r.paused).flatMap((r) => r.domains);
    const named = local ?? onPort[0];   // the service on this machine, else the first thing seen on the port
    return { port, name: named ? serviceName(named) : null, domains: [...new Set(domains)], listening: scanned.has(port) };
  });
}

export type Guest = NonNullable<VirtualizationConnector["guests"]>[number];
export interface GuestRow { guest: Guest; connector: string; machineIp?: string }

/** The guests running on a machine: the virtualization connectors read on it (its address) or whose node carries its name; templates left out */
export function guestsOf(m: Machine, connectors: VirtualizationConnector[] = [], machines: Machine[] = []): GuestRow[] {
  const name = m.name.toLowerCase();
  const out: GuestRow[] = [];
  for (const c of connectors) {
    const byIp = c.ip === m.ip, nodes = c.nodes ?? [];
    const node = nodes.find((n) => n.name.toLowerCase() === name);
    if (!byIp && !node) continue;
    for (const g of c.guests ?? []) {
      if (g.template) continue;
      if (nodes.length > 1 && g.node && g.node.toLowerCase() !== (node?.name ?? m.name).toLowerCase()) continue;   // a cluster: only this node's guests
      const linked = machines.find((x) => x.links?.guest?.vmid === g.vmid && x.links.guest.node === g.node && x.links.guest.instance === c.name);
      out.push({ guest: g, connector: c.name, machineIp: linked?.ip });
    }
  }
  return out.sort((a, b) => Number(b.guest.status === "running") - Number(a.guest.status === "running") || String(a.guest.name ?? a.guest.vmid).localeCompare(String(b.guest.name ?? b.guest.vmid)));
}
