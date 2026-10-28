import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MACHINE_ICONS, chosenIcon, customIcon, rememberCustomLabels } from "./machineIcons";

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
  it("une icône importée se résout par sa clé, avec son adresse et son nom appris", () => {
    const key = "custom-0123456789ab";
    expect(chosenIcon(key)).toMatchObject({ key, family: "custom", url: "/api/v1/icons/custom-0123456789ab" });
    rememberCustomLabels([{ key, label: "Ma box" }]);
    expect(chosenIcon(key)?.label).toBe("Ma box");
    expect(customIcon(key, "Autre")?.label).toBe("Autre");
  });
  it("une clé qui n'est pas celle d'une icône importée reste inconnue", () => {
    for (const k of ["custom-xyz", "custom-0123456789abc", "../custom-0123456789ab", "inconnue"]) expect(chosenIcon(k)).toBeUndefined();
  });
});
