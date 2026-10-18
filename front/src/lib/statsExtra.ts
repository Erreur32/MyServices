// Counters of the home page's right column that are worked out from what the snapshot already holds: the network equipment, the
// connectors and agents, the virtual machines, and what needs an update or a new certificate.
import type { Snapshot } from "../api";
import { certIssue } from "./status";

/** UniFi equipment as MynetworK relays it: "1" is connected */
export function networkCounts(snap: Snapshot): { devices: number; online: number } {
  const list = (snap.data.network ?? []).flatMap((c) => c.unifi?.devices ?? []);
  return { devices: list.length, online: list.filter((d) => String(d.state) === "1").length };
}

/** Connectors that answer or not, and the machines read by a Windows agent */
export function connectorCounts(snap: Snapshot): { ok: number; failing: number; agents: number } {
  const list = snap.data.connectors ?? [];
  return { ok: list.filter((c) => c.ok).length, failing: list.filter((c) => !c.ok).length, agents: snap.data.machine_list.filter((m) => !m.disabled && m.agent).length };
}

/** Virtual machines and containers of the hypervisors: running, stopped, nodes down, and the "problems" some tools report (templates left out) */
export function virtualCounts(snap: Snapshot): { guests: number; running: number; stopped: number; nodesDown: number; problems: number } {
  const list = snap.data.virtualization ?? [];
  const guests = list.flatMap((c) => c.guests ?? []).filter((g) => !g.template);
  const running = guests.filter((g) => g.status === "running").length;
  return {
    guests: guests.length, running, stopped: guests.length - running,
    nodesDown: list.flatMap((c) => c.nodes ?? []).filter((n) => !n.online).length,
    problems: list.reduce((n, c) => n + (c.problems?.length ?? 0), 0),
  };
}

/** Machines with packages to update, machines asking for a restart, certificates to renew soon and invalid ones */
export function upkeepCounts(snap: Snapshot): { updates: number; reboot: number; certSoon: number; certBad: number } {
  const hosts = snap.health?.hosts ?? [];
  const certs = snap.data.hosts.filter((r) => r.enabled && !r.paused).map(certIssue).filter(Boolean);
  return {
    updates: hosts.filter((h) => (h.apt?.upgradable ?? 0) > 0).length,
    reboot: hosts.filter((h) => h.reboot_required).length,
    certSoon: certs.filter((c) => !c.includes("invalide")).length,
    certBad: certs.filter((c) => c.includes("invalide")).length,
  };
}
