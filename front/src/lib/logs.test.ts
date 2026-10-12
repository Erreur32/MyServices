import { describe, expect, it } from "vitest";
import { isProblem, sourceOf } from "./logs";

describe("journaux", () => {
  it("origine : la tâche entre crochets, sinon le serveur", () => {
    expect(sourceOf("  [collect] 12 machines")).toBe("collect");
    expect(sourceOf("2026-10-12 11:10:01 collect : démarré (horaire)")).toBe("server");
  });
  it("erreurs : sortie d'erreur ou mot qui le dit", () => {
    expect(isProblem({ err: true, text: "INFO" })).toBe(true);
    expect(isProblem({ err: false, text: "⚠ préparation SSH impossible" })).toBe(true);
    expect(isProblem({ err: false, text: "collect : terminé" })).toBe(false);
  });
});
