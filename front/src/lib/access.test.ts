import { describe, expect, it } from "vitest";
import type { Advice } from "../types";
import { RICHNESS, STATUS_RANK, connectorsFor, describeAdvice, isActive, summary } from "./access";

const adv = (o: Partial<Advice>): Advice => ({ kind: "linux", method: "ssh", why: "ssh_configured", current: [], alternatives: ["agent"], agent_possible: true, agent_kind: "linux", agent_state: null, ...o });

describe("recommandation de méthode de lecture : présentation", () => {
  it("SSH recommandé, pas encore lu : bouton vers les réglages de la machine", () => {
    const v = describeAdvice("10.0.0.2", adv({ why: "ssh_port" }));
    expect(v).toMatchObject({ title: "SSH", read: false, action: { setup: "ssh" } });
    expect(v.others).toEqual([{ label: "un agent", active: false }]);
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
    for (const why of ["appliance", "windows", "home_assistant", "device", "macos", "macos_no_ssh", "agent_linux_ssh", "agent_linux", "connector_only", "unreachable", "no_ssh_port", "unknown_system"])
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

  it("« à optimiser » seulement si la méthode recommandée recueille plus que ce qui lit déjà la machine", () => {
    // Linux lu par un agent (même richesse que SSH) : rien à optimiser
    expect(describeAdvice("1.1.1.1", adv({ current: ["agent"] }))).toMatchObject({ status: "ok", read: true, action: null });
    // Windows lu par SSH (même richesse que l'agent) : idem
    expect(describeAdvice("1.1.1.1", adv({ kind: "windows", method: "agent", why: "windows", current: ["ssh"], agent_kind: "windows" })).status).toBe("ok");
    // lue par un connecteur seulement : l'agent ou SSH recueillent plus
    expect(describeAdvice("1.1.1.1", adv({ current: ["connector"] })).status).toBe("optimize");
    expect(RICHNESS.connector).toBeLessThan(RICHNESS.ssh);
  });

  it("dit pourquoi et quoi faire pour une machine à optimiser", () => {
    const v = describeAdvice("10.0.0.9", adv({ kind: "windows", method: "agent", why: "windows", current: ["connector"], agent_kind: "windows" }));
    expect(v.now).toBe("un connecteur");
    expect(v.explain).toContain("Aujourd'hui elle est lue par un connecteur");
    expect(v.explain).toContain("mises à jour Windows");
    expect(v.todo).toContain("PowerShell administrateur");
  });

  it("un agent installé mais silencieux est nommé comme la cause", () => {
    const v = describeAdvice("10.0.0.9", adv({ kind: "windows", method: "agent", why: "windows", current: ["connector"], agent_kind: "windows", agent_state: "silencieux" }));
    expect(v.explain).toContain("ne répond plus (silencieux)");
    expect(v.todo).toContain("recréez-le");
  });

  it("autres méthodes : dit si elles sont déjà actives", () => {
    const v = describeAdvice("1.1.1.1", adv({ current: ["ssh", "connector"], alternatives: ["agent", "connector"] }));
    expect(v.others).toEqual([{ label: "un agent", active: false }, { label: "un connecteur", active: true }]);
  });

  it("seules les machines qui répondent sont à régler : une machine éteinte n'est pas proposée", () => {
    expect(isActive({ ping: true })).toBe(true);
    expect(isActive({ ping: false })).toBe(false);            // éteinte (même « souvent éteinte ») : SSH ne marcherait pas
    expect(isActive({})).toBe(false);
    expect(isActive({ ping: true, disabled: true })).toBe(false);
  });

  it("C'est suffisant ainsi : une machine à optimiser passe en place, pas une machine jamais lue", () => {
    const optimize = adv({ current: ["connector"] });
    expect(describeAdvice("1.1.1.1", optimize, true)).toMatchObject({ status: "ok", kept: true, action: null, explain: null, todo: null });
    expect(describeAdvice("1.1.1.1", optimize, false)).toMatchObject({ status: "optimize", kept: false });
    expect(describeAdvice("1.1.1.1", adv({ current: [] }), true)).toMatchObject({ status: "todo", kept: false });   // jamais lue : on ne peut pas « garder »
  });

  it("connecteurs proposés pour une box : le nom d'abord, puis les inventaires réseau", () => {
    const types = [{ type: "nut", label: "Onduleur (NUT)", kinds: ["status"] }, { type: "unifi", label: "UniFi Network", kinds: ["status"] },
                   { type: "mynetwork", label: "MynetworK", kinds: ["network"] }, { type: "beszel", label: "Beszel", kinds: ["health"] }];
    expect(connectorsFor({ name: "UCG Fiber", role: "passerelle UniFi · DHCP" }, types).map((t) => t.type)).toEqual(["unifi", "mynetwork"]);
    expect(connectorsFor({ name: "Freebox", icon: "freebox" }, types).map((t) => t.type)).toEqual(["mynetwork"]);
    expect(connectorsFor({ name: "Autre" }, [types[3]])).toEqual([]);
  });
});
