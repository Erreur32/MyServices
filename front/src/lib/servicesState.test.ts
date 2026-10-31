import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { figures, toWatch } from "./servicesState";

const host = (o: object): Host => ({ type: "proxy", id: 1, enabled: true, domains: ["a.lan"], ssl: true, ssl_forced: true, acl: true, ip: "10.0.0.2", machine: "srv", service: { kind: "docker", name: "x" }, port: 80, backend: { up: true }, public: { code: 200 }, ...o } as unknown as Host);

describe("services in state mode", () => {
  it("counts one service per machine, whatever its ports, in its worst state", () => {
    const svc = (id: number, machine: string, port: number, up: boolean, name = "anydesk") => host({ id, type: "local", domains: [], machine, port, ip: "10.0.0.3", public: {}, backend: { up }, service: { kind: "process", name } });
    const f = figures([svc(1, "a", 7070, true), svc(2, "a", 27461, false), svc(3, "b", 7070, true), svc(4, "a", 3000, true, "node"), svc(5, "a", 3001, true, "node")]);
    expect([f.total, f.bad]).toEqual([4, 1]);
  });

  it("figures: ok, down, warning with its reasons, to check, domains, machines", () => {
    const f = figures([host({ id: 1 }), host({ id: 2, service: { kind: "docker", name: "y" }, backend: { up: false }, public: { code: 502 } }), host({ id: 3, service: { kind: "docker", name: "z" }, type: "local", domains: [], ip: "10.0.0.3", public: {} })]);
    expect([f.total, f.withDomain, f.local, f.machines]).toEqual([3, 2, 1, 2]);
    expect(f.bad).toBe(1);
    expect(f.ok + f.warn + f.bad).toBeGreaterThanOrEqual(2);
  });
  it("to watch: the down service first, a healthy one left out", () => {
    const down = host({ id: 2, domains: ["b.lan"], backend: { up: false }, public: { code: 502 } });
    const rows = toWatch([host({ id: 1 }), down]);
    expect(rows.map((r) => r.id)).toEqual([2]);
  });
});
