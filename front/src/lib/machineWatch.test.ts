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

  it("SMART : seul un disque en échec est signalé, un disque non lu ne l'est pas", () => {
    const smart = { accessible: true, disks: [{ device: "sda", healthy: true, failed: false }, { device: "nvme0n1", healthy: false, failed: false }, { device: "sdb", healthy: false, failed: true }] };
    expect(watchItems(machine(), health({ smart })).map((i) => i.text)).toEqual(["SMART : sdb en défaut"]);
  });

  it("le plus grave d'abord, avec une icône par sujet", () => {
    const h = health({ disks: [{ mount: "/", used_pct: 97, critical: true, warning: true }], reboot_required: true, apt: { upgradable: 4 } });
    const items = watchItems(machine({ down: 2 }), h);
    expect(items.map((i) => [i.tone, i.kind])).toEqual([["bad", "disk"], ["bad", "services"], ["warn", "reboot"], ["warn", "updates"]]);
    expect(worst(items)).toBe(3);
  });

  it("services et stockage : PM2, RAID, ZFS, partages, heure, tâches, mises à jour automatiques, Docker en boucle", () => {
    const h = health({
      docker: { accessible: true, loops: [{ name: "web", restarts: 7 }] },
      system: {
        pm2: { available: true, units: [{ unit: "pm2-root.service", enabled: true, active: false }], running: true, apps: [{ name: "api", up: false, saved: true }] },
        raid: { available: true, arrays: [{ name: "md0", state: "active", level: "raid1", degraded: true }, { name: "md1", state: "active", level: "raid1", degraded: true, rebuild: { kind: "recovery", pct: 40 } }] },
        zfs: { available: true, pools: [{ name: "tank", health: "DEGRADED" }, { name: "ok", health: "ONLINE" }] },
        mounts: { available: true, shares: [{ path: "/mnt/nas", ok: false, state: "hang" }, { path: "/mnt/fb", ok: false, state: "missing" }] },
        ntp: { available: true, synced: false }, timers: { available: true, total: 3, failed: ["backup.service"] },
        auto_upd: { available: true, enabled: true, days: 6, errors: [] }, snap: { available: true, pending: 2 },
      },
    });
    const items = healthItems(h);
    expect(items.map((i) => i.kind)).toEqual(["docker", "pm2", "pm2", "raid", "raid", "zfs", "mounts", "mounts", "ntp", "timers", "auto_upd", "updates"]);
    expect(items.find((i) => i.kind === "raid")).toMatchObject({ tone: "bad", text: "RAID md0 dégradé" });
    expect(items.find((i) => i.kind === "mounts")!.tone).toBe("bad");
    expect(items.at(-1)!.tone).toBe("info");
    expect(WATCH_SECTION.auto_upd).toBe("updates");
    const stopped = healthItems(health({ system: { pm2: { available: true, running: false, apps: [{ name: "api", up: false, saved: true }] }, auto_upd: { available: true, enabled: true, days: 0, errors: ["x"] } } }));
    expect(stopped.map((i) => i.text)).toEqual(["PM2 arrêté : 1 appli(s) enregistrée(s) ne tournent pas", "mises à jour automatiques en erreur"]);
    expect(healthItems(health({ checks: { mounts: "crit" } }))[0]).toMatchObject({ tone: "bad", kind: "mounts" });
  });

  it("Docker : les conteneurs en défaut par leur nom et leur état, jamais [object Object]", () => {
    const items = healthItems(health({ docker: { accessible: true, exited: 1, issues: [{ name: "db", status: "Exited (1) 3 hours ago", image: "postgres:16" }, "old-text"] } }));
    expect(items.map((i) => i.text)).toContain("Docker : db (Exited (1) 3 hours ago), old-text");
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

  it("Windows : le CPU instantané fait une ligne ; conteneurs arrêtés comptés ; seuils de charge du serveur", () => {
    expect(healthItems(health({ load: { available: true, load_1: 0, ncpu: 8, cpu_pct: 93 } }))).toEqual([{ tone: "warn", kind: "load", text: "processeur à 93 %" }]);
    expect(healthItems(health({ load: { available: true, load_1: 0, ncpu: 8, cpu_pct: 40 } }))).toEqual([]);
    expect(healthItems(health({ docker: { accessible: true, exited: 1 } }))).toMatchObject([{ tone: "warn", kind: "docker" }]);
    expect(healthItems(health({ load: { available: true, load_1: 7, ncpu: 4 } }))[0]).toMatchObject({ tone: "warn", kind: "load" });
    expect(healthItems(health({ load: { available: true, load_1: 13, ncpu: 4 } }))[0]).toMatchObject({ tone: "bad", kind: "load" });
    expect(healthItems(health({ load: { available: true, load_1: 7, ncpu: 4 } }))).toHaveLength(1);
    expect(healthItems(health({ load: { available: true, load_1: 4.5, ncpu: 4 } }))).toEqual([]);
  });

  it("température : le niveau du serveur fait foi (seuil de la machine, chaleur soutenue), les seuils par défaut sans lui", () => {
    expect(healthItems(health({ temp: { available: true, celsius: 92, level: "ok", hot_s: 60 } }))).toEqual([]);
    expect(healthItems(health({ temp: { available: true, celsius: 72, level: "warn", warn_c: 70 } })).map((i) => [i.tone, i.kind])).toEqual([["warn", "temp"]]);
    expect(healthItems(health({ temp: { available: true, celsius: 96 } })).map((i) => [i.tone, i.kind])).toEqual([["bad", "temp"]]);
  });

  it("un contrôle en alerte côté serveur sans détail connu : une phrase générale, jamais un badge muet", () => {
    const items = healthItems(health({ level: "warn", checks: { temp: "warn", disk: "crit" } }));
    expect(items.map((i) => [i.tone, i.kind])).toEqual([["warn", "temp"], ["bad", "disk"]]);
    const explained = healthItems(health({ level: "warn", checks: { res: "warn" }, res: { available: true, mem_pct: 92 } }));
    expect(explained).toHaveLength(1);   // the measured sentence, not the general one too
    expect(explained[0].text).toBe("mémoire utilisée à 92 %");
  });

  it("dit depuis quand et donne le détail", () => {
    const [hot] = healthItems(health({ temp: { available: true, celsius: 90, level: "warn", warn_c: 85, crit_c: 95, hot_s: 4550, sensors: [{ name: "a", celsius: 60 }, { name: "b", celsius: 92 }] },
      load: { available: true, load_1: 2.5, ncpu: 20 }, check_s: { temp: 4550 } }));
    expect(hot.text).toBe("processeur à 90 °C depuis 1 h 15 min");   // said once, not twice
    expect(hot.detail).toEqual(["Avertissement à 85 °C, critique à 95 °C", "Capteur le plus chaud : b à 92 °C", "charge 2.5 pour 20 CPU"]);
    const [mem] = healthItems(health({ res: { available: true, mem_pct: 92, mem_used_mb: 7372, mem_total_mb: 8000 }, check_s: { res: 7200 } }));
    expect(mem.text).toBe("mémoire utilisée à 92 % (7,2 Go sur 7,8 Go), depuis 2 h 0 min");
    const [disk] = healthItems(health({ disks: [{ mount: "/", used_pct: 91, warning: true, avail_gb: 9, size_gb: 100 }], check_s: { disk: 0 } }));
    expect(disk.text).toBe("disque / rempli à 91 % (9,0 Go libres sur 100 Go)");   // first pass: no date yet
    const [upd] = healthItems(health({ apt: { upgradable: 3, security: 1, sample: ["curl"] } }));
    expect(upd).toMatchObject({ text: "3 mise(s) à jour en attente, dont 1 de sécurité", detail: ["curl"] });
  });
});
