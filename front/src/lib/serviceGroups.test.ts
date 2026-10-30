// The list of services: one line per application, one per site, the plumbing apart, and a state that follows the worst news.
import { describe, expect, it } from "vitest";
import type { Host, ServiceStatus } from "../types";
import { groupServices, groupsTitle, sections } from "./serviceGroups";

const host = (o: Record<string, unknown>) => ({ type: "local", enabled: true, domains: [], ip: "10.0.0.1", port: 80, backend: { up: true }, service: { kind: "docker", name: "x" }, ...o }) as unknown as Host;
const app = (label: string, extra = {}) => ({ key: label, label, confidence: "sure", connector: null, ...extra });
const card = (o: Partial<ServiceStatus>) => ({ connector: "c", name: "c", label: "C", ok: true, stale: false, message: "", ...o }) as ServiceStatus;

describe("service groups", () => {
  it("an application on two machines is one service", () => {
    const g = groupServices([host({ app: app("Ollama"), machine: "a" }), host({ app: app("Ollama"), machine: "b" })], []);
    expect(g).toHaveLength(1);
    expect(g[0].machines).toEqual(["a", "b"]);
  });

  it("sites behind one address stay separate services", () => {
    const g = groupServices([host({ type: "proxy", domains: ["a.lan"], port: 8443, service: null }), host({ type: "proxy", domains: ["b.lan"], port: 8443, service: { kind: "apache", name: "b" } })], []);
    expect(g.map((x) => [x.tech, x.theme])).toEqual([[false, "Sites web"], [false, "Sites web"]]);
  });

  it("a domain in front of an application joins it, a guess from the port does not", () => {
    const g = groupServices([host({ app: app("Hermes"), port: 9 }), host({ type: "proxy", domains: ["h.lan"], port: 9 }), host({ type: "proxy", domains: ["t.lan"], port: 8, service: { kind: "docker", name: "tunarr" }, app: { ...app("Healthchecks"), confidence: "possible" } })], []);
    expect(g.map((x) => x.name)).toEqual(["Hermes", "tunarr"]);
  });

  it("a guess from the port stays when the domain says the same", () => {
    const g = groupServices([host({ type: "proxy", domains: ["plex.lan"], app: { ...app("Plex"), confidence: "possible" } })], []);
    expect(g[0].name).toBe("Plex");
  });

  it("one container behind several addresses is one service, kept in its category", () => {
    const docker = { kind: "docker", name: "nextexplorer" };
    const g = groupServices([host({ domains: ["a.lan"], service: docker, category: "Fichiers / sync" }), host({ domains: ["b.lan"], service: docker, category: "Autre" })], []);
    expect(g).toHaveLength(1);
    expect(g[0].theme).toBe("Fichiers et médias");
  });

  it("the domain named after the service comes first", () => {
    const g = groupServices([host({ app: app("Nextcloud"), domains: ["home.lan", "nextcloud.lan"] })], []);
    expect(g[0].domains[0]).toBe("nextcloud.lan");
  });

  it("plumbing and redirects are set apart, unless plumbing serves a domain", () => {
    const g = groupServices([host({ app: app("OpenSSH") }), host({ app: app("Dozzle (agent)", { agent_of: "dozzle" }) }), host({ type: "redirect" }), host({ app: app("nginx"), domains: ["c.lan"], type: "proxy" })], []);
    expect(g.filter((x) => x.tech)).toHaveLength(3);
    expect(g.find((x) => !x.tech)?.domains).toEqual(["c.lan"]);
  });

  it("a connector joins its application, and one without a machine is a cloud service", () => {
    const g = groupServices([host({ app: app("Nextcloud", { connector: "nextcloud" }) })], [card({ connector: "nextcloud", problems: ["p"] }), card({ connector: "netatmo", label: "Netatmo" })]);
    expect(g.find((x) => x.name === "Nextcloud")).toMatchObject({ tone: "warn", problems: ["p"] });
    expect(g.find((x) => x.name === "Netatmo")).toMatchObject({ cloud: true, theme: "Domotique" });
  });

  it("a failing connector turns its service red, a row hidden from the alerts no longer colours it", () => {
    const r = host({ app: app("A"), backend: { up: false } });
    expect(groupServices([host({ app: app("A", { connector: "c" }) })], [card({ ok: false })])[0].tone).toBe("bad");
    expect(groupServices([r], [])[0].tone).toBe("bad");
    expect(groupServices([r], [], () => true)[0].tone).toBe("off");
  });

  it("the machine view shows a shared service under each machine, the cloud apart", () => {
    const g = groupServices([host({ app: app("A"), machine: "a" }), host({ app: app("A"), machine: "b" })], [card({ connector: "n", label: "N" })]);
    expect(sections(g, true).map((s) => [s.title, s.groups.length])).toEqual([["a", 1], ["b", 1], ["Cloud", 1]]);
  });

  it("the title leaves the plumbing out", () => {
    const g = groupServices([host({ app: app("A") }), host({ app: app("OpenSSH") })], []);
    expect(groupsTitle(g)).toBe("1 services, tout va bien.");
  });
});
