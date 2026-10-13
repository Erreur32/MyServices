import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { freeboxHealth, freeboxOf } from "./freebox";

const m = (name: string): Machine => ({ ip: "10.0.0.254", name, ping: true, off: false, services: 0, npm: 0, down: 0 });
const fb = { connection: { state: "up", media: "ftth" }, system: { model: "Freebox v9", firmware: "4.13.1", latest_firmware: "4.14.0", update_available: true, sensors: [{ name: "CPU", value: 60 }] } };

describe("freebox", () => {
  it("is matched by name, never the Player", () => {
    const net = [{ connector: "mynetwork", name: "m", label: "MynetworK", ok: true, freebox: fb }] as never;
    expect(freeboxOf(m("Freebox"), net)).toBe(fb);
    expect(freeboxOf(m("Freebox Player POP"), net)).toBeUndefined();
    expect(freeboxOf(m("Box"), net)).toBeUndefined();
  });
  it("reads OK, busy when hot, down when the line is down, and its firmware update", () => {
    expect(freeboxHealth(m("Freebox"), fb)).toMatchObject({ level: "ok", temp: { celsius: 60 }, apt: { upgradable: 1, sample: ["firmware → 4.14.0"] } });
    expect(freeboxHealth(m("Freebox"), { ...fb, system: { ...fb.system, sensors: [{ name: "Disque", value: 90 }] } }).level).toBe("warn");
    expect(freeboxHealth(m("Freebox"), { ...fb, connection: { state: "down" } }).level).toBe("crit");
  });
});
