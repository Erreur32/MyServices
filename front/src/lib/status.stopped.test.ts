// A service whose container is stopped on purpose is grey, not red, and never a point to fix
import { describe, expect, it } from "vitest";
import type { Host } from "../types";
import { checks, noIdentity, status } from "./status";

const row = (extra: Partial<Host>): Host => ({ id: 1, type: "proxy", enabled: true, domains: ["llama.lan"], ip: "10.0.0.2", port: 8081, backend: { up: false, err: "ConnectionRefusedError" }, ...extra });

describe("container stopped on purpose", () => {
  it("is down while nothing says the stop is wanted", () => {
    expect(status(row({}))[0]).toBe("bad");
    expect(checks(row({}))).toContain("down");
  });
  it("is off, not tested and not a point to fix once its container is stopped on purpose", () => {
    const r = row({ stopped: "Exited (0) 30 hours ago" });
    expect(status(r)[0]).toBe("off");
    expect(status(r)[2]).toContain("Exited (0) 30 hours ago");
    expect(checks(r)).toEqual([]);
    expect(noIdentity(r)).not.toBeNull();
  });
  it("also covers a service seen only on the machine (local)", () => {
    expect(status(row({ type: "local", stopped: "Created" }))[0]).toBe("off");
  });
});
