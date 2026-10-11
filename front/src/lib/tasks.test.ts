import { describe, expect, it } from "vitest";
import { liveText, period, type TaskInfo } from "./tasks";

const task = (o: Partial<TaskInfo> = {}): TaskInfo => ({
  label: "Collecte", at: "10,40 *", next: null, minutes: [10, 40], hours: null, enabled: true, running: false, started: null, ended: null, result: null, ...o,
});

describe("tâches planifiées", () => {
  it("décrit la période", () => {
    expect(period(task())).toContain(":10, :40");
    expect(period(task({ minutes: [5], hours: [7, 19] }))).toContain("07:05, 19:05");
  });

  it("montre la durée d'un passage en cours", () => {
    expect(liveText(task({ running: true, started: 1000 }), 1_012_000)).toContain("12");
    expect(liveText(task({ running: true, started: 1000 }), 1_125_000)).toContain("2");
  });

  it("compte à rebours avant le prochain passage, ou tâche coupée", () => {
    const now = 1_000_000;
    expect(liveText(task({ next: now / 1000 + 7 * 60 }), now)).toContain("7");
    expect(liveText(task({ next: now / 1000 + 20 }), now)).not.toContain("NaN");
    expect(liveText(task({ enabled: false }), now)).toBe("coupée");
  });
});
