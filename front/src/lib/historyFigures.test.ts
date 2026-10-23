import { describe, expect, it } from "vitest";
import { periodFigures } from "./historyFigures";
import type { StoredEvent } from "../types";

const ev = (kind: string, machine?: string): StoredEvent => ({ ts: 1, source: "watcher", kind, key: "k", machine } as StoredEvent);

describe("periodFigures", () => {
  it("counts the period: per day, outages, serious, returns, the busiest machine", () => {
    const events = [ev("panne", "srv"), ev("retabli", "srv"), ev("ssh_down", "nas"), ev("panne", "nas"), ev("nouveau", "nas"), ev("hors_ligne")];
    const f = periodFigures(events, 7, { panne: 3, ssh_down: 2, hors_ligne: 3 });
    expect(f).toEqual({ total: 6, perDay: 0.9, outages: 4, serious: 3, back: 1, top: { machine: "nas", n: 3 } });
  });
  it("nothing in the period", () => {
    expect(periodFigures([], 1, {})).toEqual({ total: 0, perDay: 0, outages: 0, serious: 0, back: 0, top: null });
  });
});
