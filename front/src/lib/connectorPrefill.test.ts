import { beforeEach, describe, expect, it, vi } from "vitest";
import { pointConnectors, pointedHits, takePointed } from "./connectorPrefill";

describe("the connector button of a page", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  });
  const instances = [{ type: "cloudflare", name: "cf" }, { type: "adguard", name: "a" }, { type: "adguard", name: "b" }, { type: "ollama", name: "o" }];
  const types = [{ type: "cloudflare", category: "Réseau / DNS" }, { type: "adguard", category: "Réseau / DNS" }, { type: "ollama", category: "IA" }];

  it("is read once", () => {
    pointConnectors(["cloudflare"]);
    expect(takePointed()).toEqual({ types: ["cloudflare"], category: "" });
    expect(takePointed()).toEqual({ types: [], category: "" });
  });
  it("finds the connector of the page", () => expect(pointedHits(instances, types, { types: ["cloudflare"], category: "" }).map((i) => i.name)).toEqual(["cf"]));
  it("finds a whole category", () => expect(pointedHits(instances, types, { types: [], category: "IA" }).map((i) => i.name)).toEqual(["o"]));
  it("finds several instances of a type", () => expect(pointedHits(instances, types, { types: ["adguard"], category: "" })).toHaveLength(2));
  it("points at nothing by default", () => expect(pointedHits(instances, types, { types: [], category: "" })).toEqual([]));
});
