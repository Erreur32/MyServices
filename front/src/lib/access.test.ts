import { describe, expect, it } from "vitest";
import type { Advice } from "../types";
import { STATUS_RANK, describeAdvice, summary } from "./access";

const adv = (o: Partial<Advice>): Advice => ({ kind: "linux", method: "ssh", why: "ssh_configured", current: [], alternatives: ["agent"], agent_possible: true, agent_kind: "linux", ...o });

describe("recommandation de méthode de lecture : présentation", () => {
  it("SSH recommandé, pas encore lu : bouton vers les réglages de la machine", () => {
    const v = describeAdvice("10.0.0.2", adv({ why: "ssh_port" }));
    expect(v).toMatchObject({ title: "SSH", read: false, action: { setup: "ssh" } });
    expect(v.others).toEqual(["Agent Linux"]);
  });

  it("déjà lue par la méthode recommandée : rien à faire, pas de bouton", () => {
    const v = describeAdvice("10.0.0.2", adv({ current: ["ssh"] }));
    expect(v.read).toBe(true);
    expect(v.action).toBeNull();
  });

  it("PC Windows : agent Windows, bouton vers la page Agents", () => {
    const v = describeAdvice("10.0.0.9", adv({ kind: "windows", method: "agent", why: "windows", alternatives: [], agent_kind: "windows" }));
    expect(v).toMatchObject({ title: "Agent Windows", read: false, action: { setup: "agent" } });
  });

  it("box ou passerelle : le connecteur, jamais d'agent proposé", () => {
    const v = describeAdvice("10.0.0.1", adv({ kind: "unknown", method: "connector", why: "appliance", alternatives: ["ping"], agent_possible: false, agent_kind: null }));
    expect(v.title).toBe("Connecteur");
    expect(v.action?.setup).toBe("connector");
    expect(v.why).toContain("n'y installe rien");
    expect(v.others).not.toContain("Agent");
  });

  it("ping seul : jamais de faux « déjà en place » ni de bouton", () => {
    const v = describeAdvice("10.0.0.5", adv({ method: "ping", why: "unknown_system", current: ["ssh"], alternatives: ["agent"], agent_kind: null }));
    expect(v).toMatchObject({ title: "Ping seul", read: false, action: null });
  });

  it("chaque motif connu du serveur a une phrase", () => {
    for (const why of ["appliance", "windows", "home_assistant", "device", "macos", "macos_no_ssh", "ssh_configured", "ssh_port", "connector_only", "unreachable", "no_ssh_port", "unknown_system"])
      expect(describeAdvice("1.1.1.1", adv({ why })).why, why).not.toBe("");
  });

  it("résumé : compte les machines lues par la méthode recommandée", () => {
    expect(summary({ a: adv({ current: ["ssh"] }), b: adv({}), c: adv({ method: "ping", current: ["ssh"] }) })).toEqual({ total: 3, read: 1 });
  });

  it("à finir, à optimiser, en place : trois états, dans cet ordre", () => {
    expect(describeAdvice("1.1.1.1", adv({ current: [] })).status).toBe("todo");
    expect(describeAdvice("1.1.1.1", adv({ current: ["connector"] })).status).toBe("optimize");   // lue par un outil, mais SSH est la meilleure méthode
    expect(describeAdvice("1.1.1.1", adv({ current: ["ssh"] })).status).toBe("ok");
    expect(describeAdvice("1.1.1.1", adv({ method: "ping", why: "appliance", current: [] })).status).toBe("ok");   // rien de possible : rien à faire
    expect([STATUS_RANK.ok, STATUS_RANK.todo, STATUS_RANK.optimize].sort()).toEqual([0, 1, 2]);
    expect(STATUS_RANK.todo).toBeLessThan(STATUS_RANK.optimize);
    expect(STATUS_RANK.optimize).toBeLessThan(STATUS_RANK.ok);
  });
});
