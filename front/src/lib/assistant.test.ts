import { beforeEach, describe, expect, it } from "vitest";
import type { Machine } from "../types";
import { STEPS, reopened, advance, bannerClosed, closeBanner, isFinished, markLanded, normalizeProgress, shouldLand, loadProgress, nextStep, previousStep, resetProgress, saveProgress, thisMachine } from "./assistant";

// Un localStorage minimal : les tests tournent sans navigateur
const mem = new Map<string, string>();
const session = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) },
  configurable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  configurable: true,
});

describe("assistant : progression", () => {
  beforeEach(() => { mem.clear(); session.clear(); });

  it("commence à la bienvenue, rien de fait", () => {
    expect(loadProgress()).toEqual({ current: "welcome", done: [], skipped: [], host: "", accepted: [] });
  });

  it("rouvert une fois fini, repart du début et garde ce qui est validé", () => {
    const done = STEPS.map((x) => x.id);
    expect(reopened({ current: "tools", done, skipped: [], host: "", accepted: [] })).toMatchObject({ current: "welcome", done });
  });

  it("rouvert en cours, reste sur l'étape en attente", () => {
    expect(reopened({ current: "network", done: ["welcome", "machine"], skipped: [], host: "", accepted: [] }).current).toBe("network");
  });

  it("avance en marquant l'étape faite ou passée", () => {
    const p = advance(loadProgress(), "done");
    expect(p).toEqual({ current: "machine", done: ["welcome"], skipped: [], host: "", accepted: [] });
    expect(advance(p, "skipped")).toEqual({ current: "network", done: ["welcome"], skipped: ["machine"], host: "", accepted: [] });
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
    saveProgress({ current: "network", done: ["welcome", "machine"], skipped: [], host: "", accepted: [] });
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
    expect(loadProgress()).toEqual({ current: "machine", done: ["welcome"], skipped: [], host: "", accepted: [] });
  });

  it("les cinq étapes existent", () => {
    expect(STEPS.filter((s) => s.ready).map((s) => s.id)).toEqual(["welcome", "machine", "network", "access", "tools"]);
    expect(STEPS).toHaveLength(5);
  });

  it("l'assistant est fini quand chaque étape est faite ou passée", () => {
    const ids = STEPS.map((s) => s.id);
    expect(isFinished(null)).toBe(false);
    expect(isFinished({ done: ids.slice(0, 4), skipped: [] })).toBe(false);
    expect(isFinished({ done: ids.slice(0, 3), skipped: ids.slice(3) })).toBe(true);
  });

  it("garde la machine hôte désignée dans la progression", () => {
    saveProgress({ current: "machine", done: [], skipped: [], host: "10.0.0.2", accepted: [] });
    expect(loadProgress().host).toBe("10.0.0.2");
    expect(advance(loadProgress(), "done").host).toBe("10.0.0.2");
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

  it("une progression venue d'un ancien serveur (sans host ni accepted) est complétée, pas rejetée", () => {
    expect(normalizeProgress({ current: "access", done: ["welcome"], skipped: [] })).toEqual({ current: "access", done: ["welcome"], skipped: [], host: "", accepted: [] });
    expect(normalizeProgress({ current: "access", accepted: ["10.0.0.5", 3, null] }).accepted).toEqual(["10.0.0.5"]);
    for (const bad of [null, undefined, "x", 3, [], {}, { current: "inconnue" }]) expect(normalizeProgress(bad).current).toBe("welcome");
  });

  it("s'ouvre tout seul sur une installation neuve, une seule fois par session", () => {
    const host = [{ disabled: false }];
    expect(shouldLand(null, host, "")).toBe(true);                       // jamais servi, seule la machine hôte, sur l'accueil
    expect(shouldLand(null, [], "#")).toBe(true);
    markLanded();
    expect(shouldLand(null, host, "")).toBe(false);                      // déjà fait dans cette session : pas de boucle
  });

  it("ne s'ouvre jamais sur une installation déjà utilisée ou ailleurs que sur l'accueil", () => {
    const host = [{ disabled: false }];
    expect(shouldLand(undefined, host, "")).toBe(false);                 // état pas encore lu
    expect(shouldLand({ current: "machine", done: [], skipped: [], host: "", accepted: [] }, host, "")).toBe(false);   // déjà servi
    expect(shouldLand(null, [{}, {}], "")).toBe(false);                  // des machines sont déjà suivies
    expect(shouldLand(null, [{ disabled: false }, { disabled: true }], "")).toBe(true);   // une machine désactivée ne compte pas
    expect(shouldLand(null, host, "#settings/machines")).toBe(false);    // l'utilisateur est déjà ailleurs
  });

  it("le bandeau fermé reste fermé dans ce navigateur", () => {
    expect(bannerClosed()).toBe(false);
    closeBanner();
    expect(bannerClosed()).toBe(true);
  });
});
