// Counters of the home page's right column that are worked out from what the snapshot already holds: the network equipment, the
// connectors and agents, the virtual machines, and what needs an update.
import type { Snapshot } from "../api";
import { advice, cloudflareZones } from "./cloudflare";

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

/** Machines with packages to update, machines asking for a restart */
export function upkeepCounts(snap: Snapshot): { updates: number; reboot: number } {
  const hosts = snap.health?.hosts ?? [];
  return { updates: hosts.filter((h) => (h.apt?.upgradable ?? 0) > 0).length, reboot: hosts.filter((h) => h.reboot_required).length };
}

/** The Cloudflare domains: those that serve, those with something to improve (each counted once), threats and visitors over the period read */
export function cloudflareCounts(snap: Snapshot): { domains: number; active: number; toImprove: number; threats: number; visitors: number; records: number } {
  const zones = cloudflareZones(snap);
  return {
    domains: zones.length, active: zones.filter((z) => z.status === "active" && !z.paused).length,
    toImprove: new Set(advice(zones).filter((a) => a.tone === "warn").flatMap((a) => a.who)).size,
    threats: zones.reduce((n, z) => n + (z.traffic?.threats ?? 0), 0), visitors: zones.reduce((n, z) => n + (z.traffic?.visitors ?? 0), 0),
    records: zones.reduce((n, z) => n + (z.dns?.total ?? 0), 0),
  };
}

/** Wazuh on the statistics page: only when a Wazuh connector is set and answers (never an empty frame). Its agents, and with its indexer
 *  the serious alerts of the last 24 h and the critical vulnerabilities; without the indexer, the agents never connected instead */
export function wazuhCounts(snap: Snapshot): { active: number; total: number; disconnected: number; never: number; serious: number | null; critical: number | null } | null {
  const w = (snap.data.services_status ?? []).find((s) => s.connector === "wazuh" && s.ok && !s.stale && s.agents);
  if (!w?.agents) return null;
  const vulns = Object.values(w.machines ?? {}).map((m) => m.vulns).filter((v) => !!v);
  return { active: w.agents.active, total: w.agents.total, disconnected: w.agents.disconnected, never: w.agents.never,
           serious: w.alerts ? w.alerts.serious : null, critical: vulns.length ? vulns.reduce((n, v) => n + v!.critical, 0) : null };
}
