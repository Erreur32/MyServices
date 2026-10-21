import { describe, expect, it } from "vitest";
import { splitAction, tipAction } from "./tip";

describe("ligne d'action des info-bulles", () => {
  it("la dernière ligne marquée devient l'action, le reste garde son texte", () => {
    expect(splitAction(["Disque presque plein", "`/var` 91 %", "", tipAction("Clic : fiche")].join("\n"))).toEqual(["Disque presque plein\n`/var` 91 %", "Clic : fiche"]);
  });
  it("une bulle faite seulement d'une action", () => {
    expect(splitAction(tipAction("Clic : ouvrir"))).toEqual(["", "Clic : ouvrir"]);
  });
  it("sans action, rien ne change", () => {
    expect(splitAction("Machine virtuelle\nVM 104")).toEqual(["Machine virtuelle\nVM 104", undefined]);
  });
});
