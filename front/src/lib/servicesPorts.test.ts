import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { mergePorts, portGroupKey } from "./servicesState";

const local = (port: number, kind: string, name: string, o: Partial<Host> = {}): Host =>
  ({ type: "local", id: `10.0.0.2:${port}`, ip: "10.0.0.2", port, machine: "nas", enabled: true, domains: [], service: { kind, name }, backend: { up: true, ms: 1 }, ...o } as unknown as Host);

describe("un service sur plusieurs ports : une seule ligne", () => {
  it("un conteneur et un processus regroupés par nom, ports triés, à la place de la première ligne", () => {
    const rows = [local(8555, "docker", "frigate"), local(22, "process", "sshd"), local(5000, "docker", "frigate"), local(8554, "docker", "frigate")];
    const got = mergePorts(rows);
    expect(got.map((l) => [l.lead.service!.name, l.ports.map((r) => r.port)])).toEqual([["frigate", [5000, 8554, 8555]], ["sshd", [22]]]);
  });
  it("les noms génériques (python3, node…) ne sont jamais regroupés : ce peut être deux programmes", () => {
    expect(portGroupKey(local(8090, "process", "python3"))).toBeNull();
    expect(mergePorts([local(8090, "process", "python3"), local(8099, "process", "python3")])).toHaveLength(2);
  });
  it("la ligne montre son pire port", () => {
    const down = local(8554, "docker", "frigate", { backend: { up: false } } as Partial<Host>);
    const got = mergePorts([local(5000, "docker", "frigate"), down]);
    expect(got[0].ports).toHaveLength(2);
    expect(got[0].lead.port).toBe(down.port);
  });
  it("même nom sur deux machines : deux lignes ; un hôte NPM n'est jamais regroupé", () => {
    expect(mergePorts([local(80, "docker", "npm"), local(80, "docker", "npm", { ip: "10.0.0.3", machine: "b" } as Partial<Host>)])).toHaveLength(2);
    expect(portGroupKey({ type: "proxy", id: 1, domains: ["a.lan"] } as unknown as Host)).toBeNull();
  });
});
