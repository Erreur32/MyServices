// Machines › Untracked devices: one row per device, whoever saw it (the network search, MynetworK, Proxmox…)
import type { Snapshot } from "../api";
import type { NetHost, Unlinked } from "../types";
import { tx } from "./i18n";
import { tagsOf } from "./netScan";

export type DeviceGroup = "look" | "plain" | "off" | "hidden";

export interface Device {
  key: string;
  ip?: string;
  name: string;
  online: boolean;
  host: NetHost;      // what the search found; empty for a device only a tool knows
  seen: string[];
  detail?: string;    // « VM 101 · pve »
  group: DeviceGroup;
}

/** The matching layer's list (all tools), or MynetworK's inventory alone for an older data.json */
export function unlinkedOf(snap: Snapshot): Unlinked[] {
  if (snap.data.unlinked) return snap.data.unlinked;
  const followed = new Set(snap.data.machine_list.map((m) => m.ip));
  return (snap.data.network ?? []).flatMap((c) => c.devices ?? []).filter((d) => !followed.has(d.ip))
    .map((d) => ({ source: "mynetwork", label: "MynetworK", instance: "", ip: d.ip, mac: d.mac ?? undefined, name: d.hostname || d.vendor || undefined, online: d.status === "online" }));
}

const emptyHost = (ip: string, name: string): NetHost => ({ ip, name, ports: [], hints: [], apps: [] });

function guestOf(u: Unlinked): string | undefined {
  if (u.vmid == null) return undefined;
  const guest = `${u.type === "lxc" ? "LXC" : "VM"} ${u.vmid}`;
  return u.node ? `${guest} · ${u.node}` : guest;
}

function groupOf(d: Device, hidden: Set<string>): DeviceGroup {
  if (d.ip && hidden.has(d.ip)) return "hidden";
  if (!d.online) return "off";
  return d.host.ssh_port || tagsOf(d.host).length > 0 ? "look" : "plain";
}

/** Every device not followed, each once: `known` are the machines followed, `hidden` the ones the admin put aside */
export function mergeDevices(found: NetHost[], unlinked: Unlinked[], known: string[], hidden: { ip: string; name: string }[]): Device[] {
  const rows = new Map<string, Device>();
  const add = (d: Omit<Device, "group">) => rows.set(d.key, { ...d, group: "plain" });
  for (const h of found) if (!known.includes(h.ip)) add({ key: h.ip, ip: h.ip, name: h.name, online: true, host: h, seen: [tx("Recherche")] });
  unlinked.forEach((u, n) => {
    if (u.ip && known.includes(u.ip)) return;
    const row = u.ip ? rows.get(u.ip) : undefined;
    if (row) {
      row.seen.push(u.label);
      row.online = u.online ?? row.online;   // a tool's state is fresher than the last search
      row.name ||= u.name ?? "";
    } else {
      add({ key: u.ip ?? `${u.source}-${n}`, ip: u.ip, name: u.name ?? "", online: u.online !== false, host: emptyHost(u.ip ?? "", u.name ?? ""), seen: [u.label], detail: guestOf(u) });
    }
  });
  for (const e of hidden) if (!rows.has(e.ip) && !known.includes(e.ip)) add({ key: e.ip, ip: e.ip, name: e.name, online: false, host: emptyHost(e.ip, e.name), seen: [] });
  const ips = new Set(hidden.map((e) => e.ip));
  return [...rows.values()].map((d) => ({ ...d, group: groupOf(d, ips) }));
}
