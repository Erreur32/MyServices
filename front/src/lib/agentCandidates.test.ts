import { describe, expect, it } from "vitest";
import type { Advice, AgentInfo, MachineConf } from "../types";
import { agentCandidates } from "./agentCandidates";

const adv = (method: Advice["method"], agent_possible: boolean): Advice => ({ kind: "x", method, why: "", current: [], alternatives: [], agent_possible, agent_kind: agent_possible ? "linux" : null, agent_state: null });
const machines: Record<string, MachineConf> = { "1": { name: "zeta" }, "2": { name: "alpha" }, "3": { name: "nas" }, "4": { name: "old", disabled: true }, "5": { name: "done" }, "6": { name: "blind" } };
const advice = { "1": adv("agent", true), "2": adv("ssh", true), "3": adv("connector", false), "4": adv("agent", true), "5": adv("agent", true) };

describe("agentCandidates", () => {
  it("offers advised first, then possible, then impossible; leaves out followed-off, already with an agent and unadvised", () => {
    const got = agentCandidates(machines, advice, [{ ip: "5" } as AgentInfo]);
    expect(got.map((c) => [c.name, c.tier])).toEqual([["zeta", "advised"], ["alpha", "possible"], ["nas", "impossible"]]);
  });
});
