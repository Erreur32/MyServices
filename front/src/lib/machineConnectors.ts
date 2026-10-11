// Connecteurs qui lisent une machine (Docker, ports, AdGuard, Home Assistant, Proxmox…), pour le badge de l'onglet Machines.
import type { Connector } from "../types";

const LABEL: Record<string, string> = {
  docker: "Docker", process: "Ports", adguard: "AdGuard", npm: "NPM", "home-assistant": "Home Assistant", proxmox: "Proxmox",
  "proxmox-backup": "Proxmox Backup", beszel: "Beszel", mynetwork: "MynetworK", dockhand: "Dockhand", logviewr: "LogviewR",
  "uptime-kuma": "Uptime Kuma", dozzle: "Dozzle", veeam: "Veeam", "home-assistant-backups": "Home Assistant",
};

export interface MachineConnector { label: string; ok: boolean; title: string }

/** Connecteurs d'une machine : ceux dont l'IP visée est la sienne, MynetworK s'il la voit, et les sources de sa santé hors SSH (agent, Beszel). */
export function connectorsOf(ip: string, connectors: Connector[], seenByMynetwork: boolean, healthSources: string[] = []): MachineConnector[] {
  const out = new Map<string, MachineConnector>();
  const add = (label: string, ok: boolean, title: string) => {
    const old = out.get(label);
    out.set(label, { label, ok: (old?.ok ?? true) && ok, title: old ? `${old.title}\n${title}` : title });
  };
  for (const c of connectors) if (c.ip === ip) add(LABEL[c.type] ?? c.type, c.ok, `${c.name} : ${c.message}`);
  if (seenByMynetwork) add(LABEL.mynetwork, true, "MynetworK");
  for (const s of healthSources) if (s === "agent") add("Agent", true, "Agent MyServices"); else if (s === "beszel") add(LABEL.beszel, true, "Beszel");
  return [...out.values()];
}
