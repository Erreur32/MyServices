import { describe, expect, it } from "vitest";
import { chipKeys, type Facet } from "./filter";

const facet: Facet<string> = { key: "state", label: "État", get: (s) => s, order: ["ssh", "api", "down"], quiet: ["api"] };
const counts = new Map([["down", 1], ["api", 4], ["ssh", 2]]);

describe("pastilles d'un filtre", () => {
  it("suit l'ordre et masque une valeur discrète", () => {
    expect(chipKeys(facet, counts, [])).toEqual(["ssh", "down"]);
  });
  it("montre la valeur discrète tant qu'une tuile ou un lien la sélectionne, pour pouvoir la retirer", () => {
    expect(chipKeys(facet, counts, ["api"])).toEqual(["ssh", "api", "down"]);
  });
  it("sans ordre fixe : par nombre décroissant", () => {
    expect(chipKeys({ ...facet, order: undefined, quiet: undefined }, counts, [])).toEqual(["api", "ssh", "down"]);
  });
});
