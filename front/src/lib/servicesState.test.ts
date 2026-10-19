import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { figures, toWatch } from "./servicesState";

const host = (o: object): Host => ({ type: "proxy", id: 1, enabled: true, domains: ["a.lan"], ssl: true, ssl_forced: true, acl: true, ip: "10.0.0.2", machine: "srv", service: { kind: "docker", name: "x" }, port: 80, backend: { up: true }, public: { code: 200 }, ...o } as unknown as Host);

describe("services in state mode", () => {
  it("figures: ok, down, warning with its reasons, to check, domains, machines", () => {
    const f = figures([host({ id: 1 }), host({ id: 2, backend: { up: false }, public: { code: 502 } }), host({ id: 3, type: "local", domains: [], ip: "10.0.0.3", public: {} })]);
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
