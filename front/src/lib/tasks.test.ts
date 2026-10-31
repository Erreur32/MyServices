import { describe, expect, it } from "vitest";
import { groupOf, liveText, period, runLength, runState, summarize, upcoming, type TaskInfo } from "./tasks";

const task = (o: Partial<TaskInfo> = {}): TaskInfo => ({
  label: "Collecte", at: "10,40 *", next: null, minutes: [10, 40], hours: null, enabled: true, running: false, started: null, ended: null, result: null, ...o,
});

describe("tâches planifiées", () => {
  it("décrit la période", () => {
    expect(period(task())).toContain(":10, :40");
    expect(period(task({ minutes: [5], hours: [7, 19] }))).toContain("07:05, 19:05");
  });

  it("période de la recherche réseau automatique", () => {
    expect(period(task({ every_h: 6, minutes: undefined, hours: undefined }))).toContain("6");
  });

  it("montre la durée d'un passage en cours", () => {
    expect(liveText(task({ running: true, started: 1000 }), 1_012_000)).toContain("12");
    expect(liveText(task({ running: true, started: 1000 }), 1_125_000)).toContain("2");
  });

  it("compte à rebours avant le prochain passage", () => {
    const now = 1_000_000;
    expect(liveText(task({ next: now / 1000 + 7 * 60 }), now)).toContain("7");
    expect(liveText(task({ next: now / 1000 + 20 }), now)).not.toContain("NaN");
  });

  it("donne un seul état par tâche", () => {
    const o = { enabled: true, running: false, result: null };
    expect(runState({ ...o, running: true })).toBe("running");
    expect(runState({ ...o, enabled: false, result: "boom" })).toBe("disabled");
    expect(runState({ ...o, result: "success" })).toBe("ok");
    expect(runState({ ...o, result: "boom" })).toBe("failed");
    expect(runState(o)).toBe("idle");
  });

  it("résume les tâches et range les prochains passages", () => {
    const items = [
      { name: "a", enabled: true, running: false, result: "success", next: 500 },
      { name: "b", enabled: true, running: false, result: "boom", next: 300 },
      { name: "c", enabled: false, running: false, result: null, next: 100 },
      { name: "d", enabled: true, running: true, result: null, next: 50 },
      { name: "e", enabled: true, running: false, result: "success", next: null },
    ];
    expect(summarize(items)).toEqual({ enabled: 4, running: 1, failed: 1 });
    expect(upcoming(items).map((t) => t.name)).toEqual(["b", "a"]);
  });

  it("range les tâches par section", () => {
    expect(groupOf("collect")).toBe(groupOf("live"));
    expect(groupOf("netscan")).toBe("network");
    expect(groupOf("unknown")).toBe("keep");
    expect(runLength(10, 52)).toContain("42");
  });
});
