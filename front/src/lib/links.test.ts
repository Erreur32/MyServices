import { describe, expect, it } from "vitest";
import { releaseOf } from "./links";

describe("releaseOf", () => {
  it("lit l'étiquette d'une image publiée", () => {
    expect(releaseOf("v2.0.0-alpha.2-0123abc")?.tag).toBe("v2.0.0-alpha.2");
    expect(releaseOf("v2.0.0-alpha.2-0123abc")?.url).toMatch(/releases\/tag\/v2\.0\.0-alpha\.2$/);
    expect(releaseOf("v2.1.0-4f5e6d7c8b9a")?.tag).toBe("v2.1.0");
    expect(releaseOf("v2.0.0")?.tag).toBe("v2.0.0");
  });
  it("rien pour une image construite en local", () => {
    expect(releaseOf("dev")).toBeNull();
  });
});
