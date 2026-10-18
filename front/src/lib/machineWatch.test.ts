import { describe, expect, it } from "vitest";
import type { HealthHost, Machine } from "../types";
import { WATCH_SECTION, healthItems, watchItems, worst } from "./machineWatch";

const machine = (o: Partial<Machine> = {}): Machine => ({ ip: "10.0.0.2", name: "srv", ping: true, off: false, services: 3, npm: 0, down: 0, info: { os: "Debian" }, ssh: { alias: "a", port: 22, identity: "k" }, ...o }) as Machine;
const health = (o: Partial<HealthHost> = {}): HealthHost => ({ id: "srv", name: "srv · 10.0.0.2", reachable: true, level: "ok", ...o }) as HealthHost;

describe("à surveiller", () => {
  it("machine saine : rien", () => {
    expect(watchItems(machine(), health())).toEqual([]);
    expect(worst([])).toBe(0);
  });

  it("le plus grave d'abord, avec une icône par sujet", () => {
    const h = health({ disks: [{ mount: "/", used_pct: 97, critical: true, warning: true }], reboot_required: true, apt: { upgradable: 4 } });
    const items = watchItems(machine({ down: 2 }), h);
    expect(items.map((i) => [i.tone, i.kind])).toEqual([["bad", "disk"], ["bad", "services"], ["warn", "reboot"], ["warn", "updates"]]);
    expect(worst(items)).toBe(3);
  });

  it("services en panne : la liste (nom : cause) accompagne l'avertissement", () => {
    const list = ["app.exemple.fr : backend down"];
    expect(watchItems(machine({ down: 1 }), health(), [], false, list)[0]).toMatchObject({ kind: "services", detail: list });
    expect(watchItems(machine({ down: 1 }), health())[0].detail).toBeUndefined();
  });

  it("accès : injoignable en rouge, clé refusée en orange, sans accès en bleu", () => {
    expect(watchItems(machine({ ping: false, info: null, ssh: null }), undefined)[0]).toMatchObject({ tone: "bad", kind: "down" });
    expect(watchItems(machine({ info: null }), undefined)[0]).toMatchObject({ tone: "warn", kind: "ssh" });
    expect(watchItems(machine({ info: null, ssh: null }), undefined)[0]).toMatchObject({ tone: "info", kind: "access" });
    expect(watchItems(machine({ info: null, ssh: null }), undefined, [], true)).toEqual([]);   // read by a network tool (Freebox, UniFi): no SSH is not a gap
  });

  it("machine lue par son agent : pas « sans accès »", () => {
    expect(watchItems(machine({ info: null, ssh: null, agent: { os: "Windows 11", via: "agent" } }), health())).toEqual([]);
  });

  it("machine non suivie ou éteinte voulue : rien à surveiller", () => {
    expect(watchItems(machine({ disabled: true }), health({ level: "crit", reboot_required: true }))).toEqual([]);
    expect(watchItems(machine({ off: true, ping: false, info: null, ssh: null }), undefined)).toEqual([]);
  });

  it("machine injoignable : une seule ligne, pas deux", () => {
    expect(watchItems(machine({ ping: false, info: null }), health({ reachable: false })).filter((i) => i.kind === "down")).toHaveLength(1);
    expect(healthItems(health({ reachable: false }))[0].tone).toBe("bad");
  });

  it("connecteur en échec rattaché à la machine (hors Docker, déjà dit par « SSH refusé »)", () => {
    const cs = [{ type: "adguard", name: "dns", ok: false, message: "refusé", ip: "10.0.0.2" }, { type: "docker", name: "srv", ok: false, message: "x", ip: "10.0.0.2" }, { type: "npm", name: "n", ok: false, message: "y", ip: "10.0.0.9" }];
    expect(watchItems(machine(), health(), cs).map((i) => i.kind)).toEqual(["connector"]);
  });

  it("erreurs noyau : les messages relevés suivent l'avertissement et mènent à la section Santé", () => {
    const it = healthItems(health({ kernel: { has_errors: true, samples: ["nvme0: I/O error", "EXT4-fs error"] } })).find((i) => i.kind === "kernel");
    expect(it?.tone).toBe("warn");
    expect(it?.detail).toEqual(["nvme0: I/O error", "EXT4-fs error"]);
    expect(WATCH_SECTION.kernel).toBe("health");
  });
});
