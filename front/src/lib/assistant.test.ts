import { beforeEach, describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { STEPS, advance, loadProgress, nextStep, previousStep, resetProgress, saveProgress, thisMachine } from "./assistant";

// Un localStorage minimal : les tests tournent sans navigateur
const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  configurable: true,
});

describe("assistant : progression", () => {
  beforeEach(() => mem.clear());

  it("commence à la bienvenue, rien de fait", () => {
    expect(loadProgress()).toEqual({ current: "welcome", done: [], skipped: [] });
  });

  it("avance en marquant l'étape faite ou passée", () => {
    const p = advance(loadProgress(), "done");
    expect(p).toEqual({ current: "machine", done: ["welcome"], skipped: [] });
    expect(advance(p, "skipped")).toEqual({ current: "network", done: ["welcome"], skipped: ["machine"] });
  });

  it("refaire une étape passée la retire des passées", () => {
    const p = advance(advance(loadProgress(), "skipped"), "done");
    expect(p.skipped).toEqual(["welcome"]);
    const back = { ...p, current: "welcome" as const };
    expect(advance(back, "done").skipped).toEqual([]);
  });

  it("la dernière étape reste la dernière, la première aussi", () => {
    const last = STEPS[STEPS.length - 1].id;
    expect(nextStep(last)).toBe(last);
    expect(previousStep("welcome")).toBe("welcome");
    expect(previousStep("machine")).toBe("welcome");
  });

  it("se souvient d'où on en est, et recommence", () => {
    saveProgress({ current: "network", done: ["welcome", "machine"], skipped: [] });
    expect(loadProgress().current).toBe("network");
    resetProgress();
    expect(loadProgress().current).toBe("welcome");
  });

  it("ignore un état abîmé ou d'une ancienne version", () => {
    mem.set("myservices-assistant", "pas du json");
    expect(loadProgress().current).toBe("welcome");
    mem.set("myservices-assistant", JSON.stringify({ current: "inconnue", done: ["x"] }));
    expect(loadProgress().current).toBe("welcome");
    mem.set("myservices-assistant", JSON.stringify({ current: "machine", done: ["welcome", "x"], skipped: ["y"] }));
    expect(loadProgress()).toEqual({ current: "machine", done: ["welcome"], skipped: [] });
  });

  it("les quatre premières étapes existent, les autres sont annoncées", () => {
    expect(STEPS.filter((s) => s.ready).map((s) => s.id)).toEqual(["welcome", "machine", "network", "access"]);
    expect(STEPS).toHaveLength(6);
  });

  it("trouve la machine hôte sans jamais prendre la première au hasard", () => {
    const m = (ip: string, extra = {}) => ({ ip, name: ip, ...extra }) as unknown as Machine;
    const gw = m("10.0.0.1"), srv = m("10.0.0.2", { ssh: { alias: "hote" } }), nas = m("10.0.0.3"), me = m("10.0.0.4", { local: true });
    expect(thisMachine([gw, srv, nas], "10.0.0.3")?.ip).toBe("10.0.0.3");          // l'adresse de la page
    expect(thisMachine([gw, srv, nas], "monserveur.lan")?.ip).toBe("10.0.0.2");   // l'alias « hote » de MyServices
    expect(thisMachine([gw, srv, nas, me], "10.0.0.3")?.ip).toBe("10.0.0.4");     // marquée locale
    expect(thisMachine([gw, srv, nas, me], "10.0.0.3", "10.0.0.1")?.ip).toBe("10.0.0.1");   // désignée par l'utilisateur
    expect(thisMachine([gw, nas], "monserveur.lan")).toBeUndefined();              // aucune ne correspond : on ne devine pas
  });
});
