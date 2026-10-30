// The home page's sentence and its short live list follow the figures: an alert changes the title, the machines to watch come first.
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../api";
import { fleet, homeStory, keyCounts } from "./homeStory";
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
    expect(homeStory(s, [alert])).toMatchObject({ tone: "warn", title: "1 point à traiter sur ton réseau." });
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
