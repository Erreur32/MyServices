// The home page's sentence and its short live list follow the figures: an alert changes the title, the machines to watch come first.
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { alertPlaces, lastBackup, specialDay, storyText, storyTitle } from "./homeLines";
import { fleet, homeStory, installTools, keyCounts } from "./homeStory";
import type { Attention } from "./summary";

const m = (name: string, ping: boolean, off = false) => ({ ip: `10.0.0.${name.length}`, name, ping, off, services: 0, npm: 0, down: 0 });
const snap = (machines: ReturnType<typeof m>[], levels: Record<string, string> = {}) => ({
  data: { machine_list: machines, hosts: [], connectors: [] },
  health: { hosts: Object.entries(levels).map(([ip, level]) => ({ id: ip, name: `x · ${ip}`, reachable: true, level })) },
  backups: null,
}) as unknown as Snapshot;
const alert = { category: "sante", level: "warn", text: "x", tab: "machines", action: "x" } as Attention;

describe("home page figures", () => {
  it("a machine switched off on purpose is no failure", () => {
    const k = keyCounts(snap([m("a", true), m("bb", false, true), m("ccc", false)]));
    expect([k.machines, k.machinesUp, k.machinesOff]).toEqual([3, 2, 1]);
  });

  it("the title follows the alerts", () => {
    const s = snap([m("a", true)]);
    expect(homeStory(s, []).tone).toBe("ok");
    expect(homeStory(s, [alert], 1)).toMatchObject({ tone: "warn", title: "Presque parfait, il reste **un point** à voir.", text: "Tout se passe du côté de **la santé des machines**." });
    expect(homeStory(s, [{ ...alert, level: "crit" }]).tone).toBe("bad");
  });

  it("the live list puts the machines to watch first and keeps to its limit", () => {
    const machines = [m("a", true), m("bb", true), m("ccc", false), m("dddd", false, true), m("eeeee", true), m("ffffff", true), m("ggggggg", true)];
    const { rows, total } = fleet(snap(machines, { "10.0.0.2": "warn" }));
    expect(total).toBe(7);
    expect(rows).toHaveLength(6);
    expect(rows.slice(0, 2).map((r) => r.machine.name)).toEqual(["ccc", "bb"]);
    expect(rows.map((r) => r.machine.name)).not.toContain("dddd");
  });
});

describe("the words of the home page", () => {
  const crit = { ...alert, level: "crit", category: "sauvegardes" } as Attention;
  const many = (n: number) => Array.from({ length: n }, () => alert);
  it("the title follows how many alerts and how serious", () => {
    expect(storyTitle([crit], 0)).toBe("**Un point grave** demande ton attention.");
    expect(storyTitle([crit, alert, alert], 0)).toBe("**Un point grave**, et **2** à regarder ensuite.");
    expect(storyTitle([crit, crit], 1)).toBe("Ça sent le roussi : **2 points graves**.");
    expect(storyTitle(many(3), 0)).toBe("**3 points** à regarder, rien d'urgent.");
    expect(storyTitle(many(6), 0)).toBe("**6 points** à regarder, ça s'accumule.");
  });
  it("calm: one geek title in four, and the title changes with the hour", () => {
    expect(storyTitle([], 4)).toBe("200 OK.");
    expect(storyTitle([], 1)).toBe("Rien à signaler, tu peux aller prendre un café.");
    expect(Array.from({ length: 24 }, (_, h) => storyTitle([], h))).toContain("Tout va bien sur ton réseau.");
    expect(new Set(Array.from({ length: 24 }, (_, h) => storyTitle([], h))).size).toBeGreaterThan(4);
  });
  it("alerts: the serious place first, each place once", () => {
    expect(alertPlaces([alert, crit, alert])).toBe("À commencer par **les sauvegardes**, puis **la santé des machines**.");
  });
  it("calm: a fact of the network, a quote one time in three, and never the figures", () => {
    const s = { data: { hosts: [], connectors: [], security: [{ bans_24h: 29 }], machine_list: [{ name: "a", info: { uptime_s: 86400 * 8 } }, { name: "b" }] },
      health: { hosts: [{ name: "a · 10.0.0.1", disks: [{ mount: "/", used_pct: 15 }, { mount: "/data", used_pct: 80 }] }] } } as unknown as Snapshot;
    expect(storyText(s, [], 1)).toBe("**a** tourne sans redémarrer depuis **8 jours**.");
    expect(storyText(s, [], 4)).toBe("Fail2ban a banni **29 adresses** en 24 h.");
    expect(storyText(s, [], 7)).toBe("Le disque le plus rempli est **/data** sur **a**, à **80 %**.");
    expect(storyText(s, [], 0)).toBe("It's always DNS.");
    expect(storyText(snap([]), [], 1)).not.toContain("/");
  });
});

describe("the dated lines of the home page", () => {
  const NOW = Date.UTC(2026, 10, 1, 12), HOUR = 3_600_000;
  const set = (label: string, mtime: number | null) => ({ label, locations: [{ newest: mtime == null ? null : { name: "x", mtime } }] });
  const s = (...sets: ReturnType<typeof set>[]) => ({ backups: { sets } }) as unknown as Snapshot;
  it("the latest copy of all sets, a date in the future left out", () => {
    expect(lastBackup(s(), NOW)).toBeNull();
    expect(lastBackup(s(set("a", null)), NOW)).toBeNull();
    expect(lastBackup(s(set("a", (NOW - 3 * 86_400_000) / 1000), set("b", (NOW - 5 * 86_400_000) / 1000), set("c", (NOW + HOUR) / 1000)), NOW)).toBe("Dernière sauvegarde : **a**, il y a **3 jour(s)**.");
    expect(lastBackup(s(set("a", (NOW - HOUR) / 1000)), NOW)).toContain("Dernière sauvegarde : **a**, à ");
  });
  it("Patch Tuesday and Sysadmin Day, other days nothing", () => {
    expect(specialDay(new Date(2026, 10, 10))).toContain("Patch Tuesday");
    expect(specialDay(new Date(2026, 10, 3))).toBeNull();
    expect(specialDay(new Date(2026, 10, 17))).toBeNull();
    expect(specialDay(new Date(2026, 6, 31))).toContain("sysadmin");
    expect(specialDay(new Date(2026, 6, 24))).toBeNull();
  });
  it("the special day shows every other hour, and the 2038 line stops once past", () => {
    const empty = { data: { machine_list: [] } } as unknown as Snapshot;
    const tuesday = Math.floor(new Date(2026, 10, 10, 12).getTime() / HOUR / 2) * 2;
    expect(storyText(empty, [], tuesday)).toContain("Patch Tuesday");
    const lines = (h0: number) => Array.from({ length: 16 }, (_, i) => storyText(empty, [], h0 + i));
    expect(lines(Math.floor(NOW / HOUR)).join()).toContain("an 2038");
    expect(lines(Math.floor(Date.UTC(2039, 0, 3) / HOUR)).join()).not.toContain("an 2038");
  });
});

describe("installTools", () => {
  it("every tool once, sorted by name, with its instances and those in error", () => {
    const c = (type: string, name: string, ok = true, message = "OK") => ({ type, name, ok, message });
    const s = { data: { hosts: [], machine_list: [], services_status: [{ connector: "ollama", label: "Ollama" }], connectors: [c("zzz", "zzz"), c("ollama", "a"), c("npm", "b"), c("npm", "c", false, "401")] } } as unknown as Snapshot;
    expect(installTools(s).map((t) => [t.label, t.count, t.failing, t.lines])).toEqual([["NPM", 2, 1, ["b", "c : 401"]], ["Ollama", 1, 0, ["a"]], ["zzz", 1, 0, ["zzz"]]]);
  });
});
