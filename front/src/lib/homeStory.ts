// Home page: the figures it is built on, the sentence that tells them, and the short list of machines shown live.
import type { Snapshot } from "../api";
import type { Machine } from "../types";
import { CONNECTOR } from "./eventOrigin";
import { tx } from "./i18n";
import { mState } from "./machines";
import { hiddenNow, isHidden } from "./servicesHidden";
import { perService } from "./servicesState";
import { connectorCounts } from "./statsExtra";
import { status } from "./status";
import { plural, type Attention } from "./summary";
import { splitHostName } from "./format";

export interface KeyCounts {
  machines: number; machinesUp: number; machinesOff: number;
  services: number; servicesUp: number;
  health: number; healthOk: number;
  backups: number; backupsOk: number;
  connectors: number; connectorsOk: number;
}

/** A machine switched off on purpose is reachable as far as alerts go: only « down » counts against the ratio */
export function keyCounts(snap: Snapshot): KeyCounts {
  const { data, health, backups } = snap;
  const ms = (data.machine_list || []).filter((m) => !m.disabled);
  const hidden = hiddenNow(), hosts = perService(data.hosts.filter((r) => r.enabled && status(r)[0] !== "off" && !isHidden(r, hidden)));
  const c = connectorCounts(snap);
  return {
    machines: ms.length, machinesUp: ms.filter((m) => mState(m) !== "down").length, machinesOff: ms.filter((m) => m.off && !m.ping).length,
    services: hosts.length, servicesUp: hosts.filter((r) => status(r)[0] === "ok").length,
    health: health?.hosts.length ?? 0, healthOk: (health?.hosts ?? []).filter((h) => h.reachable !== false && h.level === "ok").length,
    backups: backups?.summary.sets ?? 0, backupsOk: backups?.summary.ok ?? 0,
    connectors: c.ok + c.failing, connectorsOk: c.ok,
  };
}

/** One tool of « Ton installation »: every connector of that type, with one line per instance for its tooltip */
export interface InstallTool { type: string; label: string; count: number; failing: number; lines: string[] }

/** Every tool once, by name: the name the connector reads for itself, else the known one, else its type */
export function installTools(snap: Snapshot): InstallTool[] {
  const read = new Map((snap.data.services_status ?? []).map((s) => [s.connector, s.label]));
  const tools = new Map<string, InstallTool>();
  for (const c of snap.data.connectors ?? []) {
    const t = tools.get(c.type) ?? { type: c.type, label: read.get(c.type) || CONNECTOR[c.type] || c.type, count: 0, failing: 0, lines: [] };
    t.count += 1;
    if (!c.ok) t.failing += 1;
    t.lines.push(c.ok ? c.name : `${c.name} : ${c.message}`);
    tools.set(c.type, t);
  }
  return [...tools.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export type Tone = "ok" | "warn" | "bad";

/** The title and the sentence of the home page, written from the figures */
export function homeStory(snap: Snapshot, items: Attention[]): { tone: Tone; title: string; text: string } {
  const k = keyCounts(snap);
  const down = k.machines - k.machinesUp;
  const parts = [
    down ? tx("{0}/{1} machines en panne", down, k.machines) : tx("Aucune machine en panne"),
    tx("{0}/{1} services en ligne", k.servicesUp, k.services),
  ];
  if (k.backups) parts.push(tx("{0}/{1} sauvegardes à jour", k.backupsOk, k.backups));
  const text = `${parts.join(", ")}.`;
  if (!items.length) return { tone: "ok", title: tx("Tout va bien sur ton réseau."), text };
  return {
    tone: items.some((i) => i.level === "crit") ? "bad" : "warn",
    title: tx("{0} à traiter sur ton réseau.", plural(items.length, "point")),
    text,
  };
}

export interface FleetRow { machine: Machine; tone: Tone | "off"; note: string; rank: number }

/** The machines shown live, those to watch first: `shown` at most, out of `total` */
export function fleet(snap: Snapshot, shown = 6): { rows: FleetRow[]; total: number } {
  const levels = new Map((snap.health?.hosts ?? []).map((h) => [splitHostName(h.name)[1], h.reachable === false ? "crit" : h.level]));
  const row = (m: Machine): FleetRow => {
    const level = levels.get(m.ip);
    if (!m.ping && m.off) return { machine: m, tone: "off", note: tx("éteinte"), rank: 3 };
    if (!m.ping) return { machine: m, tone: "bad", note: tx("hors ligne"), rank: 0 };
    if (level === "crit" || level === "down") return { machine: m, tone: "bad", note: tx("critique"), rank: 0 };
    if (level === "warn") return { machine: m, tone: "warn", note: tx("à surveiller"), rank: 1 };
    return { machine: m, tone: "ok", note: tx("en ligne"), rank: 2 };
  };
  const rows = snap.data.machine_list.filter((m) => !m.disabled).map(row).sort((a, b) => a.rank - b.rank || a.machine.name.localeCompare(b.machine.name));
  return { rows: rows.slice(0, shown), total: rows.length };
}
