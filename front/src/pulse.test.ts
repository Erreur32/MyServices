import { describe, expect, it } from "vitest";
import { withPulse } from "./api";
import type { Data, Host } from "./types";

const host = (over: Partial<Host> = {}) => ({ enabled: true, ip: "10.0.0.5", port: 8080, backend: { up: true }, ...over }) as Host;
const data = (hosts: Host[]) => ({ machine_list: [], hosts }) as unknown as Data;
const ports = (ping: boolean, ts = Date.now() / 1000) => ({ ts, machines: { "10.0.0.5:8080": { ping, ms: null, since: ts } } });

describe("withPulse, port of the services", () => {
  it("shows the port the pulse read, over the collection", () => {
    expect(withPulse(data([host()]), null, ports(false)).hosts[0].backend?.up).toBe(false);
  });

  it("keeps the same object when nothing moved, and ignores an old pulse", () => {
    const d = data([host()]);
    expect(withPulse(d, null, ports(true))).toBe(d);
    expect(withPulse(d, null, ports(false, 1))).toBe(d);
  });

  it("leaves a service it does not follow", () => {
    const d = data([host({ paused: "x" }), host({ backend: { up: true, internal: true } }), host({ web: "none" })]);
    expect(withPulse(d, null, ports(false))).toBe(d);
  });
});
