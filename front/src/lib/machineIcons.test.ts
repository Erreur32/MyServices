import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MACHINE_ICONS, chosenIcon } from "./machineIcons";

describe("icônes de machine", () => {
  it("clés uniques, en minuscules et tirets (comme le serveur l'exige)", () => {
    const keys = MACHINE_ICONS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it("chaque icône d'appli a son fichier dans public/icons", () => {
    for (const i of MACHINE_ICONS) if ("file" in i) expect(existsSync(join(__dirname, "../../public/icons", `${i.file}.svg`)), i.key).toBe(true);
  });
  it("clé vide ou inconnue : retour à l'automatique", () => {
    expect(chosenIcon("")).toBeUndefined();
    expect(chosenIcon(undefined)).toBeUndefined();
    expect(chosenIcon("n-existe-pas")).toBeUndefined();
    expect(chosenIcon("nas")?.family).toBe("object");
  });
});
