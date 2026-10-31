// Machines → Agents and SSH connections: the lists behind the two sub-pages (tabs/Agents.tsx, tabs/SshConnections.tsx), worked out from the
// agents (GET agents), the machines settings (GET machines/settings) and the SSH reads of the snapshot (Docker connectors).
import type { AgentInfo, Connector, Machine, MachineConf, SshAlias } from "../types";
import { tx } from "./i18n";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export interface AgentSummary { live: AgentInfo[]; revoked: AgentInfo[]; active: number; silent: number; pending: number; outdated: AgentInfo[] }

/** The agents in use (alphabetical, the ones needing a look first) and the revoked ones; counts for the figures on top */
export function agentSummary(agents: AgentInfo[]): AgentSummary {
  const live = agents.filter((a) => a.state !== "révoqué");
  const look = (a: AgentInfo) => Number(!(a.state === "silencieux" || !!a.host_pending || !!a.outdated));   // 0: to look at first
  return {
    live: [...live].sort((a, b) => look(a) - look(b) || byName(a, b)),
    revoked: agents.filter((a) => a.state === "révoqué").sort(byName),
    active: live.filter((a) => a.state === "actif").length,
    silent: live.filter((a) => a.state === "silencieux").length,
    pending: live.filter((a) => a.state === "en attente").length,
    outdated: live.filter((a) => a.outdated && !a.update_requested),
  };
}

export type SshState = "ok" | "refused" | "unread" | "off";
export interface SshRow { ip: string; name: string; access: string; state: SshState; message: string }

/** Whether a machine still needs its SSH: `uses` is what an agent does not read there, `agentPossible` undefined until the advice is read */
export type SshNeed = "uses" | "no_agent" | "silent" | "optional" | "offer_agent" | "cut";
export function sshNeed(off: boolean, uses: string[], agent: boolean, working: boolean, agentPossible?: boolean): SshNeed {
  if (off) return "cut";
  if (uses.length) return "uses";
  if (agent) return working ? "optional" : "silent";
  return agentPossible === false ? "no_agent" : "offer_agent";
}

/** « account@address:port » of an SSH access; the alias itself when it is not known */
export function sshTarget(alias: string, aliases: SshAlias[]): string {
  const a = aliases.find((x) => x.alias === alias);
  if (!a) return alias;
  const user = a.user ? `${a.user}@` : "", port = a.port && a.port !== 22 ? `:${a.port}` : "";
  return `${user}${a.ip || a.host}${port}`;
}

/** One row per machine with an SSH access (or SSH turned off by hand): where it connects and whether the last read went through
 *  (its system came over SSH, not from an agent), was refused (its SSH reading failed) or has not happened yet */
export function sshRows(machines: Record<string, MachineConf>, aliases: SshAlias[], list: Machine[], connectors: Connector[]): SshRow[] {
  const rows: SshRow[] = [];
  for (const [ip, m] of Object.entries(machines)) {
    if (m.disabled || (m.ssh !== false && typeof m.ssh !== "string")) continue;
    if (m.ssh === false) { rows.push({ ip, name: m.name, access: "", state: "off", message: "" }); continue; }
    const info = list.find((x) => x.ip === ip)?.info;
    const failed = connectors.find((c) => c.type === "docker" && !c.ok && (c.ip === ip || c.name === m.name));
    let state: SshState = "unread";
    if (info && info.via !== "agent") state = "ok";
    else if (failed) state = "refused";
    rows.push({ ip, name: m.name, access: sshTarget(m.ssh, aliases), state, message: state === "refused" ? failed?.message ?? "" : "" });
  }
  const rank: Record<SshState, number> = { refused: 0, unread: 1, ok: 2, off: 3 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || byName(a, b));
}

/** Health of an agent out of 100, in three parts (the same rule as the server's tile_history.agent_health): 50 answering in time, 30 script up to
 *  date, 20 machine recognized. `why` names what is missing; null for a revoked agent. */
export function agentHealth(a: AgentInfo): { score: number; why: string[] } | null {
  if (a.state === "révoqué") return null;
  if (a.state === "en attente") return { score: 0, why: [tx("pas encore de premier relevé")] };
  const why = [a.state === "actif" ? "" : tx("relevés en retard : −50"), a.outdated ? tx("script en retard : −30") : "", a.host_pending ? tx("nom de poste à confirmer : −20") : ""].filter(Boolean);
  return { score: 100 - (a.state === "actif" ? 0 : 50) - (a.outdated ? 30 : 0) - (a.host_pending ? 20 : 0), why };
}
