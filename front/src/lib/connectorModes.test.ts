import { describe, expect, it } from "vitest";
import { configFor, modeOf, npmAgent } from "./connectorModes";
import type { AgentInfo } from "../types";
import type { ConnectorType } from "../types";

const npm = {
  type: "npm", label: "Nginx Proxy Manager", kinds: [], tested: [], fields: [],
  modes: [
    { id: "direct", label: "API directe", help: "", fields: ["url", "user", "password", "ip"], required: ["url", "user", "password"] },
    { id: "ssh", label: "API par SSH", help: "", fields: ["ssh", "url", "user", "password", "ip"], required: ["ssh", "url", "user", "password"] },
    { id: "script", label: "Script", help: "", fields: ["ssh", "api", "ip"], required: ["api"] },
    { id: "agent", label: "Agent", help: "", fields: ["agent", "ip"], required: ["agent"] },
  ],
} as unknown as ConnectorType;

describe("modes d'un connecteur", () => {
  it("déduit le mode des réglages enregistrés", () => {
    expect(modeOf(npm, { url: "http://x" })).toBe("direct");
    expect(modeOf(npm, { url: "http://127.0.0.1:81", ssh: "nas" })).toBe("ssh");
    expect(modeOf(npm, { api: "/a/npm-api.sh", ssh: "nas" })).toBe("script");
    expect(modeOf(npm, { agent: "10.0.0.5", ip: "10.0.0.5" })).toBe("agent");
    expect(modeOf(npm, undefined)).toBe("direct");
  });
  it("un connecteur sans mode n'en a pas", () => {
    expect(modeOf({ ...npm, modes: [] }, { api: "x" })).toBe("");
  });
  it("n'envoie que les champs du mode choisi", () => {
    const all = { url: "http://x", user: "a", password: "p", ssh: "nas", api: "/a/npm-api.sh", ip: "" };
    expect(Object.keys(configFor(npm, "script", all)).sort()).toEqual(["api", "ip", "ssh"]);
    expect(Object.keys(configFor(npm, "direct", all)).sort()).toEqual(["ip", "password", "url", "user"]);
    expect(configFor({ ...npm, modes: [] }, "", all)).toBe(all);
  });
});

describe("agent qui lit déjà NPM", () => {
  const agent = { ip: "10.0.0.5", name: "a", options: { npm: "/a/npm-api.sh" } } as AgentInfo;
  const aliases = [{ alias: "nas", host: "10.0.0.5", ip: null }];
  it("le trouve par l'adresse, l'alias SSH ou l'IP", () => {
    expect(npmAgent([agent], { url: "http://10.0.0.5:81" }, [])).toBe(agent);
    expect(npmAgent([agent], { url: "http://127.0.0.1:81", ssh: "nas" }, aliases)).toBe(agent);
    expect(npmAgent([agent], { ip: "10.0.0.5" }, [])).toBe(agent);
  });
  it("ne propose rien sur une autre machine, ni un agent sans NPM", () => {
    expect(npmAgent([agent], { url: "http://10.0.0.9:81" }, [])).toBeUndefined();
    expect(npmAgent([{ ...agent, options: {} }], { ip: "10.0.0.5" }, [])).toBeUndefined();
  });
});
