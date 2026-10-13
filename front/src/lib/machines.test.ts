import { describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { isWindowsMachine, mState, networkTool, stateBadge } from "./machines";

describe("isWindowsMachine", () => {
  it("réglage « windows » ou système probable", () => {
    expect(isWindowsMachine({ os: "windows" })).toBe(true);
    expect(isWindowsMachine({}, { ttl: 128 })).toBe(true);                          // TTL 128 : Windows probable
    expect(isWindowsMachine({}, { info: { os: "Debian GNU/Linux 13" } })).toBe(false);
    expect(isWindowsMachine({}, { ttl: 64 })).toBe(false);
    expect(isWindowsMachine({})).toBe(false);
  });
  it("machine inconnue (liste pas chargée, machine retirée) : jamais d'erreur, on se fie à l'agent", () => {
    expect(isWindowsMachine(undefined)).toBe(false);
    expect(isWindowsMachine(undefined, undefined, true)).toBe(true);
    expect(isWindowsMachine(undefined, { ttl: 128 })).toBe(false);
  });
});

describe("mState", () => {
  const base = { ip: "10.0.0.5", name: "pc", ping: true, off: false, services: 0, npm: 0, down: 0 } as Machine;
  it("un PC lu par son agent est « agent », pas « en ligne, sans SSH »", () => {
    expect(mState({ ...base })).toBe("nossh");
    expect(mState({ ...base, agent: { os: "Windows 11", via: "agent" } })).toBe("agent");
    expect(mState({ ...base, off: true, agent: { os: "Windows 11", via: "agent" } })).toBe("agent");   // éteint « voulu » mais l'agent parle : il est allumé
    expect(mState({ ...base, off: true, ping: false })).toBe("off");
    expect(mState({ ...base, api: [{ type: "home-assistant", name: "Home", label: "Home Assistant", ok: true }] })).toBe("api");     // machine lue par l'API d'un connecteur
    expect(mState({ ...base, api: [{ type: "home-assistant", name: "Home", label: "Home Assistant", ok: false }] })).toBe("nossh");  // connecteur en échec : pas lue
    expect(mState({ ...base, disabled: true, agent: { os: "x", via: "agent" } })).toBe("disabled");
  });
});

describe("seen by a tool", () => {
  const base: Machine = { ip: "10.0.0.1", name: "gw", ping: true, off: false, services: 0, npm: 0, down: 0 };
  const seen = { ...base, links: { mac: null, vendor: null, names: [], sources: [{ source: "mynetwork", label: "MynetworK", instance: "m", by: "ip", ok: true }], guest: null, hypervisor: null } } as Machine;
  it("names the tool instead of « online, no SSH »", () => {
    expect(networkTool(seen)).toBe("MynetworK");
    expect(mState(seen)).toBe("network");
    expect(stateBadge(seen)[1]).toBe("via MynetworK");
    expect(stateBadge(base)[1]).toBe("en ligne, sans SSH");
  });
  it("a tool that does not answer does not count", () => {
    const down = { ...seen, links: { ...seen.links!, sources: [{ ...seen.links!.sources[0], ok: false }] } } as Machine;
    expect(networkTool(down)).toBeUndefined();
    expect(mState(down)).toBe("nossh");
  });
});
