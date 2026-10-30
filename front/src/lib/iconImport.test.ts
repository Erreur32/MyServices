// An imported icon: the type comes from the file, or from its name when the browser leaves it empty (a .svg on a system that does not know it).
import { describe, expect, it } from "vitest";
import { typeOf } from "./iconImport";

describe("icon import", () => {
  it("takes the type of the browser, else the one the name tells for an SVG", () => {
    expect(typeOf({ type: "image/png", name: "a.png" })).toBe("image/png");
    expect(typeOf({ type: "", name: "Logo.SVG" })).toBe("image/svg+xml");
    expect(typeOf({ type: "", name: "photo.heic" })).toBe("");
  });
});
