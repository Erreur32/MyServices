// A connector card tells its state in one word and keeps its figures short; the long values wait for the open card.
import { describe, expect, it } from "vitest";
import type { ConnectorInstance, ServiceStatus } from "../types";
import { cardsTitle, cardView, toWatch } from "./connectorCards";

const inst = (status: Partial<NonNullable<ConnectorInstance["status"]>> | null, enabled = true) => ({
  type: "x", label: "X", name: "x", config: {}, set: {}, enabled,
  status: status && { type: "x", name: "x", ok: true, message: "OK", version: null, version_tested: null, stale: false, failures: 0, ...status },
}) as ConnectorInstance;
const card = (over: Partial<ServiceStatus>) => over as ServiceStatus;

describe("connector cards", () => {
  it("names what is counted and hides the counters of its own lists", () => {
    const v = cardView(inst({ found: [{ name: "facts", count: 4 }, { name: "problems", count: 0 }, { name: "hosts", count: 110 }, { name: "dead", count: 2 }, { name: "custom", count: 1 }] }));
    expect(v.figures.map((f) => [f.label, f.value, f.tone])).toEqual([["hôtes", "110", undefined], ["morts", "2", "warn"], ["custom", "1", undefined]]);
  });

  it("a watched counter at zero says nothing", () => {
    expect(cardView(inst({ found: [{ name: "dead", count: 0 }] })).figures).toEqual([]);
  });

  it("short facts come first, long ones only in the open card", () => {
    const facts = [{ label: "GPU chaud", value: "59 °C (NVIDIA GeForce RTX 3090 Ti)" }, { label: "GPU", value: "3" }];
    const v = cardView(inst({}), card({ facts }));
    expect(v.figures.map((f) => f.label)).toEqual(["GPU"]);
    expect(v.facts).toHaveLength(2);
  });

  it("the state follows the worst news", () => {
    expect(cardView(inst({}, false)).tone).toBe("off");
    expect(cardView(inst(null)).state).toBe("Pas encore lu");
    expect(cardView(inst({ ok: false })).tone).toBe("bad");
    expect(cardView(inst({ stale: true })).state).toBe("Périmé");
    expect(cardView(inst({}), card({ problems: ["a", "b"] })).state).toBe("2 points");
    expect(cardView(inst({}), card({ problems: [] })).tone).toBe("ok");
  });

  it("a connector switched off is not to watch, whatever it said last", () => {
    expect(toWatch(cardView(inst({}, false), card({ problems: ["a"] })))).toBe(false);
  });

  it("the title counts failures and points to look at", () => {
    const ok = cardView(inst({})), bad = cardView(inst({ ok: false })), warn = cardView(inst({ stale: true }));
    expect(cardsTitle([ok, ok])).toBe("2 connecteurs, aucun en échec.");
    expect(cardsTitle([ok, bad, warn])).toBe("3 connecteurs, 1 en échec. 1 à vérifier.");
  });
});
