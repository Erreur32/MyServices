import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import type { Data, Machine } from "../types";
import { missing } from "./missing";

function machine(m: Partial<Machine>): Machine {
  return { ip: "10.0.0.5", name: "m", ping: true, off: false, services: 0, npm: 0, down: 0, ...m };
}

function snap(machines: Machine[], extra: Partial<Data> = {}, backups: Snapshot["backups"] = null): Snapshot {
  const data: Data = {
    generated: "2026-10-19T10:00:00+00:00", page: { health_url: "", backups_url: "", stale_min: 75, map: false, links: [] },
    npm_instances: {}, hosts: [], machine_list: machines, ...extra,
  };
  return { me: { username: "a", role: "admin" }, data, health: null, backups, events: [], labels: {}, severity: {} };
}

describe("il manque", () => {
  it("rien quand tout est branché et que les machines sont lues", () => {
    const s = snap([machine({ ssh: { alias: "m", port: 22, identity: "/k" }, info: {} })], { dns: { servers: {}, orphans: [], generated: "" } as unknown as Data["dns"], network: [{ connector: "unifi" } as never] },
      { generated: "", summary: { ok: 1, warn: 0, crit: 0, sets: 1, hosts: 1, volume: 0, no_offsite: 0 }, issues: [] });
    const got = missing(s, 2);
    expect(got.filter((m) => m.key !== "network")).toEqual([]);
  });
  it("machine en ligne sans agent ni SSH : une ligne, pas pour la box ni l'éteinte ni la machine locale", () => {
    const got = missing(snap([
      machine({ name: "nas" }), machine({ name: "box", ip: "10.0.0.1", gateway: true }), machine({ name: "pc", ping: false, off: true }), machine({ name: "me", local: true }),
    ]), null);
    const h = got.find((m) => m.key === "health");
    expect(h?.text).toContain("**nas**");
    expect(h?.text).not.toContain("box");
    expect(h?.href).toBe("settings/machines");
  });
  it("plusieurs machines non lues : phrase au pluriel", () => {
    const got = missing(snap([machine({ name: "a" }), machine({ name: "b", ip: "10.0.0.6" })]), null);
    expect(got.find((m) => m.key === "health")?.text).toMatch(/^2 machines sans agent/);
  });
  it("pages cachées : sauvegardes, réseau, DNS ; notifications seulement quand le compte des canaux est connu", () => {
    const keys = (c: number | null) => missing(snap([]), c).map((m) => m.key);
    expect(keys(null)).toEqual(["backups", "network", "dns"]);
    expect(keys(0)).toEqual(["backups", "network", "dns", "channels"]);
    expect(keys(1)).toEqual(["backups", "network", "dns"]);
  });
});
