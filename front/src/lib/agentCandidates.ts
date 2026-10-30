import type { Advice, AgentInfo, MachineConf } from "../types";

export interface AgentCandidate { ip: string; name: string; advice: Advice; tier: "advised" | "possible" | "impossible" }

/** The followed machines that have no agent yet, in the order they are offered: where an agent is the advised way first, then where one is
 *  possible, then where none can be installed (with the reason). A machine whose agent is revoked is left to « New agent » on its card. */
export function agentCandidates(machines: Record<string, MachineConf>, advice: Record<string, Advice>, agents: AgentInfo[]): AgentCandidate[] {
  const taken = new Set(agents.map((a) => a.ip));
  const order = { advised: 0, possible: 1, impossible: 2 };
  return Object.entries(machines)
    .filter(([ip, m]) => !m.disabled && !taken.has(ip) && advice[ip])
    .map(([ip, m]): AgentCandidate => {
      const a = advice[ip];
      return { ip, name: m.name, advice: a, tier: !a.agent_possible ? "impossible" : a.method === "agent" ? "advised" : "possible" };
    })
    .sort((x, y) => order[x.tier] - order[y.tier] || x.name.localeCompare(y.name));
}
